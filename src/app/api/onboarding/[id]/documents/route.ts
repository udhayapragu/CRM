import { apiRoute } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { saveDocument } from "@/server/services/onboarding";

export const POST = apiRoute<{ id: string }>({ permission: "onboarding:manage" }, async ({ req, params, user, ip }) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new AppError("Attach a file", 400, "NO_FILE");
  return saveDocument(params.id, file, { userId: user.id, ip });
});
