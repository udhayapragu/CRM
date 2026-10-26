import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api";
import { deleteDocument, readDocument } from "@/server/services/onboarding";

export const GET = apiRoute<{ docId: string }>({ permission: "onboarding:view" }, async ({ params }) => {
  const { doc, data } = await readDocument(params.docId);
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(doc.fileName)}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
});

export const DELETE = apiRoute<{ docId: string }>({ permission: "onboarding:manage" }, async ({ params, user, ip }) => {
  await deleteDocument(params.docId, { userId: user.id, ip });
  return { ok: true };
});
