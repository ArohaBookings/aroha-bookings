// app/analytics/health/page.tsx
import React from "react";
import { Card } from "@/components/ui";
import { prisma } from "@/lib/db";
import { requireOrgOrPurchase } from "@/lib/requireOrgOrPurchase";
import { explainHealthSummary } from "@/lib/ai/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function HealthPage() {
  const gate = await requireOrgOrPurchase();
  const org = gate.org;
  if (!org) return null;

  const settings = await prisma.orgSettings.findUnique({
    where: { orgId: org.id },
    select: { data: true },
  });

  const data = (settings?.data as Record<string, unknown>) || {};
  const errors = Array.isArray(data.calendarSyncErrors) ? data.calendarSyncErrors : [];
  const cronLastRun = typeof data.cronLastRun === "string" ? data.cronLastRun : null;
  const lastError = errors[0] as any;

  const summary = await explainHealthSummary({
    orgName: org.name,
    syncErrors: errors.length,
    cronLastRun,
  });

  return (
    <main className="min-h-screen bg-zinc-50 p-6 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <header>
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">System health</p>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-900">Reliability dashboard</h1>
        </header>

        <Card>
          <h2 className="text-sm font-semibold text-zinc-900">Summary</h2>
          <p className="mt-2 text-sm text-zinc-700">{summary.text}</p>
        </Card>

        <section className="grid gap-4 md:grid-cols-3">
          <Card className="p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Sync errors</p>
            <p className="mt-2 text-2xl font-semibold text-zinc-900">{errors.length}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Cron last run</p>
            <p className="mt-2 text-sm text-zinc-700">
              {cronLastRun ? new Date(cronLastRun).toLocaleString() : "Unknown"}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Last error</p>
            <p className="mt-2 text-sm text-zinc-700">
              {lastError?.error || "No recent errors"}
            </p>
          </Card>
        </section>

        <Card>
          <h2 className="text-sm font-semibold text-zinc-900">Recent sync issues</h2>
          <div className="mt-4 space-y-3">
            {errors.length === 0 ? (
              <p className="text-sm text-zinc-600">No sync issues logged.</p>
            ) : (
              errors.slice(0, 10).map((e: any, idx: number) => (
                <div key={`${e.appointmentId || "unknown"}-${idx}`} className="rounded-xl border border-zinc-200 p-4">
                  <p className="text-xs text-zinc-500">{e.ts ? new Date(e.ts).toLocaleString() : "Unknown time"}</p>
                  <p className="mt-1 text-sm text-zinc-800">{e.error || "Sync failed"}</p>
                  {e.appointmentId ? (
                    <p className="mt-1 text-xs text-zinc-500">Appointment: {e.appointmentId}</p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </main>
  );
}
