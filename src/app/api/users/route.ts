import { apiRoute, parseBody } from "@/lib/api";
import { prisma } from "@/lib/db";
import { userCreateSchema } from "@/lib/validation";
import { createUser } from "@/server/services/users";

const select = { id: true, name: true, email: true, role: true, active: true, lastLoginAt: true, lockedUntil: true, createdAt: true } as const;

export const GET = apiRoute({ permission: "users:manage" }, async () => prisma.user.findMany({ select, orderBy: { createdAt: "asc" } }));

export const POST = apiRoute({ permission: "users:manage" }, async ({ req, user, ip }) => {
  const body = await parseBody(req, userCreateSchema);
  const u = await createUser(body, { userId: user.id, ip });
  return { id: u.id, email: u.email };
});
