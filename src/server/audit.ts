import type { Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";

export interface AuditInput {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
}

/** Record an important action. Pass `tx` to make the audit entry part of the same transaction. */
export async function audit(input: AuditInput, tx: Tx = prisma) {
  await tx.auditLog.create({
    data: {
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary.slice(0, 500),
      metadata: input.metadata,
      ip: input.ip ?? null,
    },
  });
}
