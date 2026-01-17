// app/settings/automations/page.tsx
import React from "react";
import AutomationClient from "./AutomationClient";
import { loadAutomationSettings } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function AutomationsPage() {
  const { rules, planLimits, planFeatures } = await loadAutomationSettings();

  return (
    <main className="min-h-screen bg-zinc-50 p-6 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <header>
          <h1 className="text-2xl font-semibold text-zinc-900">Automation rules</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Configure guardrails and automations. Rules are deterministic; AI only explains them.
          </p>
        </header>
        <AutomationClient initialRules={rules} planLimits={planLimits} planFeatures={planFeatures} />
      </div>
    </main>
  );
}
