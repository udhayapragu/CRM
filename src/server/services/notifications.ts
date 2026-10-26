import type { Role } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { rolesWith } from "@/lib/auth/permissions";

export type NotificationType =
  | "LOW_STOCK"
  | "OUT_OF_STOCK"
  | "NEW_ORDER"
  | "PENDING_DISPATCH"
  | "DELAYED_SHIPMENT"
  | "SYNC_FAILED"
  | "ONBOARDING_APPROVAL"
  | "INVENTORY_ADJUSTMENT"
  | "STOCK_DISCREPANCY"
  | "ORDER_ATTENTION";

export interface NotifyInput {
  type: NotificationType;
  severity?: "info" | "warning" | "critical";
  title: string;
  message: string;
  link?: string;
  roles?: Role[];
  /** If set, a notification with the same key is created only once. */
  dedupeKey?: string;
  isDemo?: boolean;
}

const DEFAULT_ROLES: Record<NotificationType, Role[]> = {
  LOW_STOCK: rolesWith("inventory:manage"),
  OUT_OF_STOCK: rolesWith("inventory:manage"),
  NEW_ORDER: rolesWith("orders:edit"),
  PENDING_DISPATCH: rolesWith("dispatch:manage"),
  DELAYED_SHIPMENT: [...new Set([...rolesWith("dispatch:manage"), ...rolesWith("orders:edit")])],
  SYNC_FAILED: rolesWith("integration:manage"),
  ONBOARDING_APPROVAL: rolesWith("onboarding:manage"),
  INVENTORY_ADJUSTMENT: rolesWith("inventory:manage"),
  STOCK_DISCREPANCY: [...new Set([...rolesWith("inventory:manage"), ...rolesWith("audit:view")])],
  ORDER_ATTENTION: [...new Set([...rolesWith("orders:edit"), ...rolesWith("dispatch:manage")])],
};

export async function notify(input: NotifyInput, tx: Tx = prisma) {
  const data = {
    type: input.type,
    severity: input.severity ?? "info",
    title: input.title.slice(0, 200),
    message: input.message.slice(0, 1000),
    link: input.link ?? null,
    roles: input.roles ?? DEFAULT_ROLES[input.type] ?? [],
    dedupeKey: input.dedupeKey ?? null,
    isDemo: input.isDemo ?? false,
  };
  if (data.dedupeKey) {
    // Idempotent create: ignore if already notified for this key.
    await tx.notification.upsert({ where: { dedupeKey: data.dedupeKey }, create: data, update: {} });
    return;
  }
  await tx.notification.create({ data });
}

export function visibleTo(role: Role) {
  return { OR: [{ roles: { isEmpty: true } }, { roles: { has: role } }] };
}

export async function listNotifications(userId: string, role: Role, opts: { unreadOnly?: boolean; take?: number } = {}) {
  const rows = await prisma.notification.findMany({
    where: {
      ...visibleTo(role),
      ...(opts.unreadOnly ? { reads: { none: { userId } } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 50,
    include: { reads: { where: { userId }, select: { readAt: true } } },
  });
  return rows.map(({ reads, ...n }) => ({ ...n, readAt: reads[0]?.readAt ?? null }));
}

export async function unreadCount(userId: string, role: Role) {
  return prisma.notification.count({ where: { ...visibleTo(role), reads: { none: { userId } } } });
}

export async function markRead(userId: string, role: Role, ids: string[] | "all") {
  const targets =
    ids === "all"
      ? await prisma.notification.findMany({
          where: { ...visibleTo(role), reads: { none: { userId } } },
          select: { id: true },
        })
      : await prisma.notification.findMany({ where: { id: { in: ids }, ...visibleTo(role) }, select: { id: true } });
  if (!targets.length) return 0;
  await prisma.notificationRead.createMany({
    data: targets.map((t) => ({ notificationId: t.id, userId })),
    skipDuplicates: true,
  });
  return targets.length;
}
