import { requirePageUser } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/card";
import { listNotifications } from "@/server/services/notifications";
import { NotificationsList } from "./notifications-client";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await requirePageUser("notifications:view");
  const items = await listNotifications(user.id, user.role, { take: 200 });
  return (
    <>
      <PageHeader eyebrow="Inbox" title="Notifications" subtitle="Low stock, new orders, pending and delayed dispatches, sync failures, approvals and stock discrepancies. Email/WhatsApp delivery is an optional integration (see docs)." />
      <NotificationsList items={items.map((n) => ({ ...n, createdAt: n.createdAt.toISOString(), readAt: n.readAt?.toISOString() ?? null }))} />
    </>
  );
}
