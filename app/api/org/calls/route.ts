// FILE MAP: app layout at app/layout.tsx; Retell webhook at app/api/webhooks/voice/[provider]/[orgId]/route.ts.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildDeterministicCallSummary, resolveCallerPhone } from "@/lib/calls/summary";
import { requireSessionOrgFeature } from "@/lib/entitlements";

export const runtime = "nodejs";

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

function asInt(value: string | null, fallback: number) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(1, Math.min(200, Math.floor(num))) : fallback;
}

export async function GET(req: Request) {
  const auth = await requireSessionOrgFeature("callsInbox");
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error, entitlements: auth.entitlements }, { status: auth.status });
  }

  const url = new URL(req.url);

  const cursor = url.searchParams.get("cursor") || "";
  const limit = asInt(url.searchParams.get("limit"), 60);

  const fromDate =
    parseDateParam(url.searchParams.get("from") ?? undefined) ??
    startOfDayLocal(new Date(Date.now() - 14 * 86400000));

  const toDate =
    parseDateParam(url.searchParams.get("to") ?? undefined, true) ??
    endOfDayLocal(new Date());

  const agentId = (url.searchParams.get("agent") || "").trim();
  const outcome = (url.searchParams.get("outcome") || "").trim().toUpperCase();
  const q = (url.searchParams.get("q") || "").trim();
  const riskRadarOnly = url.searchParams.get("riskRadar") === "true";

  const where = {
    orgId: auth.orgId,
    ...(agentId ? { agentId } : {}),
    ...(outcome ? { outcome: outcome as any } : {}),
    startedAt: { gte: fromDate, lte: toDate },
    ...(q
      ? {
          transcript: {
            contains: q,
            mode: "insensitive" as const,
          },
        }
      : {}),
  };

  const [rows, settings] = await Promise.all([
    prisma.callLog.findMany({
      where,
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        appointment: {
          select: {
            startsAt: true,
            service: { select: { name: true } },
            staff: { select: { name: true } },
            customer: { select: { profile: { select: { cancellationCount: true } } } },
          },
        },
      },
    }),
    prisma.orgSettings.findUnique({ where: { orgId: auth.orgId }, select: { data: true } }),
  ]);

  const data = (settings?.data as Record<string, unknown>) || {};
  const callsMeta = (data.calls as Record<string, unknown>) || {};
  const lastWebhookAt = typeof callsMeta.lastWebhookAt === "string" ? callsMeta.lastWebhookAt : null;

  const candidatePhones = Array.from(
    new Set(
      rows
        .map((row) => resolveCallerPhone(row.rawJson, row.callerPhone))
        .filter((p) => p && p.toLowerCase() !== "unknown")
    )
  );

  const missedCounts = new Map<string, number>();
  const rescheduleCounts = new Map<string, number>();
  if (candidatePhones.length) {
    const sinceMissed = new Date(Date.now() - 30 * 86400000);
    const sinceReschedule = new Date(Date.now() - 60 * 86400000);
    const [missedAgg, rescheduleAgg] = await Promise.all([
      prisma.callLog.groupBy({
        by: ["callerPhone"],
        where: {
          orgId: auth.orgId,
          callerPhone: { in: candidatePhones },
          outcome: "NO_ANSWER",
          startedAt: { gte: sinceMissed },
        },
        _count: { _all: true },
      }),
      prisma.callLog.groupBy({
        by: ["callerPhone"],
        where: {
          orgId: auth.orgId,
          callerPhone: { in: candidatePhones },
          startedAt: { gte: sinceReschedule },
          transcript: { contains: "resched", mode: "insensitive" },
        },
        _count: { _all: true },
      }),
    ]);
    missedAgg.forEach((row) => missedCounts.set(row.callerPhone, row._count._all));
    rescheduleAgg.forEach((row) => rescheduleCounts.set(row.callerPhone, row._count._all));
  }

  const items = rows.slice(0, limit).map((row) => {
    const callerPhone = resolveCallerPhone(row.rawJson, row.callerPhone);
    const cancellationCount = row.appointment?.customer?.profile?.cancellationCount ?? 0;
    const riskFlags: string[] = [];
    if (cancellationCount >= 2) riskFlags.push("High cancellations");
    if ((missedCounts.get(callerPhone) || 0) >= 2) riskFlags.push("Repeated missed calls");
    if ((rescheduleCounts.get(callerPhone) || 0) >= 2) riskFlags.push("Frequent reschedules");

    const summary = buildDeterministicCallSummary({
      callId: row.callId,
      callerPhone,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      outcome: row.outcome,
      appointmentId: row.appointmentId,
      transcript: row.transcript,
      rawJson: row.rawJson,
      appointment: row.appointment
        ? {
            startsAt: row.appointment.startsAt,
            serviceName: row.appointment.service?.name ?? null,
            staffName: row.appointment.staff?.name ?? null,
          }
        : null,
    });

    return {
      id: row.id,
      callId: row.callId,
      retellCallId: row.retellCallId,
      agentId: row.agentId,
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt ? row.endedAt.toISOString() : null,
      callerPhone,
      businessPhone: row.businessPhone ?? null,
      direction: row.direction,
      outcome: row.outcome,
      appointmentId: row.appointmentId,
      appointment: row.appointment
        ? {
            startsAt: row.appointment.startsAt.toISOString(),
            serviceName: row.appointment.service?.name ?? null,
            staffName: row.appointment.staff?.name ?? null,
          }
        : null,
      summary: row.summarySystem || summary.systemSummary,
      category: summary.category,
      priority: summary.priority,
      risk: summary.risk,
      reasons: summary.reasons,
      steps: summary.steps,
      fields: summary.fields,
      hasTranscript: Boolean(row.transcript),
      riskRadar: {
        flagged: riskFlags.length > 0,
        flags: riskFlags,
        cancellationCount,
      },
    };
  });

  const filteredItems = riskRadarOnly ? items.filter((item) => item.riskRadar.flagged) : items;

  const nextCursor = rows.length > limit ? rows[limit]?.id ?? null : null;

  return NextResponse.json({ ok: true, items: filteredItems, nextCursor, lastWebhookAt });
}
