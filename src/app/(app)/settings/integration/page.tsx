import { requirePageUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/card";
import { getPrimaryConnection, publicConnection } from "@/server/integrations/wordpress/connection-service";
import { hasDemoData } from "@/server/services/settings";
import { IntegrationClient } from "./integration-client";

export const metadata = { title: "WordPress sync" };

export default async function IntegrationPage() {
  const user = await requirePageUser("integration:view");
  const [c, demo] = await Promise.all([getPrimaryConnection(), hasDemoData()]);
  return (
    <>
      <PageHeader eyebrow="Administration" title="WordPress connection" subtitle="Connect your existing WordPress / WooCommerce website. The CRM only reads from your site — nothing on the website is modified." />
      <IntegrationClient initial={c ? publicConnection(c) : null} canManage={can(user.role, "integration:manage")} demoPresent={demo} />
    </>
  );
}
