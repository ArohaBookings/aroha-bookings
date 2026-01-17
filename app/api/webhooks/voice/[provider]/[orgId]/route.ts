// app/api/webhooks/voice/[provider]/[orgId]/route.ts
import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db";
import { normalizePhone } from "@/lib/retell/phone";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/* ──────────────────────────────────────────────
   RATE LIMIT (best-effort, in-memory per IP)
────────────────────────────────────────────── */
const callsByIp = new Map<string, { last: number; count: number }>();
function rateLimit(ip: string, maxPerMinute = 180) {
  const now = Date.now();
  const m = callsByIp.get(ip) || { last: now, count: 0 };
  if (now - m.last > 60_000) {
    m.last = now;
    m.count = 0;
  }
  m.count++;
  callsByIp.set(ip, m);
  return m.count <= maxPerMinute;
}

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

function mapOutcome(value: unknown): "COMPLETED" | "NO_ANSWER" | "BUSY" | "FAILED" | "CANCELLED" {
  const normalized = String(value || "").toLowerCase();
  if (/(no[_\s-]?answer|missed)/.test(normalized)) return "NO_ANSWER";
  if (/busy/.test(normalized)) return "BUSY";
  if (/(fail|error|hangup|dropped)/.test(normalized)) return "FAILED";
  if (/cancel/.test(normalized)) return "CANCELLED";
  return "COMPLETED";
}

function parseSignatureHeader(header: string | null): { signatures: string[]; timestamp: string | null } {
  if (!header) return { signatures: [], timestamp: null };
  const parts = header.split(",").map((p) => p.trim()).filter(Boolean);
  const signatures: string[] = [];
  let timestamp: string | null = null;
  if (parts.length === 0) return { signatures, timestamp };
  for (const part of parts) {
    const [k, v] = part.split("=").map((s) => s.trim());
    if (!v) {
      signatures.push(part);
      continue;
    }
    if (k === "t") timestamp = v;
    if (k === "v1" || k === "sig" || k === "signature") signatures.push(v);
  }
  if (signatures.length === 0) signatures.push(header.trim());
  return { signatures, timestamp };
}

function safeCompare(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function verifySignature(rawBody: string, signatureHeader: string | null, secret: string, tsHeader: string | null) {
  if (!signatureHeader || !secret) return false;
  const { signatures, timestamp } = parseSignatureHeader(signatureHeader);
  const now = Date.now();
  const ts = timestamp || tsHeader;
  if (ts) {
    const tsMs = Number(ts) * 1000;
    if (!Number.isNaN(tsMs) && Math.abs(now - tsMs) > 5 * 60_000) return false;
  }

  const hmac = (input: string, encoding: "hex" | "base64") =>
    createHmac("sha256", secret).update(input).digest(encoding);
  const expectedHex = hmac(rawBody, "hex");
  const expectedBase64 = hmac(rawBody, "base64");

  return signatures.some((sig) => safeCompare(sig, expectedHex) || safeCompare(sig, expectedBase64));
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string; orgId: string }> }
) {
  try {
    const { provider, orgId } = await params;
    const providerKey = (provider || "").toLowerCase();

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      (req as { ip?: string }).ip ||
      "0.0.0.0";
    if (!rateLimit(ip, 180)) {
      return NextResponse.json({ ok: false, error: "Rate limit" }, { status: 429 });
    }

    const rawBody = await req.text();
    if (!rawBody) {
      return NextResponse.json({ ok: false, error: "Missing body" }, { status: 400 });
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    if (providerKey !== "retell") {
      return NextResponse.json({ ok: false, error: "Unsupported provider" }, { status: 400 });
    }

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
      ) || req.headers.get("x-retell-agent-id");
    if (!agentId) {
      return NextResponse.json({ ok: false, error: "Missing agentId" }, { status: 400 });
    }

    const connection = await prisma.retellConnection.findFirst({
      where: { orgId, agentId, active: true },
      select: { orgId: true, webhookSecret: true },
    });
    if (!connection) {
      return NextResponse.json({ ok: false, error: "Unknown agent" }, { status: 401 });
    }

    const signatureHeader =
      req.headers.get("x-retell-signature") || req.headers.get("retell-signature");
    const tsHeader = req.headers.get("x-retell-timestamp");
    if (!verifySignature(rawBody, signatureHeader, connection.webhookSecret, tsHeader)) {
      return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
    }

    const callId = firstString(
      payload["call_id"],
      payload["callId"],
      payload["id"],
      callObj?.["id"],
      callObj?.["call_id"]
    );
    if (!callId) {
      return NextResponse.json({ ok: false, error: "Missing callId" }, { status: 400 });
    }

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

    const transcript = firstString(
      payload["transcript"],
      callObj?.["transcript"],
      callObj?.["summary"]
    );
    const recordingUrl = firstString(
      payload["recording_url"],
      payload["recordingUrl"],
      callObj?.["recording_url"]
    );

    const outcome = mapOutcome(
      payload["outcome"] || payload["status"] || callObj?.["status"] || callObj?.["outcome"]
    );

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
    const customerEmail = firstString(
      customerObj?.["email"],
      payload["customer_email"],
      payload["customerEmail"]
    );

    await prisma.$transaction(async (tx) => {
      let customerId: string | null = null;
      if (callerPhone) {
        const existing = await tx.customer.findUnique({
          where: { orgId_phone: { orgId: connection.orgId, phone: callerPhone } },
          select: { id: true },
        });
        if (existing) {
          customerId = existing.id;
          if (customerName || customerEmail) {
            await tx.customer.update({
              where: { id: existing.id },
              data: {
                name: customerName ?? undefined,
                email: customerEmail ?? undefined,
              },
            });
          }
        } else if (customerName) {
          const created = await tx.customer.create({
            data: {
              orgId: connection.orgId,
              name: customerName,
              phone: callerPhone,
              email: customerEmail ?? null,
            },
            select: { id: true },
          });
          customerId = created.id;
        }
      }

      let finalAppointmentId: string | null = appointmentId;
      if (finalAppointmentId) {
        const appt = await tx.appointment.findFirst({
          where: { id: finalAppointmentId, orgId: connection.orgId },
          select: { id: true, customerId: true },
        });
        if (!appt) {
          finalAppointmentId = null;
        } else if (customerId && appt.customerId !== customerId) {
          await tx.appointment.update({
            where: { id: appt.id },
            data: {
              customerId,
              customerName: customerName ?? undefined,
              customerPhone: callerPhone || undefined,
              customerEmail: customerEmail ?? undefined,
            },
          });
        }
      }

      await tx.callLog.upsert({
        where: { callId },
        create: {
          orgId: connection.orgId,
          agentId,
          callId,
          startedAt,
          endedAt,
          callerPhone: callerPhone || "unknown",
          transcript: transcript ?? null,
          recordingUrl: recordingUrl ?? null,
          outcome,
          appointmentId: finalAppointmentId,
          rawJson: payload as Prisma.InputJsonValue,
        },
        update: {
          agentId,
          startedAt,
          endedAt,
          callerPhone: callerPhone || "unknown",
          transcript: transcript ?? null,
          recordingUrl: recordingUrl ?? null,
          outcome,
          appointmentId: finalAppointmentId,
          rawJson: payload as Prisma.InputJsonValue,
        },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    console.error("voice.webhook error:", e);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
