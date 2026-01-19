// FILE MAP: app layout at app/layout.tsx; Retell webhook at app/api/webhooks/voice/[provider]/[orgId]/route.ts.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import React from "react";
import { prisma } from "@/lib/db";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { getOrgEntitlements } from "@/lib/entitlements";
import { Card } from "@/components/ui";
import StatCard from "@/components/StatCard";

const AI_SOURCES = ["ai", "email_ai", "call_ai"];
const AVG_HANDLE_MIN = 6;

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "NZD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function MiniBars({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  return (
    <svg viewBox="0 0 120 32" className="h-8 w-full" role="img" aria-label="Impact trend">
      {values.map((value, idx) => {
        const height = Math.max(4, Math.round((value / max) * 28));
        const x = 8 + idx * 36;
        const y = 30 - height;
        return <rect key={idx} x={x} y={y} width="20" height={height} rx="4" fill="var(--brand-primary)" />;
      })}
    </svg>
  );
}

export default async function ImpactPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/api/auth/signin");

  const membership = await prisma.membership.findFirst({
    where: { user: { email: session.user.email } },
    select: { org: { select: { id: true, name: true, slug: true } }, orgId: true },
    orderBy: { orgId: "asc" },
  });
  const org = membership?.org ?? null;
  if (!org) {
    return (
      <Card className="p-6">
        <h1 className="text-xl font-semibold">Revenue impact</h1>
        <p className="mt-2 text-sm text-zinc-600">No organisation found for this account.</p>
      </Card>
    );
  }

  const entitlements = await getOrgEntitlements(org.id);
  if (!entitlements.features.dashboards) {
    return (
      <Card className="p-6">
        <h1 className="text-xl font-semibold">Revenue impact</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Impact insights are not included in your current plan.
        </p>
      </Card>
    );
  }

  const now = new Date();
  const start7 = new Date(now.getTime() - 7 * 86400000);
  const start30 = new Date(now.getTime() - 30 * 86400000);

  const [bookings7, bookings30, aiAppointments7, aiAppointments30] = await Promise.all([
    prisma.appointment.count({ where: { orgId: org.id, createdAt: { gte: start7 } } }),
    prisma.appointment.count({ where: { orgId: org.id, createdAt: { gte: start30 } } }),
    prisma.appointment.findMany({
      where: { orgId: org.id, createdAt: { gte: start7 }, source: { in: AI_SOURCES } },
      select: { service: { select: { priceCents: true } } },
    }),
    prisma.appointment.findMany({
      where: { orgId: org.id, createdAt: { gte: start30 }, source: { in: AI_SOURCES } },
      select: { service: { select: { priceCents: true } } },
    }),
  ]);

  const value7 = aiAppointments7.reduce((sum, a) => sum + (a.service?.priceCents ?? 0), 0);
  const value30 = aiAppointments30.reduce((sum, a) => sum + (a.service?.priceCents ?? 0), 0);
  const aiCount30 = aiAppointments30.length;
  const timeSavedMin = aiCount30 * AVG_HANDLE_MIN;

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Revenue impact</p>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
          Impact for {org.name}
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          Estimates based on AI-handled bookings and service pricing.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <StatCard label="Bookings created · 7d" value={bookings7} accent="emerald" />
        <StatCard label="Bookings created · 30d" value={bookings30} accent="sky" />
        <StatCard label="AI time saved · 30d" value={`${timeSavedMin} min`} accent="amber" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">AI revenue impact</p>
              <p className="mt-2 text-2xl font-semibold text-zinc-900">{formatCurrency(value30)}</p>
              <p className="text-xs text-zinc-500">Last 30 days</p>
            </div>
            <div className="w-32">
              <MiniBars values={[value7, value30]} />
            </div>
          </div>
          <div className="mt-3 text-xs text-zinc-500">
            Bookings sourced from AI / email AI / call AI.
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">AI-handled bookings</p>
              <p className="mt-2 text-2xl font-semibold text-zinc-900">{aiCount30}</p>
              <p className="text-xs text-zinc-500">Last 30 days</p>
            </div>
            <div className="w-32">
              <MiniBars values={[aiAppointments7.length, aiCount30]} />
            </div>
          </div>
          <div className="mt-3 text-xs text-zinc-500">
            Time saved assumes {AVG_HANDLE_MIN} minutes per AI-handled interaction.
          </div>
        </Card>
      </div>
    </div>
  );
}
