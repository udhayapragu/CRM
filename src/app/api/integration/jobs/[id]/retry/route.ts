import { apiRoute } from "@/lib/api";
import { kickQueue, retryJob } from "@/server/integrations/wordpress/job-runner";

export const maxDuration = 60;

export const POST = apiRoute<{ id: string }>({ permission: "integration:manage" }, async ({ params, user }) => {
  const res = await retryJob(params.id, user.id);
  kickQueue();
  return res;
});
