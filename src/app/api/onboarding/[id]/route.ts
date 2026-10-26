import { apiRoute, parseBody } from "@/lib/api";
import { prisma } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { onboardingSchema } from "@/lib/validation";
import { updateOnboardingItem } from "@/server/services/onboarding";

export const GET = apiRoute<{ id: string }>({ permission: "onboarding:view" }, async ({ params }) => {
  const item = await prisma.onboardingItem.findUnique({
    where: { id: params.id },
    include: { stage: true, owner: { select: { id: true, name: true } }, tasks: { orderBy: { createdAt: "asc" }, include: { assignee: { select: { id: true, name: true } } } }, comments: { orderBy: { createdAt: "desc" }, include: { user: { select: { name: true } } } }, documents: { orderBy: { createdAt: "desc" } } },
  });
  if (!item) throw notFound("Onboarding item");
  return item;
});

export const PATCH = apiRoute<{ id: string }>({ permission: "onboarding:manage" }, async ({ req, params, user, ip }) => {
  const body = await parseBody(req, onboardingSchema.partial());
  return updateOnboardingItem(params.id, body, { userId: user.id, ip });
});
