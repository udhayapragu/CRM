import type { Role } from "@prisma/client";
import { requirePageUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/card";
import { UsersClient } from "./users-client";

export const metadata = { title: "Users & roles" };

const DESCRIPTIONS: Record<Role, string> = {
  SUPER_ADMIN: "Full access including API credentials, users, settings and demo data.",
  INVENTORY_MANAGER: "Manage inventory items, stock movements, receipts, rules and suppliers.",
  ORDER_MANAGER: "Edit order and payment status, record returns, see customer contact details.",
  DISPATCH_MANAGER: "Pack, dispatch and confirm deliveries; sees shipping addresses.",
  ONBOARDING_MANAGER: "Run the product onboarding pipeline, tasks and documents.",
  ACCOUNTANT: "Reports and sensitive exports, audit log, approve and pay MLM commissions.",
  VIEWER: "Read-only access to non-sensitive data.",
};

export default async function UsersPage() {
  const me = await requirePageUser("users:manage");
  const users = await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, active: true, lastLoginAt: true, lockedUntil: true, createdAt: true }, orderBy: { createdAt: "asc" } });
  return (
    <>
      <PageHeader eyebrow="Administration" title="Users & roles" subtitle="Role-based access control. Only authorised roles can change stock, edit orders, manage API credentials, approve commissions or export sensitive data." />
      <UsersClient
        me={me.id}
        users={users.map((u) => ({ ...u, lastLoginAt: u.lastLoginAt?.toISOString() ?? null, lockedUntil: u.lockedUntil?.toISOString() ?? null, createdAt: u.createdAt.toISOString() }))}
        roles={(Object.keys(ROLE_LABELS) as Role[]).map((r) => ({ value: r, label: ROLE_LABELS[r], description: DESCRIPTIONS[r] }))}
      />
    </>
  );
}
