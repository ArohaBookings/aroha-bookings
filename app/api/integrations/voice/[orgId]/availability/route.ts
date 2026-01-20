import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAvailability } from "@/lib/availability/index";
import { verifyHmacSignature } from "@/lib/voice/signature";
import { readCallsSettings } from "@/lib/orgSettings";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type AvailabilityBody = {
  startISO: string;
  endISO: string;
  durationMin: number;
  staffId?: string;
  serviceId?: string;
};

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function readSignature(headers: Headers) {
  return (
    headers.get("x-aroha-signature") ||
    headers.get("x-voice-signature") ||
    headers.get("x-retell-signature") ||
    headers.get("signature")
  );
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const traceId = randomUUID();
  const { orgId } = await params;
  if (!orgId) return json({ ok: false, error: "Missing orgId", traceId }, 400);

  const rawBody = await req.text();
  if (!rawBody) return json({ ok: false, error: "Missing body", traceId }, 400);

  let body: AvailabilityBody | null = null;
  try {
    body = JSON.parse(rawBody) as AvailabilityBody;
  } catch {
    return json({ ok: false, error: "Invalid JSON", traceId }, 400);
  }

  const settings = await prisma.orgSettings.findUnique({
    where: { orgId },
    select: { data: true },
  });
  const data = (settings?.data as Record<string, unknown>) || {};
  const calls = readCallsSettings(data);
  if (!calls.bookingTools.enabled) {
    return json({ ok: false, error: "Booking tools disabled", traceId }, 403);
  }
  const secret = calls.retell.webhookSecret || calls.voiceSecret;
  if (!secret) return json({ ok: false, error: "Missing voice secret", traceId }, 401);

  const signature = readSignature(req.headers);
  const tsHeader = req.headers.get("x-aroha-timestamp") || req.headers.get("x-retell-timestamp");
  const signatureOk = verifyHmacSignature(rawBody, signature, secret, tsHeader);
  if (!signatureOk) {
    console.warn("[voice.availability] invalid signature", { orgId, traceId });
    return json({ ok: false, error: "Invalid signature", traceId }, 401);
  }

  const startISO = (body?.startISO || "").trim();
  const endISO = (body?.endISO || "").trim();
  const durationMin = Number(body?.durationMin ?? 0);
  const staffId = (body?.staffId || "").trim() || undefined;
  const serviceId = (body?.serviceId || "").trim() || undefined;

  if (!startISO || !endISO || !Number.isFinite(durationMin) || durationMin <= 0) {
    return json({ ok: false, error: "Missing startISO/endISO/durationMin", traceId }, 400);
  }

  const start = new Date(startISO);
  const end = new Date(endISO);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    return json({ ok: false, error: "Invalid time range", traceId }, 400);
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { timezone: true },
  });
  if (!org) return json({ ok: false, error: "Org not found", traceId }, 404);

  if (serviceId) {
    const service = await prisma.service.findFirst({
      where: { id: serviceId, orgId },
      select: { id: true },
    });
    if (!service) return json({ ok: false, error: "Service not found", traceId }, 404);
  }

  if (staffId) {
    const staff = await prisma.staffMember.findFirst({
      where: { id: staffId, orgId, active: true },
      select: { id: true },
    });
    if (!staff) return json({ ok: false, error: "Staff not found", traceId }, 404);
    if (serviceId) {
      const link = await prisma.staffService.findFirst({
        where: { staffId, serviceId },
        select: { id: true },
      });
      if (!link) return json({ ok: false, error: "Staff not assigned to service", traceId }, 400);
    }
  }

  const dataOut = await getAvailability({
    orgId,
    from: start,
    to: end,
    serviceId,
    staffId,
    durationMin,
    tz: org.timezone,
  });

  const slots = dataOut.slots
    .filter((s) => s.start >= start.toISOString() && s.end <= end.toISOString())
    .map((s) => ({ startISO: s.start, endISO: s.end }));

  console.info("[voice.availability]", { orgId, traceId, slots: slots.length });
  return json({ ok: true, slots, timezone: org.timezone, traceId });
}
