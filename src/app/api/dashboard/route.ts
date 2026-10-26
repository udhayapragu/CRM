import { apiRoute } from "@/lib/api";
import { getActivityFeed, getAttentionOrders, getCharts, getKpis } from "@/server/services/dashboard";

export const GET = apiRoute({ permission: "dashboard:view" }, async () => {
  const [kpis, charts, activity, attention] = await Promise.all([getKpis(), getCharts(), getActivityFeed(), getAttentionOrders()]);
  return { kpis, charts, activity, attention, generatedAt: new Date().toISOString() };
});
