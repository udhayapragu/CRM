import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { needsSetup } from "@/server/services/users";
import { AuthBrand } from "@/components/auth-brand";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "First-time setup" };

export default async function SetupPage() {
  if (!(await needsSetup())) redirect("/login");
  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute -left-40 -top-40 h-[480px] w-[480px] rounded-full bg-brand/20 blur-3xl" />
      <div className="relative w-full max-w-md">
        <AuthBrand subtitle="Welcome. Create the first Super Admin account to get started." />
        <SetupForm requireToken={env.isProduction} />
      </div>
    </div>
  );
}
