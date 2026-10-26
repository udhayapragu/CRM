import bcrypt from "bcryptjs";

const COST = 12;

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

/** Minimum policy: 10+ chars with at least one letter and one number. */
export function passwordProblems(pw: string): string | null {
  if (pw.length < 10) return "Password must be at least 10 characters long";
  if (pw.length > 200) return "Password is too long";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "Password must contain letters and numbers";
  return null;
}
