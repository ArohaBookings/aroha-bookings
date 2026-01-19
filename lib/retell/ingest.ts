// FILE MAP: app layout at app/layout.tsx; Retell webhook at app/api/webhooks/voice/[provider]/[orgId]/route.ts.
import { prisma } from "@/lib/db";
import { normalizePhone } from "@/lib/retell/phone";
import type { Prisma } from "@prisma/client";

type RetellPayload = Record<string, unknown>;

export type RetellIngest = {
  callId: string;
  agentId: string;
  startedAt: Date;
  endedAt: Date | null;
  callerPhone: string | null;
  businessPhone: string | null;
  direction: "INBOUND" | "OUTBOUND";
  transcript: string | null;
  recordingUrl: string | null;
  outcome: "COMPLETED" | "NO_ANSWER" | "BUSY" | "FAILED" | "CANCELLED";
  appointmentId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  rawPayload: RetellPayload;
};

function firstString(...values: Array<unknown>): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mapOutcome(value: unknown): RetellIngest["outcome"] {
  const normalized = String(value || "").toLowerCase();
  if (/(no[_\s-]?answer|missed)/.test(normalized)) return "NO_ANSWER";
  if (/busy/.test(normalized)) return "BUSY";
  if (/(fail|error|hangup|dropped)/.test(normalized)) return "FAILED";
  if (/cancel/.test(normalized)) return "CANCELLED";
  return "COMPLETED";
}

export function parseRetellPayload(payload: RetellPayload, headers?: Headers): RetellIngest | null {
  const callObj = isRecord(payload["call"]) ? payload["call"] : null;
  const agentObj = isRecord(payload["agent"]) ? payload["agent"] : null;
  const dataObj = isRecord(payload["data"]) ? payload["data"] : null;
  const metaObj = isRecord(payload["metadata"]) ? payload["metadata"] : null;
  const customerObj = isRecord(payload["customer"]) ? payload["customer"] : null;

  const agentId =
    firstString(
      payload["agent_id"],
      payload["agentId"],
      agentObj?.["id"],
      callObj?.["agent_id"],
      callObj?.["agentId"]
    ) || headers?.get("x-retell-agent-id") || null;
  if (!agentId) return null;

  const callId = firstString(
    payload["call_id"],
    payload["callId"],
    payload["id"],
    callObj?.["id"],
    callObj?.["call_id"]
  );
  if (!callId) return null;

  const startedAt =
    parseDate(
      payload["started_at"] ||
        payload["start_time"] ||
        payload["startTime"] ||
        callObj?.["started_at"] ||
        callObj?.["start_time"]
    ) || new Date();
  const endedAt = parseDate(
    payload["ended_at"] ||
      payload["end_time"] ||
      payload["endTime"] ||
      callObj?.["ended_at"] ||
      callObj?.["end_time"]
  );

  const callerPhoneRaw = firstString(
    payload["caller_phone"],
    payload["callerPhone"],
    payload["from_number"],
    payload["from"],
    payload["phone"],
    callObj?.["from_number"],
    callObj?.["caller_phone"]
  );
  const callerPhone = normalizePhone(callerPhoneRaw);
  const businessPhoneRaw = firstString(
    payload["to_number"],
    payload["to"],
    payload["called_number"],
    callObj?.["to_number"],
    callObj?.["to"]
  );
  const businessPhone = normalizePhone(businessPhoneRaw);
  const directionRaw = firstString(payload["direction"], callObj?.["direction"]) || "INBOUND";
  const direction = directionRaw.toLowerCase().includes("out") ? "OUTBOUND" : "INBOUND";

  const transcript = firstString(payload["transcript"], callObj?.["transcript"], callObj?.["summary"]);
  const recordingUrl = firstString(payload["recording_url"], payload["recordingUrl"], callObj?.["recording_url"]);
  const outcome = mapOutcome(payload["outcome"] || payload["status"] || callObj?.["status"] || callObj?.["outcome"]);

  const appointmentId = firstString(
    payload["appointmentId"],
    payload["appointment_id"],
    payload["bookingId"],
    payload["booking_id"],
    dataObj?.["appointmentId"],
    dataObj?.["bookingId"],
    metaObj?.["appointmentId"],
    metaObj?.["bookingId"],
    metaObj?.["appointment_id"],
    metaObj?.["booking_id"]
  );

  const customerName = firstString(
    payload["caller_name"],
    payload["callerName"],
    customerObj?.["name"],
    payload["customer_name"],
    payload["customerName"]
  );
  const customerEmail = firstString(customerObj?.["email"], payload["customer_email"], payload["customerEmail"]);

  return {
    callId,
    agentId,
    startedAt,
    endedAt,
    callerPhone,
    businessPhone,
    direction,
    transcript,
    recordingUrl,
    outcome,
    appointmentId: appointmentId || null,
    customerName,
    customerEmail,
    rawPayload: payload,
  };
}

