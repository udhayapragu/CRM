import { systemReadiness } from "@/lib/system-check";
import { SetupRequired } from "@/components/setup-required";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { needsSetup } from "@/server/services/users";

export const dynamic = "force-dynamic";

export default async function Home() {
  const sys = await systemReadiness();
  if (!sys.ok) return <SetupRequired problems={sys.problems} />;
  if (await needsSetup()) redirect("/setup");
  redirect((await getSessionUser()) ? "/dashboard" : "/login");
}
