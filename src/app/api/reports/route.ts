import { apiRoute } from "@/lib/api";
import { listReports } from "@/server/services/reports";

export const GET = apiRoute({ permission: "reports:view" }, async ({ user }) => listReports(user));
