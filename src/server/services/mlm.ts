/**
 * Optional MLM / direct-selling module.
 *
 * Compliance guard-rails enforced in code:
 *  - Commissions are ONLY computed from product sales on orders attributed to a member.
 *  - A rule produces commissions only if it is both `active` AND `legallyReviewed`.
 *  - A sale is eligible only once verified (paid + delivered by default; configurable to paid).
 *  - Returned units, cancellations and refunds reduce the eligible amount; pending commissions are
 *    resized/voided, paid commissions receive negative adjustment entries.
 *  - There is NO code path that pays for registering, recruiting or activating members, and no
 *    joining fees or mandatory purchases.
 *  - Only ACTIVE members earn.
 */
import { Prisma, type CommissionStatus } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { toNumber } from "@/lib/utils";
import { audit } from "@/server/audit";
import { getSettings } from "./settings";

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function assertMlmEnabled(tx: Tx = prisma) {
  const s = await getSettings(tx);
  if (!s.mlmEnabled) throw new AppError("The MLM / direct-selling module is disabled. Enable it in Settings.", 409, "MLM_DISABLED");
}

export function generateReferralCode(name: string) {
  const base = name.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase().padEnd(4, "X");
  const rnd = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${base}${rnd}`;
}

/** Eligible commission base for an order: merchandise value of units that were not returned. */
export async function eligibleBase(tx: Tx, orderId: string): Promise<{ eligible: boolean; base: number; reason: string }> {
  const settings = await getSettings(tx);
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
  if (order.status === "CANCELLED") return { eligible: false, base: 0, reason: "Order cancelled" };
  if (order.paymentStatus === "REFUNDED") return { eligible: false, base: 0, reason: "Order refunded" };
  if (order.paymentStatus !== "PAID" && order.paymentStatus !== "PARTIALLY_REFUNDED") {
    return { eligible: false, base: 0, reason: "Payment not verified" };
  }
  if (settings.mlmCommissionTrigger === "DELIVERED" && !["DELIVERED", "RETURNED"].includes(order.status)) {
    return { eligible: false, base: 0, reason: "Awaiting delivery confirmation" };
  }
  let base = 0;
  for (const it of order.items) {
    if (it.quantity <= 0) continue;
    base += toNumber(it.total) * ((it.quantity - it.returnedQty) / it.quantity);
  }
  base = Math.max(0, round2(base - toNumber(order.refundedTotal)));
  return { eligible: base > 0, base, reason: base > 0 ? "Verified sale" : "No eligible amount after returns/refunds" };
}

/** Idempotently (re)compute commissions for an order. Safe to call any number of times. */
export async function recalculateOrderCommissions(tx: Tx, orderId: string) {
  const settings = await getSettings(tx);
  if (!settings.mlmEnabled) return { skipped: "disabled" as const };
  const sale = await tx.memberSale.findUnique({ where: { orderId }, include: { member: true } });
  if (!sale) return { skipped: "no-member" as const };
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  const { base } = await eligibleBase(tx, orderId);
  const rules = await tx.commissionRule.findMany({ where: { active: true, legallyReviewed: true }, orderBy: { level: "asc" } });

  // Walk the sponsor chain: level 1 = selling member, level 2 = their sponsor, ...
  const chain: { id: string; status: string }[] = [];
  let cursor: { id: string; status: string; sponsorId: string | null } | null = sale.member;
  const seen = new Set<string>();
  const maxLevel = rules.reduce((m, r) => Math.max(m, r.level), 0);
  while (cursor && chain.length < maxLevel && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.push({ id: cursor.id, status: cursor.status });
    cursor = cursor.sponsorId
      ? await tx.member.findUnique({ where: { id: cursor.sponsorId }, select: { id: true, status: true, sponsorId: true } })
      : null;
  }

  const results: string[] = [];
  for (const rule of rules) {
    const beneficiary = chain[rule.level - 1];
    if (!beneficiary) continue;
    const key = `c:${orderId}:${rule.id}:${beneficiary.id}`;
    const existing = await tx.commission.findUnique({ where: { key }, include: { adjustments: true } });
    const rate = toNumber(rule.ratePercent);
    const expected = beneficiary.status === "ACTIVE" || existing ? round2((base * rate) / 100) : 0;

    if (!existing) {
      if (expected > 0 && beneficiary.status === "ACTIVE") {
        await tx.commission.create({
          data: {
            key,
            memberId: beneficiary.id,
            orderId,
            ruleId: rule.id,
            level: rule.level,
            baseAmount: new Prisma.Decimal(base),
            ratePercent: rule.ratePercent,
            amount: new Prisma.Decimal(expected),
            status: "PENDING",
            isDemo: order.isDemo,
            note: `Level ${rule.level} commission on verified sale #${order.number}`,
          },
        });
        results.push(`created ${key}`);
      }
      continue;
    }

    if (existing.status === "VOID") {
      // Re-eligible (e.g. order re-attributed back or un-cancelled): reactivate the same accrual row.
      const stillAttributed = beneficiary.status === "ACTIVE";
      if (expected > 0 && stillAttributed && !existing.adjustsId) {
        await tx.commission.update({
          where: { id: existing.id },
          data: { status: "PENDING", amount: new Prisma.Decimal(expected), baseAmount: new Prisma.Decimal(base), note: "Reactivated: sale eligible again" },
        });
        results.push(`reactivated ${key}`);
      }
    } else if (existing.status === "PENDING" || existing.status === "APPROVED") {
      if (expected <= 0) {
        await tx.commission.update({ where: { id: existing.id }, data: { status: "VOID", note: "Voided: sale no longer eligible (cancelled/returned/refunded)" } });
        results.push(`voided ${key}`);
      } else if (expected !== toNumber(existing.amount)) {
        await tx.commission.update({
          where: { id: existing.id },
          data: { amount: new Prisma.Decimal(expected), baseAmount: new Prisma.Decimal(base), note: "Resized after return/refund" },
        });
        results.push(`resized ${key}`);
      }
    } else if (existing.status === "PAID") {
      const net = toNumber(existing.amount) + existing.adjustments.filter((a) => a.status !== "VOID").reduce((s, a) => s + toNumber(a.amount), 0);
      const diff = round2(expected - net);
      if (diff < 0) {
        await tx.commission.create({
          data: {
            key: `adj:${existing.id}:${existing.adjustments.length + 1}`,
            memberId: existing.memberId,
            orderId,
            ruleId: rule.id,
            level: rule.level,
            baseAmount: new Prisma.Decimal(base),
            ratePercent: rule.ratePercent,
            amount: new Prisma.Decimal(diff),
            status: "PENDING",
            adjustsId: existing.id,
            isDemo: order.isDemo,
            note: `Clawback after return/refund on order #${order.number} (deducted from next payout)`,
          },
        });
        results.push(`adjusted ${key}`);
      }
    }
  }
  return { results };
}

