// FILE MAP: app layout at app/layout.tsx; Retell webhook at app/api/webhooks/voice/[provider]/[orgId]/route.ts.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { buildDeterministicCallSummary, resolveCallerPhone } from "@/lib/calls/summary";
import { rewriteCallSummary } from "@/lib/ai/calls";
import { getGlobalControls, requireSessionOrgFeature } from "@/lib/entitlements";

export const runtime = "nodejs";

const detailResponseSchema = z.object({
  ok: z.literal(true),
  call: z.object({
    id: z.string(),
    callId: z.string(),
    businessPhone: z.string().nullable().optional(),
    direction: z.string().nullable().optional(),
    agentId: z.string(),
    startedAt: z.string(),
    endedAt: z.string().nullable(),
    callerPhone: z.string(),
    outcome: z.string(),
    appointmentId: z.string().nullable(),
    appointment: z
      .object({
        id: z.string(),
        startsAt: z.string(),
        endsAt: z.string(),
        customerName: z.string(),
        customerId: z.string().nullable().optional(),
        serviceName: z.string().nullable(),
        staffName: z.string().nullable(),
      })
      .nullable(),
    transcript: z.string().nullable(),
    recordingUrl: z.string().nullable(),
    rawJson: z.unknown(),
    summary: z.object({
      system: z.string(),
      ai: z.string().nullable(),
      aiEnabled: z.boolean(),
    }),
    category: z.string(),
    priority: z.string(),
    risk: z.string(),
    reasons: z.array(z.string()),
    steps: z.array(z.string()),
    fields: z.record(z.string()),
  }),
});

function readAiToggle(data: Record<string, unknown>) {
  const callsAnalytics = (data.callsAnalytics as Record<string, unknown>) || {};
  return Boolean(callsAnalytics.enableAiSummaries);
}

function isAbortError(err: unknown) {
  const msg = String((err as any)?.message || "").toLowerCase();
  const code = (err as any)?.code as string | undefined;
  return code === "ECONNRESET" || msg.includes("aborted") || msg.includes("aborterror");
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (req.signal.aborted) {
    return NextResponse.json({ ok: false, error: "aborted" }, { status: 499 });
  }
  try {
  const auth = await requireSessionOrgFeature("callsInbox");
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error, entitlements: auth.entitlements }, { status: auth.status });
  }

  const { id } = await params;
  const row = await prisma.callLog.findFirst({
    where: {
      orgId: auth.orgId,
      OR: [{ id }, { callId: id }],
    },
    include: {
      appointment: {
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          customerName: true,
          customerId: true,
          service: { select: { name: true } },
          staff: { select: { name: true } },
        },
      },
      org: { select: { name: true } },
    },
  });

  if (!row) {
    return NextResponse.json({ ok: false, error: "Call not found" }, { status: 404 });
  }

  const [settings, globalControls] = await Promise.all([
    prisma.orgSettings.findUnique({
      where: { orgId: auth.orgId },
      select: { data: true },
    }),
    getGlobalControls(),
  ]);
  const data = (settings?.data as Record<string, unknown>) || {};
  const aiEnabled = readAiToggle(data) && !globalControls.disableAiSummariesAll;

  const summary = buildDeterministicCallSummary({
    callId: row.callId,
    callerPhone: resolveCallerPhone(row.rawJson, row.callerPhone),
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

  // Escape hatch: Prisma row type might not include newly added fields yet (schema/select mismatch).
  // This keeps runtime logic identical while unblocking strict TS.
  const call = row as typeof row & {
    summarySystem?: string | null;
    summaryAi?: string | null;
    summaryUpdatedAt?: Date | null;
    summaryJobStatus?: string | null;
    businessPhone?: string | null;
    direction?: string | null;
  };

  if (!call.summarySystem) {
    await prisma.callLog.update({
      where: { id: call.id } as any,
      data: {
        summarySystem: summary.systemSummary,
        summaryUpdatedAt: new Date(),
      } as any,
    });
  }

  let aiSummary: string | null = call.summaryAi ?? null;
  const transcript = call.transcript?.trim() || "";
  if (aiEnabled && transcript && !aiSummary) {
    const locked = await prisma.callLog.updateMany({
      where: { id: call.id, summaryAi: null, summaryJobStatus: null } as any,
      data: { summaryJobStatus: "RUNNING", summaryUpdatedAt: new Date() } as any,
    });

    if (locked.count === 1) {
      try {
        const rewritten = await rewriteCallSummary({
          orgName: call.org?.name || "your business",
          systemSummary: summary.systemSummary,
        });

        aiSummary = rewritten.ai ? rewritten.text : null;
        if (aiSummary) {
          await prisma.callLog.update({
            where: { id: call.id, summaryAi: null } as any,
            data: { summaryAi: aiSummary, summaryUpdatedAt: new Date(), summaryJobStatus: "DONE" } as any,
          });
        } else {
          await prisma.callLog.update({
            where: { id: call.id } as any,
            data: { summaryJobStatus: "SKIPPED" } as any,
          });
        }
      } catch {
        await prisma.callLog.update({
          where: { id: call.id } as any,
          data: { summaryJobStatus: "FAILED" } as any,
        });
      }
    }
  }

  const payload = {
    ok: true,
    call: {
      id: call.id,
      callId: call.callId,
      businessPhone: call.businessPhone ?? null,
      direction: call.direction,
      agentId: call.agentId,
      startedAt: call.startedAt.toISOString(),
      endedAt: call.endedAt ? call.endedAt.toISOString() : null,
      callerPhone: resolveCallerPhone(call.rawJson, call.callerPhone),
      outcome: call.outcome,
      appointmentId: call.appointmentId,
      appointment: call.appointment
        ? {
            id: call.appointment.id,
            startsAt: call.appointment.startsAt.toISOString(),
            endsAt: call.appointment.endsAt.toISOString(),
            customerName: call.appointment.customerName,
            customerId: call.appointment.customerId,
            serviceName: call.appointment.service?.name ?? null,
            staffName: call.appointment.staff?.name ?? null,
          }
        : null,
      transcript: call.transcript,
      recordingUrl: call.recordingUrl,
      rawJson: call.rawJson,
      summary: {
        system: call.summarySystem || summary.systemSummary,
        ai: call.summaryAi || aiSummary,
        aiEnabled,
      },
      category: summary.category,
      priority: summary.priority,
      risk: summary.risk,
      reasons: summary.reasons,
      steps: summary.steps,
      fields: summary.fields,
    },
  };
  const parsed = detailResponseSchema.safeParse(payload);
  if (!parsed.success) {
    console.error("[calls.detail] invalid response shape", parsed.error.flatten());
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
