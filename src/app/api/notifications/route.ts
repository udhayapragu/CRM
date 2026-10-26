import { apiRoute } from "@/lib/api";
import { listNotifications, unreadCount } from "@/server/services/notifications";

export const GET = apiRoute({ permission: "notifications:view" }, async ({ req, user }) => {
  const unreadOnly = req.nextUrl.searchParams.get("unread") === "1";
  const [items, unread] = await Promise.all([listNotifications(user.id, user.role, { unreadOnly, take: 50 }), unreadCount(user.id, user.role)]);
  return { items, unread };
});
