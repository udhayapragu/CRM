import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { AppError, notFound } from "@/lib/errors";
import { hashPassword, passwordProblems, verifyPassword } from "@/lib/auth/password";
import { audit } from "@/server/audit";
import { getDefaultLocationId } from "./inventory-ledger";
import { ensureDefaultStages } from "./onboarding";

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
let dummyHash: string | undefined;

export async function needsSetup() {
  return (await prisma.user.count()) === 0;
}

/** First-run: create the initial Super Admin. Requires SETUP_TOKEN in production. */
export async function performSetup(input: { name: string; email: string; password: string; setupToken?: string }, ip: string | null) {
  if (env.isProduction) {
    if (!env.setupToken) throw new AppError("SETUP_TOKEN must be configured on the server to complete first-time setup.", 403, "SETUP_TOKEN_MISSING");
    if (!input.setupToken || !safeEqual(input.setupToken, env.setupToken)) throw new AppError("Invalid setup token", 403, "BAD_SETUP_TOKEN");
  }
  const problem = passwordProblems(input.password);
  if (problem) throw new AppError(problem, 400, "WEAK_PASSWORD");
  const passwordHash = await hashPassword(input.password);
  return prisma.$transaction(async (tx) => {
    // Serialise concurrent setup attempts.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('luxe-setup'))`;
    if ((await tx.user.count()) > 0) throw new AppError("Setup has already been completed", 409, "ALREADY_SETUP");
    const user = await tx.user.create({ data: { name: input.name.trim(), email: input.email.trim().toLowerCase(), passwordHash, role: "SUPER_ADMIN" } });
    await ensureDefaultStages(tx);
    await getDefaultLocationId(tx);
    await audit({ userId: user.id, action: "setup.complete", entityType: "User", entityId: user.id, summary: "Initial Super Admin created", ip }, tx);
    return user;
  });
}

export async function authenticate(email: string, password: string, ip: string | null) {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  const generic = new AppError("Invalid email or password", 401, "BAD_CREDENTIALS");
  if (!user) {
    // Equalise response timing so attackers cannot probe which emails exist.
    dummyHash ??= await hashPassword("timing-equaliser-not-a-password");
    await verifyPassword(password, dummyHash);
    throw generic;
  }
  if (!user.active) throw generic;
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(`Account temporarily locked after repeated failed logins. Try again after ${user.lockedUntil.toLocaleTimeString()}.`, 423, "LOCKED");
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const failed = user.failedLogins + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: failed >= MAX_FAILED ? 0 : failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
    });
    await audit({ userId: user.id, action: "auth.login_failed", entityType: "User", entityId: user.id, summary: `Failed login${failed >= MAX_FAILED ? " — account locked" : ""}`, ip });
    throw generic;
  }
  await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await audit({ userId: user.id, action: "auth.login", entityType: "User", entityId: user.id, summary: "Signed in", ip });
  return user;
}

interface Actor {
  userId: string;
  ip?: string | null;
}

export async function createUser(input: { name: string; email: string; role: Role; password: string }, actor: Actor) {
  const problem = passwordProblems(input.password);
  if (problem) throw new AppError(problem, 400, "WEAK_PASSWORD");
  const user = await prisma.user.create({
    data: { name: input.name.trim(), email: input.email.trim().toLowerCase(), role: input.role, passwordHash: await hashPassword(input.password) },
  });
  await audit({ userId: actor.userId, action: "user.create", entityType: "User", entityId: user.id, summary: `Created user ${user.email} (${user.role})`, ip: actor.ip });
  return user;
}

async function assertNotLastAdmin(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId } });
  if (u?.role === "SUPER_ADMIN" && u.active) {
    const admins = await prisma.user.count({ where: { role: "SUPER_ADMIN", active: true } });
    if (admins <= 1) throw new AppError("You cannot remove or demote the last active Super Admin", 409, "LAST_ADMIN");
  }
}

export async function updateUser(id: string, input: { name?: string; role?: Role; active?: boolean; password?: string }, actor: Actor) {
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) throw notFound("User");
  if ((input.role && input.role !== "SUPER_ADMIN") || input.active === false) await assertNotLastAdmin(id);
  let passwordHash: string | undefined;
  if (input.password) {
    const problem = passwordProblems(input.password);
    if (problem) throw new AppError(problem, 400, "WEAK_PASSWORD");
    passwordHash = await hashPassword(input.password);
  }
  const user = await prisma.user.update({
    where: { id },
    data: { name: input.name, role: input.role, active: input.active, ...(passwordHash ? { passwordHash, failedLogins: 0, lockedUntil: null } : {}) },
  });
  // Changing role, deactivating or resetting a password signs the user out everywhere.
  if (input.role || input.active === false || passwordHash) await prisma.session.deleteMany({ where: { userId: id } });
  await audit({
    userId: actor.userId,
    action: "user.update",
    entityType: "User",
    entityId: id,
    summary: `Updated ${user.email}: ${[input.role && `role → ${input.role}`, input.active !== undefined && `active → ${input.active}`, passwordHash && "password reset", input.name && "name"].filter(Boolean).join(", ")}`,
    ip: actor.ip,
  });
  return user;
}

export async function changeOwnPassword(userId: string, current: string, next: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(current, user.passwordHash))) throw new AppError("Current password is incorrect", 400, "BAD_PASSWORD");
  const problem = passwordProblems(next);
  if (problem) throw new AppError(problem, 400, "WEAK_PASSWORD");
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } });
  await audit({ userId, action: "user.password_change", entityType: "User", entityId: userId, summary: "Changed own password" });
}
