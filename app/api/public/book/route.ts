// app/api/public/book/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizePhone } from "@/lib/retell/phone";
import { getAvailability } from "@/lib/availability/index";
import { createOrUpdateAppointmentEvent } from "@/lib/integrations/google/syncAppointment";
import { sendBookingConfirmationEmail } from "@/lib/notifications";
import { appendManageToken, issueManageToken, type ManageTokenRecord } from "@/lib/manage/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const callsByIp = new Map<string, { last: number; count: number }>();
function rateLimit(ip: string, maxPerMinute = 40) {
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

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function isValidEmail(email?: string | null) {
  if (!email) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone: string) {
  const digits = phone.replace(/\D+/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

function intentMarker(id: string) {
  return `#intent:${id}#`;
}

async function storeManageToken(orgId: string, appointmentId: string, record: ManageTokenRecord) {
  const existing = await prisma.orgSettings.upsert({
    where: { orgId },
    create: { orgId, data: {} as any },
    update: {},
    select: { data: true },
  });
  const data = (existing?.data as Record<string, unknown>) || {};
  const next = appendManageToken(data, appointmentId, record);
  await prisma.orgSettings.update({
    where: { orgId },
    data: { data: next as any },
  });
}

export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    (req as { ip?: string }).ip ||
    "0.0.0.0";
  if (!rateLimit(ip, 50)) {
    return json({ ok: false, error: "Rate limit" }, 429);
  }

  const body = (await req.json().catch(() => ({}))) as {
    orgSlug?: string;
    serviceId?: string;
    staffId?: string | null;
    startISO?: string;
    bookingIntentId?: string;
    customer?: {
      name?: string;
      phone?: string;
      email?: string | null;
      notes?: string | null;
    };
    honeypot?: string;
  };

  if (body.honeypot) {
    return json({ ok: false, error: "Invalid submission" }, 400);
  }

  const orgSlug = (body.orgSlug || "").trim();
  const serviceId = (body.serviceId || "").trim();
  const staffId = (body.staffId || "").trim() || null;
  const startISO = (body.startISO || "").trim();
  const bookingIntentId = (body.bookingIntentId || "").trim();
  const customerName = (body.customer?.name || "").trim();
  const customerPhoneRaw = (body.customer?.phone || "").trim();
  const customerEmail = (body.customer?.email || "").trim() || null;
  const customerNotes = (body.customer?.notes || "").trim();

  if (!orgSlug || !serviceId || !startISO || !bookingIntentId) {
    return json({ ok: false, error: "Missing required fields" }, 400);
  }
  if (!customerName || !customerPhoneRaw) {
    return json({ ok: false, error: "Missing customer details" }, 400);
  }

  const start = new Date(startISO);
  if (Number.isNaN(start.getTime())) {
    return json({ ok: false, error: "Invalid start time" }, 400);
  }

  const org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    select: { id: true, name: true, timezone: true, dashboardConfig: true, address: true },
  });
  if (!org) {
    return json({ ok: false, error: "Organization not found" }, 404);
  }

  const online = (org.dashboardConfig as Record<string, unknown>)?.onlineBooking as
    | Record<string, unknown>
    | undefined;
  const bookingRules = (org.dashboardConfig as Record<string, unknown>)?.bookingRules as
    | Record<string, unknown>
    | undefined;
  const allowOverlaps = Boolean(bookingRules?.allowOverlaps);
  const bufferBeforeMin = Number(bookingRules?.bufferBeforeMin ?? 0) || 0;
  const bufferAfterMin = Number(bookingRules?.bufferAfterMin ?? 0) || 0;

  if (online && online.enabled === false) {
    return json({ ok: false, error: "Online booking disabled" }, 403);
  }

  const service = await prisma.service.findFirst({
    where: { id: serviceId, orgId: org.id },
    select: { id: true, durationMin: true, name: true },
  });
  if (!service) {
    return json({ ok: false, error: "Service not found" }, 404);
  }

  if (customerEmail && !isValidEmail(customerEmail)) {
    return json({ ok: false, error: "Invalid email address" }, 400);
  }

  const customerPhone = normalizePhone(customerPhoneRaw);
  if (!isValidPhone(customerPhone)) {
    return json({ ok: false, error: "Invalid phone number" }, 400);
  }

  const dayStart = new Date(start);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(start);
  dayEnd.setHours(23, 59, 59, 999);

  const availability = await getAvailability({
    orgId: org.id,
    from: dayStart,
    to: dayEnd,
    serviceId,
    staffId: staffId ?? undefined,
    tz: org.timezone,
  });

  const slot = availability.slots.find(
    (s) => s.start === start.toISOString() && (!staffId || s.staffId === staffId)
  );
  if (!slot) {
    return json({ ok: false, error: "Selected time is no longer available" }, 409);
  }

  const finalStaffId = staffId || slot.staffId || null;
  if (finalStaffId) {
    const staff = await prisma.staffMember.findFirst({
      where: { id: finalStaffId, orgId: org.id, active: true },
      select: { id: true },
    });
    if (!staff) {
      return json({ ok: false, error: "Staff not available" }, 400);
    }
  }

  const end = new Date(slot.end);
  const startBuffered = new Date(start.getTime() - bufferBeforeMin * 60_000);
  const endBuffered = new Date(end.getTime() + bufferAfterMin * 60_000);
  const marker = intentMarker(bookingIntentId);

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.appointment.findFirst({
      where: {
        orgId: org.id,
        source: "online",
        notes: { contains: marker },
      },
      select: { id: true, startsAt: true, endsAt: true },
    });
    if (existing) {
      return { duplicate: true, appointmentId: existing.id };
    }

    if (!allowOverlaps) {
      const overlap = await tx.appointment.count({
        where: {
          orgId: org.id,
          staffId: finalStaffId,
          status: { not: "CANCELLED" },
          startsAt: { lt: endBuffered },
          endsAt: { gt: startBuffered },
        },
      });
      if (overlap > 0) {
        return { duplicate: false, appointmentId: null, conflict: true };
      }
    }

    const customer = await tx.customer.upsert({
      where: { orgId_phone: { orgId: org.id, phone: customerPhone } },
      update: {
        name: customerName,
        email: customerEmail ?? undefined,
      },
      create: {
        orgId: org.id,
        name: customerName,
        phone: customerPhone,
        email: customerEmail,
      },
      select: { id: true, name: true, phone: true, email: true },
    });

    const notes = [customerNotes, marker].filter(Boolean).join("\n");

    const appt = await tx.appointment.create({
      data: {
        orgId: org.id,
        staffId: finalStaffId,
        serviceId: service.id,
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        customerEmail: customer.email,
        startsAt: start,
        endsAt: end,
        source: "online",
        status: "SCHEDULED",
        notes: notes || null,
      },
      select: { id: true, startsAt: true, endsAt: true },
    });

    return { duplicate: false, appointmentId: appt.id, conflict: false };
  });

  if ((result as any).conflict) {
    return json({ ok: false, error: "Selected time is no longer available" }, 409);
  }

  let manageToken: string | null = null;

  if (result.appointmentId) {
    createOrUpdateAppointmentEvent(org.id, result.appointmentId).catch((err) =>
      console.error("google-sync(public-book) error:", err)
    );

    // FIX: use the exact key expected by your token helper
    const issued = issueManageToken({
      appointmentId: result.appointmentId,
      bookingIntentId,
    });

    manageToken = issued.token;
    await storeManageToken(org.id, result.appointmentId, issued.record);
  }

  if (result.appointmentId && customerEmail) {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");

  const manageUrl =
    manageToken && appUrl ? `${appUrl}/manage/${manageToken}` : null;

  const bookingUrl =
    orgSlug && appUrl ? `${appUrl}/book/${orgSlug}` : null;

  const dashboardConfig = (org.dashboardConfig as Record<string, unknown>) || {};
  const contact = (dashboardConfig.contact as Record<string, unknown>) || {};

  const orgPhone = typeof contact.phone === "string" ? contact.phone : null;
  const orgAddress =
    org.address || (typeof contact.address === "string" ? contact.address : null);

  sendBookingConfirmationEmail({
    orgId: org.id,
    orgName: org.name,
    timezone: org.timezone,
    startsAt: start,
    customerName,
    customerEmail,
    customerPhone,
    orgAddress,
    orgPhone,
    manageUrl,
    bookingUrl,
    serviceName: service?.name ?? null,
  }).catch((err) =>
    console.error("booking-confirmation-email failed:", err),
  );
}

return json({
  ok: true,
  duplicate: result.duplicate,
  appointmentId: result.appointmentId,
  manageToken,
});
}