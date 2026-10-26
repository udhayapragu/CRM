import { requirePageUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { str, type SP } from "@/lib/url";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { getSettings, hasDemoData } from "@/server/services/settings";
import { ensureDefaultStages } from "@/server/services/onboarding";
import { DemoControls, MlmToggle, SettingsForm, StagesEditor } from "./general-client";
import Link from "next/link";

export const metadata = { title: "Settings" };

export default async function GeneralSettings({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePageUser("settings:manage");
  const sp = await searchParams;
  await ensureDefaultStages();
  const [settings, demo, live, stages] = await Promise.all([getSettings(), hasDemoData(), prisma.wordPressConnection.count({ where: { enabled: true } }), prisma.onboardingStage.findMany({ orderBy: { position: "asc" } })]);
  return (
    <>
      <PageHeader eyebrow="Administration" title="Settings" subtitle="Business preferences, demo environment, optional modules and workflow configuration." />
      {str(sp, "welcome") && (
        <div className="mb-4 rounded-2xl border border-gold/40 bg-gold/10 p-5">
          <h2 className="font-display text-2xl font-semibold gold-text">Welcome to Luxe CRM</h2>
          <p className="mt-1 text-sm text-muted">Choose how to start: <b>load demo data</b> below to explore safely, or <Link href="/settings/integration" className="text-brand-strong underline">connect your WordPress website</Link> to import your real products and orders. Then invite your team under Users &amp; Roles.</p>
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card><CardHeader title="Business" /><div className="p-5"><SettingsForm settings={settings} /></div></Card>
        <Card><div id="demo" /><CardHeader title="Demo environment" subtitle={demo ? "Loaded" : "Not loaded"} /><div className="p-5"><DemoControls demoPresent={demo} liveConnected={live > 0} /></div></Card>
        <Card><CardHeader title="MLM / direct-selling module" subtitle={settings.mlmEnabled ? "Enabled" : "Disabled"} /><div className="p-5"><MlmToggle enabled={settings.mlmEnabled} trigger={settings.mlmCommissionTrigger} /></div></Card>
        <Card><CardHeader title="Onboarding workflow stages" subtitle="Rename, recolour, reorder (position) or add stages" /><div className="p-5"><StagesEditor stages={stages} /></div></Card>
      </div>
    </>
  );
}
