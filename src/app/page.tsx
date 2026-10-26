import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { needsSetup } from "@/server/services/users";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (await needsSetup()) redirect("/setup");
  redirect((await getSessionUser()) ? "/dashboard" : "/login");
}
