// FILE MAP: app layout at app/layout.tsx; Retell webhook at app/api/webhooks/voice/[provider]/[orgId]/route.ts.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import React from "react";
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getOrgEntitlements } from "@/lib/entitlements";
import { Card } from "@/components/ui";
import CallsAnalyticsClient from "./CallsAnalyticsClient";
import { getBoolParam, getLowerParam, getParam, type SearchParams } from "@/lib/http/searchParams";

function toInputDate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default async function CallsAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<React.ReactElement> {
  const sp = (await searchParams) ?? {};
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    redirect(`/login?callbackUrl=${encodeURIComponent("/analytics/calls")}`);
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email! },
    include: { memberships: { include: { org: true } } },
  });
  const org = user?.memberships?.[0]?.org ?? null;

  if (!org) {
    return (
      <Card className="p-6">
        <h1 className="text-xl font-semibold">Call analytics</h1>
        <p className="mt-2 text-sm text-zinc-600">No organisation found for this account.</p>
      </Card>
    );
  }

  const entitlements = await getOrgEntitlements(org.id);
  if (!entitlements.features.analytics || !entitlements.features.callsInbox) {
    return (
      <Card className="p-6">
        <h1 className="text-xl font-semibold">Call analytics</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Call analytics is not included in your current plan.
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          Visit Settings to manage your plan or contact support for access.
        </p>
      </Card>
    );
  }

  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 86400000);
  const defaultTo = now;

  const agents = await prisma.callLog.findMany({
    where: { orgId: org.id },
    distinct: ["agentId"],
    select: { agentId: true },
    orderBy: { agentId: "asc" },
  });
  const staff = await prisma.staffMember.findMany({
    where: { orgId: org.id },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const services = await prisma.service.findMany({
    where: { orgId: org.id },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const settings = await prisma.orgSettings.findUnique({
    where: { orgId: org.id },
    select: { data: true },
  });
  const data = (settings?.data as Record<string, unknown>) || {};
  const callsAnalytics = (data.callsAnalytics as Record<string, unknown>) || {};

  return (
    <CallsAnalyticsClient
      orgName={org.name}
      orgSlug={org.slug}
      timezone={org.timezone || "Pacific/Auckland"}
      agents={agents.map((a) => a.agentId)}
      staffOptions={staff.map((s) => ({ id: s.id, name: s.name || "Staff" }))}
      serviceOptions={services.map((s) => ({ id: s.id, name: s.name }))}
      entitlements={entitlements}
      initialView={getLowerParam(sp, "view", "inbox")}
      initialFilters={{
        from: getParam(sp, "from") || toInputDate(defaultFrom),
        to: getParam(sp, "to") || toInputDate(defaultTo),
        agent: getParam(sp, "agent"),
        outcome: getParam(sp, "outcome"),
        q: getParam(sp, "q"),
        staffId: getParam(sp, "staffId"),
        serviceId: getParam(sp, "serviceId"),
        businessHoursOnly: getBoolParam(sp, "businessHoursOnly"),
        riskRadar: getBoolParam(sp, "riskRadar"),
      }}
      initialAiSummariesEnabled={Boolean(callsAnalytics.enableAiSummaries)}
    />
  );
}
