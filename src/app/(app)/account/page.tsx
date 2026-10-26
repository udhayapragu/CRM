import { requirePageUser } from "@/lib/auth/session";
import { ROLE_LABELS, permissionsFor } from "@/lib/auth/permissions";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PasswordForm } from "./password-form";

export const metadata = { title: "Account" };

export default async function AccountPage() {
  const user = await requirePageUser();
  return (
    <>
      <PageHeader eyebrow="Account" title={user.name} subtitle={user.email} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader title="Change password" /><div className="p-5"><PasswordForm /></div></Card>
        <Card>
          <CardHeader title={`Your role: ${ROLE_LABELS[user.role]}`} subtitle="What you are allowed to do" />
          <div className="flex flex-wrap gap-1.5 p-5">{permissionsFor(user.role).map((p) => <Badge key={p} tone="brand">{p}</Badge>)}</div>
        </Card>
      </div>
    </>
  );
}