export async function setCommissionStatus(ids: string[], to: Extract<CommissionStatus, "APPROVED" | "VOID">, userId: string) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.commission.findMany({ where: { id: { in: ids } } });
    let changed = 0;
    for (const c of rows) {
      if (c.status !== "PENDING" && !(to === "VOID" && c.status === "APPROVED")) continue;
      await tx.commission.update({
        where: { id: c.id },
        data: { status: to, ...(to === "APPROVED" ? { approvedById: userId, approvedAt: new Date() } : {}) },
      });
      changed++;
    }
    await audit({ userId, action: `commission.${to.toLowerCase()}`, entityType: "Commission", summary: `${to} ${changed} commission(s)`, metadata: { ids } }, tx);
    return changed;
  });
}

export async function createPayout(memberId: string, reference: string | undefined, userId: string) {
  return prisma.$transaction(async (tx) => {
    const member = await tx.member.findUnique({ where: { id: memberId } });
    if (!member) throw notFound("Member");
    const approved = await tx.commission.findMany({ where: { memberId, status: "APPROVED" } });
    const total = round2(approved.reduce((s, c) => s + toNumber(c.amount), 0));
    if (total <= 0) throw new AppError("No approved commission balance to pay out for this member", 409, "NOTHING_TO_PAY");
    const payout = await tx.payout.create({ data: { memberId, amount: new Prisma.Decimal(total), reference: reference ?? null, createdById: userId, isDemo: member.isDemo } });
    await tx.commission.updateMany({ where: { id: { in: approved.map((c) => c.id) } }, data: { status: "PAID", payoutId: payout.id } });
    await audit({ userId, action: "payout.create", entityType: "Payout", entityId: payout.id, summary: `Payout of ${total} to ${member.name}`, metadata: { commissions: approved.length } }, tx);
    return payout;
  });
}

export async function attributeOrderToMember(orderId: string, memberId: string | null, userId: string) {
  return prisma.$transaction(async (tx) => {
    await assertMlmEnabled(tx);
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw notFound("Order");
    const existingPaid = await tx.commission.count({ where: { orderId, status: { in: ["APPROVED", "PAID"] } } });
    if (existingPaid) throw new AppError("Commissions for this order were already approved/paid; attribution is locked.", 409, "LOCKED");
    await tx.commission.updateMany({ where: { orderId, status: "PENDING" }, data: { status: "VOID", note: "Voided: order re-attributed" } });
    await tx.memberSale.deleteMany({ where: { orderId } });
    if (memberId) {
      const m = await tx.member.findUnique({ where: { id: memberId } });
      if (!m) throw notFound("Member");
      await tx.memberSale.create({ data: { orderId, memberId } });
    }
    await recalculateOrderCommissions(tx, orderId);
    await audit({ userId, action: "member.attribute_order", entityType: "Order", entityId: orderId, summary: `Order #${order.number} attributed to ${memberId ?? "nobody"}` }, tx);
  });
}

/** Build the downline tree (bounded depth) for a member. */
export async function memberTree(rootId: string, depth = 4) {
  type Node = { id: string; name: string; referralCode: string; status: string; children: Node[] };
  async function build(id: string, d: number): Promise<Node | null> {
    const m = await prisma.member.findUnique({ where: { id }, select: { id: true, name: true, referralCode: true, status: true } });
    if (!m) return null;
    if (d <= 0) return { ...m, children: [] };
    const kids = await prisma.member.findMany({ where: { sponsorId: id }, select: { id: true }, take: 50 });
    const children = (await Promise.all(kids.map((k) => build(k.id, d - 1)))).filter(Boolean) as Node[];
    return { ...m, children };
  }
  return build(rootId, depth);
}
