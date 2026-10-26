import { apiRoute, parseBody } from "@/lib/api";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { memberSchema } from "@/lib/validation";
import { audit } from "@/server/audit";
import { assertMlmEnabled, generateReferralCode } from "@/server/services/mlm";

export const GET = apiRoute({ permission: "mlm:view" }, async ({ req }) => {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  return prisma.member.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { referralCode: { contains: q, mode: "insensitive" } }] } : {},
    orderBy: { joinedAt: "desc" },
    take: 200,
    include: { sponsor: { select: { name: true, referralCode: true } }, _count: { select: { downline: true, sales: true } } },
  });
});

/** Registering a member never creates a commission: there are no recruitment rewards or joining fees. */
export const POST = apiRoute({ permission: "mlm:manage" }, async ({ req, user, ip }) => {
  await assertMlmEnabled();
  const body = await parseBody(req, memberSchema);
  let sponsorId: string | null = null;
  if (body.sponsorCode) {
    const sponsor = await prisma.member.findUnique({ where: { referralCode: body.sponsorCode.toUpperCase() } });
    if (!sponsor) throw new AppError("Sponsor referral code not found", 400, "BAD_SPONSOR");
    sponsorId = sponsor.id;
  }
  let code = generateReferralCode(body.name);
  for (let i = 0; i < 5 && (await prisma.member.findUnique({ where: { referralCode: code } })); i++) code = generateReferralCode(body.name);
  const m = await prisma.member.create({ data: { name: body.name, email: body.email, phone: body.phone, notes: body.notes, sponsorId, referralCode: code } });
  await audit({ userId: user.id, action: "member.create", entityType: "Member", entityId: m.id, summary: `Member ${m.name} registered (${m.referralCode})`, ip });
  return m;
});
