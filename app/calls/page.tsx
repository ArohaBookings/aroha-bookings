// app/calls/page.tsx
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import React from "react";
import { prisma } from "@/lib/db";
import { Prisma, CallOutcome } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import CallsClient, { type CallRow } from "./CallsClient";
import { resolveCallerPhone } from "@/lib/calls/summary";
import { getOrgEntitlements } from "@/lib/entitlements";
import { getParam, resolveSearchParams, type SearchParams as SharedSearchParams } from "@/lib/http/searchParams";

type SearchParams = {
  from?: string;
  to?: string;
  agent?: string;
  outcome?: string;
  q?: string;
};

function toInputDate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function startOfDayLocal(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDayLocal(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function parseDateParam(raw?: string, end = false): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return end ? endOfDayLocal(d) : startOfDayLocal(d);
}

function parseOutcome(raw?: string): CallOutcome | undefined {
  const v = (raw || "").trim().toUpperCase();
  if (!v) return undefined;
  return (Object.values(CallOutcome) as string[]).includes(v) ? (v as CallOutcome) : undefined;
}

export default async function CallsPage({
  searchParams,
}: {
  searchParams: SearchParams | SharedSearchParams | Promise<SearchParams>;
}): Promise<React.ReactElement> {
  const params = await resolveSearchParams(searchParams as SharedSearchParams);

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/api/auth/signin");

  const user = await prisma.user.findUnique({
    where: { email: session.user.email! },
    include: { memberships: { include: { org: true } } },
  });
  const org = user?.memberships?.[0]?.org ?? null;

  if (!org) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Calls</h1>
        <p className="mt-2 text-sm text-zinc-600">No organisation found for this account.</p>
      </div>
    );
  }

  const entitlements = await getOrgEntitlements(org.id);
  if (!entitlements.features.calls && !entitlements.features.aiReceptionist) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">AI Receptionist</h1>
        <p className="mt-2 text-sm text-zinc-600">
          AI Receptionist is not included in your current plan.
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          Contact your admin to enable AI Receptionist, or upgrade your plan.
        </p>
      </div>
    );
  }

  const now = new Date();
  const defaultFrom = startOfDayLocal(new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000));
  const fromDate = parseDateParam(getParam(params, "from")) ?? defaultFrom;
  const toDate = parseDateParam(getParam(params, "to"), true) ?? endOfDayLocal(now);
  const agentId = getParam(params, "agent").trim();
  const outcome = parseOutcome(getParam(params, "outcome"));
  const search = getParam(params, "q").trim();

  const where: Prisma.CallLogWhereInput = {
    orgId: org.id,
    ...(agentId ? { agentId } : {}),
    ...(outcome ? { outcome } : {}),
    startedAt: { gte: fromDate, lte: toDate },
    ...(search
      ? {
          transcript: {
            contains: search,
            mode: "insensitive",
          },
        }
      : {}),
  };

  const [callLogs, agents] = await Promise.all([
    prisma.callLog.findMany({
      where,
      orderBy: { startedAt: "desc" },
      take: 200,
      include: {
        appointment: {
          select: {
            id: true,
            startsAt: true,
            endsAt: true,
            customerName: true,
            service: { select: { name: true } },
            staff: { select: { name: true } },
          },
        },
      },
    }),
    prisma.callLog.findMany({
      where: { orgId: org.id },
      distinct: ["agentId"],
      select: { agentId: true },
      orderBy: { agentId: "asc" },
    }),
  ]);

  const calls: CallRow[] = callLogs.map((row) => ({
    id: row.id,
    callId: row.callId,
    agentId: row.agentId,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    callerPhone: resolveCallerPhone(row.rawJson, row.callerPhone),
    businessPhone: row.businessPhone ?? null,
    transcript: row.transcript,
    recordingUrl: row.recordingUrl,
    outcome: row.outcome,
    appointmentId: row.appointmentId,
    rawJson: row.rawJson,
    appointment: row.appointment
      ? {
          id: row.appointment.id,
          startsAt: row.appointment.startsAt.toISOString(),
          endsAt: row.appointment.endsAt.toISOString(),
          customerName: row.appointment.customerName,
          serviceName: row.appointment.service?.name ?? null,
          staffName: row.appointment.staff?.name ?? null,
        }
      : null,
  }));

  return (
    <CallsClient
      orgName={org.name}
      calls={calls}
      agents={agents.map((a) => a.agentId)}
      filters={{
        from: toInputDate(fromDate),
        to: toInputDate(toDate),
        agent: agentId,
        outcome: outcome ?? "",
        q: search,
      }}
    />
  );
}
