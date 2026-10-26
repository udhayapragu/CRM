import { apiRoute, parseBody } from "@/lib/api";
import { prisma } from "@/lib/db";
import { onboardingSchema } from "@/lib/validation";
import { createOnboardingItem, ensureDefaultStages } from "@/server/services/onboarding";

export const GET = apiRoute({ permission: "onboarding:view" }, async () => {
  await ensureDefaultStages();
  const [stages, items] = await Promise.all([
    prisma.onboardingStage.findMany({ orderBy: { position: "asc" } }),
    prisma.onboardingItem.findMany({ orderBy: { updatedAt: "desc" }, include: { owner: { select: { id: true, name: true } }, tasks: { select: { done: true } }, _count: { select: { documents: true } } } }),
  ]);
  return { stages, items };
});

export const POST = apiRoute({ permission: "onboarding:manage" }, async ({ req, user, ip }) => {
  const body = await parseBody(req, onboardingSchema);
  return createOnboardingItem(body, { userId: user.id, ip });
});
