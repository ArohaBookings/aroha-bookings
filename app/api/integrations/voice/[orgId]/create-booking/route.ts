import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAvailability } from "@/lib/availability/index";
import { normalizePhone } from "@/lib/retell/phone";
import { createOrUpdateAppointmentEvent } from "@/lib/integrations/google/syncAppointment";
import { verifyHmacSignature } from "@/lib/voice/signature";
import { readCallsSettings } from "@/lib/orgSettings";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type CreateBookingBody = {
  startISO: string;
  durationMin: number;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  staffId?: string;
  serviceId?: string;
  notes?: string;
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

function isValidEmail(email?: string | null) {
  if (!email) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

  let body: CreateBookingBody | null = null;
  try {
    body = JSON.parse(rawBody) as CreateBookingBody;
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
    console.warn("[voice.create-booking] invalid signature", { orgId, traceId });
    return json({ ok: false, error: "Invalid signature", traceId }, 401);
  }

  const startISO = (body?.startISO || "").trim();
  const durationMin = Number(body?.durationMin ?? 0);
  const customerName = (body?.customerName || "").trim();
  const customerPhoneRaw = (body?.customerPhone || "").trim();
  const customerEmail = (body?.customerEmail || "").trim() || null;
  const staffId = (body?.staffId || "").trim() || undefined;
  const serviceId = (body?.serviceId || "").trim() || undefined;
  const notes = (body?.notes || "").trim();

  if (!startISO || !Number.isFinite(durationMin) || durationMin <= 0) {
    return json({ ok: false, error: "Missing startISO/durationMin", traceId }, 400);
  }
  if (!customerName || !customerPhoneRaw) {
    return json({ ok: false, error: "Missing customer details", traceId }, 400);
  }
  if (customerEmail && !isValidEmail(customerEmail)) {
    return json({ ok: false, error: "Invalid email address", traceId }, 400);
  }

  const start = new Date(startISO);
  if (Number.isNaN(start.getTime())) {
    return json({ ok: false, error: "Invalid startISO", traceId }, 400);
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, timezone: true, dashboardConfig: true },
  });
  if (!org) return json({ ok: false, error: "Org not found", traceId }, 404);

  const service = serviceId
    ? await prisma.service.findFirst({
        where: { id: serviceId, orgId },
        select: { id: true, durationMin: true, name: true },
      })
    : null;
  if (serviceId && !service) {
    return json({ ok: false, error: "Service not found", traceId }, 404);
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

  const effectiveDuration = service?.durationMin ?? durationMin;
  const end = new Date(start.getTime() + effectiveDuration * 60_000);

  const dayStart = new Date(start);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(start);
  dayEnd.setHours(23, 59, 59, 999);

  const availability = await getAvailability({
    orgId,
    from: dayStart,
    to: dayEnd,
    serviceId,
    staffId,
    durationMin: effectiveDuration,
    tz: org.timezone,
  });

  const slot = availability.slots.find(
    (s) => s.start === start.toISOString() && (!staffId || s.staffId === staffId)
  );
  if (!slot) {
    return json({ ok: false, error: "Selected time is no longer available", traceId }, 409);
  }

  const idempotencyKey = req.headers.get("Idempotency-Key")?.trim() || "";
  if (idempotencyKey) {
    const existing = await prisma.appointment.findFirst({
      where: {
        orgId,
        notes: { contains: `#voice-idem:${idempotencyKey}#` },
      },
      select: { id: true, startsAt: true, endsAt: true },
    });
    if (existing) {
      return json({
        ok: true,
        bookingId: existing.id,
        startsAtISO: existing.startsAt.toISOString(),
        endsAtISO: existing.endsAt.toISOString(),
        traceId,
      });
    }
  }

  const customerPhone = normalizePhone(customerPhoneRaw);

  const result = await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.upsert({
      where: { orgId_phone: { orgId, phone: customerPhone } },
      update: {
        name: customerName,
        email: customerEmail ?? undefined,
      },
      create: {
        orgId,
        name: customerName,
        phone: customerPhone,
        email: customerEmail ?? null,
      },
      select: { id: true, name: true, phone: true, email: true },
    });

    const idemMarker = idempotencyKey ? `\n#voice-idem:${idempotencyKey}#` : "";
    const notesCombined = [notes, idemMarker].filter(Boolean).join("\n").trim();

    const appt = await tx.appointment.create({
      data: {
        orgId,
        staffId: staffId ?? null,
        serviceId: service?.id ?? null,
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        customerEmail: customer.email,
        notes: notesCombined || null,
        startsAt: start,
        endsAt: end,
        source: "voice",
        status: "SCHEDULED",
      },
      select: { id: true, startsAt: true, endsAt: true },
    });

    return appt;
  });

  createOrUpdateAppointmentEvent(orgId, result.id).catch((err) =>
    console.error("[voice.create-booking] google sync failed:", err)
  );

  console.info("[voice.create-booking]", { orgId, traceId, bookingId: result.id });
  return json({
    ok: true,
    bookingId: result.id,
    startsAtISO: result.startsAt.toISOString(),
    endsAtISO: result.endsAt.toISOString(),
    traceId,
  });
}
