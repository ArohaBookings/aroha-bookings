// FILE MAP: app layout at app/layout.tsx; Retell webhook at app/api/webhooks/voice/[provider]/[orgId]/route.ts.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizePhone } from "@/lib/retell/phone";
import { requireSessionOrgFeature } from "@/lib/entitlements";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function firstString(...values: Array<unknown>): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mapOutcome(value: unknown): "COMPLETED" | "NO_ANSWER" | "BUSY" | "FAILED" | "CANCELLED" {
  const normalized = String(value || "").toLowerCase();
  if (/(no[_\s-]?answer|missed)/.test(normalized)) return "NO_ANSWER";
  if (/busy/.test(normalized)) return "BUSY";
  if (/(fail|error|hangup|dropped)/.test(normalized)) return "FAILED";
  if (/cancel/.test(normalized)) return "CANCELLED";
  return "COMPLETED";
}

export async function POST(req: Request) {
  const auth = await requireSessionOrgFeature("callsInbox");
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const connection = await prisma.retellConnection.findFirst({
    where: { orgId: auth.orgId, active: true },
    select: { agentId: true, apiKeyEncrypted: true },
  });
  if (!connection?.agentId) {
    return NextResponse.json({ ok: false, error: "No Retell connection found" }, { status: 400 });
  }

  const apiKey = connection.apiKeyEncrypted || process.env.RETELL_API_KEY || "";
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Missing Retell API key" }, { status: 400 });
  }

  let data: any;
  try {
    const res = await fetch(`https://api.retellai.com/v2/calls?agent_id=${connection.agentId}&limit=50`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: data?.error || "Failed to fetch calls" }, { status: 502 });
    }
  } catch (err) {
    return NextResponse.json({ ok: false, error: "Retell fetch failed" }, { status: 502 });
  }

  const calls = Array.isArray(data?.calls) ? data.calls : Array.isArray(data) ? data : [];
  let upserted = 0;

  for (const call of calls) {
    if (!call || typeof call !== "object") continue;
    const callId = firstString(call.id, call.call_id, call.callId);
    if (!callId) continue;

    const startedAt = parseDate(call.started_at || call.start_time || call.startTime) || new Date();
    const endedAt = parseDate(call.ended_at || call.end_time || call.endTime);

    const callerPhone = normalizePhone(firstString(call.from_number, call.from, call.caller_phone, call.callerPhone));
    const businessPhone = normalizePhone(firstString(call.to_number, call.to, call.called_number));

    const directionRaw = firstString(call.direction) || "INBOUND";
    const direction = directionRaw.toLowerCase().includes("out") ? "OUTBOUND" : "INBOUND";

    const transcript = firstString(call.transcript, call.summary);
    const recordingUrl = firstString(call.recording_url, call.recordingUrl);
    const outcome = mapOutcome(call.outcome || call.status);

const existing = await prisma.callLog.findUnique({
  where: { callId },
  // cast because retellCallId might not exist in the generated Prisma client yet
  select: { id: true } as any,
});

if (existing) {
  await prisma.callLog.update({
    where: { id: existing.id },
    data: {
      // always set it (idempotent) — no need to read existing.retellCallId
      retellCallId: callId,
      agentId: connection.agentId,
      startedAt,
      endedAt,
      callerPhone: callerPhone || "unknown",
      businessPhone: businessPhone || null,
      direction,
      transcript: transcript ?? null,
      recordingUrl: recordingUrl ?? null,
      outcome,
      rawJson: call as Prisma.InputJsonValue,
    } as any,
  });
} else {
  await prisma.callLog.upsert({
    where: { retellCallId: callId } as any,
    create: {
      orgId: auth.orgId,
      agentId: connection.agentId,
      callId,
      retellCallId: callId,
      startedAt,
      endedAt,
      callerPhone: callerPhone || "unknown",
      businessPhone: businessPhone || null,
      direction,
      transcript: transcript ?? null,
      recordingUrl: recordingUrl ?? null,
      outcome,
      appointmentId: null,
      rawJson: call as Prisma.InputJsonValue,
    } as any,
    update: {
      agentId: connection.agentId,
      startedAt,
      endedAt,
      callerPhone: callerPhone || "unknown",
      businessPhone: businessPhone || null,
      direction,
      transcript: transcript ?? null,
      recordingUrl: recordingUrl ?? null,
      outcome,
      rawJson: call as Prisma.InputJsonValue,
    } as any,
  });
}

upserted++;
}

return NextResponse.json({ ok: true, upserted });
}
