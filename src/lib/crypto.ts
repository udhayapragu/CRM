import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "crypto";
import { env } from "./env";
import { AppError } from "./errors";

const VERSION = "v1";

function key(): Buffer {
  const raw = env.encryptionKey;
  if (!raw) {
    throw new AppError(
      "APP_ENCRYPTION_KEY is not configured on the server. Credentials cannot be stored securely.",
      500,
      "ENCRYPTION_KEY_MISSING",
    );
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new AppError("APP_ENCRYPTION_KEY must be 32 bytes encoded as base64.", 500, "ENCRYPTION_KEY_INVALID");
  }
  return buf;
}

/** AES-256-GCM encryption for secrets stored at rest. Output: v1:<iv>:<tag>:<ciphertext> (base64). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

export function decryptSecret(payload: string): string {
  const [ver, ivB64, tagB64, dataB64] = payload.split(":");
  if (ver !== VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new AppError("Stored secret has an unknown format", 500, "SECRET_FORMAT");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new AppError(
      "Stored credentials could not be decrypted (was APP_ENCRYPTION_KEY changed?). Please re-enter them.",
      500,
      "SECRET_DECRYPT",
    );
  }
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Show only the last 4 characters of a secret, e.g. for "ck_••••1234". */
export function maskSecret(secret: string | null | undefined): string | null {
  if (!secret) return null;
  const tail = secret.slice(-4);
  return `••••••••${tail}`;
}