export async function upsertRetellCall(orgId: string, data: RetellIngest) {
  await prisma.$transaction(async (tx) => {
    let customerId: string | null = null;
    if (data.callerPhone) {
      const existing = await tx.customer.findUnique({
        where: { orgId_phone: { orgId, phone: data.callerPhone } },
        select: { id: true },
      });
      if (existing) {
        customerId = existing.id;
        if (data.customerName || data.customerEmail) {
          await tx.customer.update({
            where: { id: existing.id },
            data: {
              name: data.customerName ?? undefined,
              email: data.customerEmail ?? undefined,
            },
          });
        }
      } else if (data.customerName) {
        const created = await tx.customer.create({
          data: {
            orgId,
            name: data.customerName,
            phone: data.callerPhone,
            email: data.customerEmail ?? null,
          },
          select: { id: true },
        });
        customerId = created.id;
      }
    }

    let finalAppointmentId: string | null = data.appointmentId;
    if (finalAppointmentId) {
      const appt = await tx.appointment.findFirst({
        where: { id: finalAppointmentId, orgId },
        select: { id: true, customerId: true },
      });
      if (!appt) {
        finalAppointmentId = null;
      } else if (customerId && appt.customerId !== customerId) {
        await tx.appointment.update({
          where: { id: appt.id },
          data: {
            customerId,
            customerName: data.customerName ?? undefined,
            customerPhone: data.callerPhone || undefined,
            customerEmail: data.customerEmail ?? undefined,
          },
        });
      }
    }

    const existing = await tx.callLog.findFirst({
      where: {
        orgId,
        OR: [{ callId: data.callId }, { retellCallId: data.callId }],
      },
      select: { id: true },
    });

    const callData = {
      retellCallId: data.callId,
      agentId: data.agentId,
      callId: data.callId,
      startedAt: data.startedAt,
      endedAt: data.endedAt,
      callerPhone: data.callerPhone || "unknown",
      businessPhone: data.businessPhone || null,
      direction: data.direction,
      transcript: data.transcript,
      recordingUrl: data.recordingUrl,
      outcome: data.outcome,
      appointmentId: finalAppointmentId,
      rawJson: data.rawPayload as Prisma.InputJsonValue,
    } as const;

    if (existing) {
      await tx.callLog.update({
        where: { id: existing.id },
        data: callData,
      });
    } else {
      await tx.callLog.create({
        data: {
          orgId,
          ...callData,
        },
      });
    }
  });
}

export async function touchLastWebhook(orgId: string, at = new Date()) {
  const settings = await prisma.orgSettings.findUnique({
    where: { orgId },
    select: { data: true },
  });
  const data = (settings?.data as Record<string, unknown>) || {};
  const calls = (data.calls as Record<string, unknown>) || {};
  calls.lastWebhookAt = at.toISOString();
  calls.lastWebhookError = null;
  data.calls = calls;

  if (settings) {
    await prisma.orgSettings.update({
      where: { orgId },
      data: { data: data as Prisma.InputJsonValue },
    });
  } else {
    await prisma.orgSettings.create({
      data: { orgId, data: data as Prisma.InputJsonValue },
    });
  }
}

export async function touchLastWebhookError(orgId: string, message: string, at = new Date()) {
  const settings = await prisma.orgSettings.findUnique({
    where: { orgId },
    select: { data: true },
  });
  const data = (settings?.data as Record<string, unknown>) || {};
  const calls = (data.calls as Record<string, unknown>) || {};
  calls.lastWebhookError = message.slice(0, 300);
  calls.lastWebhookErrorAt = at.toISOString();
  data.calls = calls;

  if (settings) {
    await prisma.orgSettings.update({
      where: { orgId },
      data: { data: data as Prisma.InputJsonValue },
    });
  } else {
    await prisma.orgSettings.create({
      data: { orgId, data: data as Prisma.InputJsonValue },
    });
  }
}
