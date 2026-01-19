// FILE MAP: app layout at app/layout.tsx; Retell webhook at app/api/webhooks/voice/[provider]/[orgId]/route.ts.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { buildDeterministicCallSummary, resolveCallerPhone } from "@/lib/calls/summary";
import { requireSessionOrgFeature } from "@/lib/entitlements";

export const runtime = "nodejs";

const callItemSchema = z.object({
  id: z.string(),
  callId: z.string(),
  retellCallId: z.string().nullable().optional(),
  agentId: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  callerPhone: z.string(),
  businessPhone: z.string().nullable().optional(),
  direction: z.string().optional(),
  outcome: z.string(),
  appointmentId: z.string().nullable(),
  appointment: z
    .object({
      startsAt: z.string(),
      serviceName: z.string().nullable(),
      staffName: z.string().nullable(),
    })
    .nullable(),
  summary: z.string(),
  category: z.string(),
  priority: z.string(),
  risk: z.string(),
  reasons: z.array(z.string()),
  steps: z.array(z.string()),
  fields: z.record(z.string()),
  hasTranscript: z.boolean(),
  riskRadar: z
    .object({
      flagged: z.boolean(),
      flags: z.array(z.string()),
      cancellationCount: z.number(),
    })
    .optional(),
});

const listResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(callItemSchema),
  nextCursor: z.string().nullable(),
  lastWebhookAt: z.string().nullable().optional(),
});

function isAbortError(err: unknown) {
  const msg = String((err as any)?.message || "").toLowerCase();
  const code = (err as any)?.code as string | undefined;
  return code === "ECONNRESET" || msg.includes("aborted") || msg.includes("aborterror");
}

function getTimeZoneOffsetMs(timeZone: string, date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const map = new Map(parts.map((p) => [p.type, p.value]));
  const year = Number(map.get("year") || 0);
  const month = Number(map.get("month") || 1);
  const day = Number(map.get("day") || 1);
  const hour = Number(map.get("hour") || 0);
  const minute = Number(map.get("minute") || 0);
  const second = Number(map.get("second") || 0);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return asUtc - date.getTime();
}

function parseDateParam(raw: string | null, timeZone: string, end = false): Date | null {
  if (!raw) return null;
  const [yy, mm, dd] = raw.split("-").map((n) => Number(n));
  if (!yy || !mm || !dd) return null;
  const hour = end ? 23 : 0;
  const minute = end ? 59 : 0;
  const second = end ? 59 : 0;
  const ms = end ? 999 : 0;
  const baseUtc = new Date(Date.UTC(yy, mm - 1, dd, hour, minute, second, ms));
  try {
    const offsetMs = getTimeZoneOffsetMs(timeZone, baseUtc);
    return new Date(baseUtc.getTime() - offsetMs);
  } catch {
    return baseUtc;
  }
}

function formatYmd(date: Date, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const map = new Map(parts.map((p) => [p.type, p.value]));
    return `${map.get("year")}-${map.get("month")}-${map.get("day")}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function asInt(value: string | null, fallback: number) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(1, Math.min(200, Math.floor(num))) : fallback;
}

export async function GET(req: Request) {
  if (req.signal.aborted) {
    return NextResponse.json({ ok: false, error: "aborted" }, { status: 499 });
  }
  try {
  const auth = await requireSessionOrgFeature("callsInbox");
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error, entitlements: auth.entitlements }, { status: auth.status });
  }

  const url = new URL(req.url);

  const cursor = url.searchParams.get("cursor") || "";
  const limit = asInt(url.searchParams.get("limit"), 60);

  const org = await prisma.organization.findUnique({
    where: { id: auth.orgId },
    select: { timezone: true },
  });
  const tz = org?.timezone || "Pacific/Auckland";

  const defaultFromRaw = formatYmd(new Date(Date.now() - 14 * 86400000), tz);
  const defaultToRaw = formatYmd(new Date(), tz);

  const fromDate =
    parseDateParam(url.searchParams.get("from"), tz) ??
    parseDateParam(defaultFromRaw, tz) ??
    new Date(Date.now() - 14 * 86400000);

  const toDate =
    parseDateParam(url.searchParams.get("to"), tz, true) ??
    parseDateParam(defaultToRaw, tz, true) ??
    new Date();

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

  const payload = { ok: true, items: filteredItems, nextCursor, lastWebhookAt };
  const parsed = listResponseSchema.safeParse(payload);
  if (!parsed.success) {
    console.error("[calls.list] invalid response shape", parsed.error.flatten());
    return NextResponse.json({ ok: false, error: "Invalid response shape" }, { status: 500 });
  }

  return NextResponse.json(parsed.data);
  } catch (err) {
    if (req.signal.aborted || isAbortError(err)) {
      return NextResponse.json({ ok: false, error: "aborted" }, { status: 499 });
    }
    throw err;
  }
}
