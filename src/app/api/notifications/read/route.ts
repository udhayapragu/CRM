import { z } from "zod";
import { apiRoute, parseBody } from "@/lib/api";
import { markRead } from "@/server/services/notifications";

export const POST = apiRoute({ permission: "notifications:view" }, async ({ req, user }) => {
  const body = await parseBody(req, z.object({ ids: z.array(z.string().max(40)).max(500).or(z.literal("all")) }));
  return { marked: await markRead(user.id, user.role, body.ids) };
});
