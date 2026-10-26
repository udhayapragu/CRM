import { systemReadiness } from "@/lib/system-check";
import { SetupRequired } from "@/components/setup-required";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { needsSetup } from "@/server/services/users";
import { AuthBrand } from "@/components/auth-brand";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const sys = await systemReadiness();
  if (!sys.ok) return <SetupRequired problems={sys.problems} />;
  if (await needsSetup()) redirect("/setup");
  if (await getSessionUser()) redirect("/dashboard");
  return (
    <>
      <AuthBrand subtitle="Sign in to your operations suite" />
      <LoginForm />
    </>
  );
}
