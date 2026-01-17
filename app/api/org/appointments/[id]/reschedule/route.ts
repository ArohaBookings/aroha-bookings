import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createOrUpdateAppointmentEvent } from "@/lib/integrations/google/syncAppointment";
import { sendRescheduleEmail } from "@/lib/notifications";
import { requireStaffContext } from "@/app/api/org/appointments/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function sameOrgDay(a: Date, b: Date, tz: string): boolean {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(a) === fmt.format(b);
}

export async function POST(req: Request, ctx: { params: { id: string } }) {
  const auth = await requireStaffContext();
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const body = (await req.json().catch(() => ({}))) as { startISO?: string };
  const startISO = (body.startISO || "").trim();
  if (!startISO) {
    return json({ ok: false, error: "Missing start time" }, 400);
  }

  const start = new Date(startISO);
  if (Number.isNaN(start.getTime())) {
    return json({ ok: false, error: "Invalid start time" }, 400);
  }

  const appt = await prisma.appointment.findUnique({
    where: { id: ctx.params.id },
    select: {
      id: true,
      orgId: true,
      staffId: true,
      startsAt: true,
      endsAt: true,
      customerName: true,
      customerEmail: true,
      customerPhone: true,
      serviceId: true,
    },
  });
  if (!appt || appt.orgId !== auth.orgId) {
    return json({ ok: false, error: "Appointment not found" }, 404);
  }
  if (appt.staffId !== auth.staffId) {
    return json({ ok: false, error: "Not authorized" }, 403);
  }

  const org = await prisma.organization.findUnique({
    where: { id: appt.orgId },
    select: { name: true, slug: true, timezone: true, dashboardConfig: true, address: true },
  });
  if (!org) {
    return json({ ok: false, error: "Organization not found" }, 404);
  }

  const durationMin = Math.max(
    10,
    Math.round((appt.endsAt.getTime() - appt.startsAt.getTime()) / 60000)
  );
  const end = new Date(start.getTime() + durationMin * 60_000);

  if (!sameOrgDay(start, end, org.timezone)) {
    return json({ ok: false, error: "Bookings can’t span multiple days" }, 400);
  }

  const bookingRules = (org.dashboardConfig as Record<string, unknown>)?.bookingRules as
    | Record<string, unknown>
    | undefined;
  const allowOverlaps = Boolean(bookingRules?.allowOverlaps);
  const bufferBeforeMin = Number(bookingRules?.bufferBeforeMin ?? 0) || 0;
  const bufferAfterMin = Number(bookingRules?.bufferAfterMin ?? 0) || 0;
  const startBuffered = new Date(start.getTime() - bufferBeforeMin * 60_000);
  const endBuffered = new Date(end.getTime() + bufferAfterMin * 60_000);

  const result = await prisma.$transaction(async (tx) => {
    if (!allowOverlaps && appt.staffId) {
      const overlap = await tx.appointment.count({
        where: {
          orgId: appt.orgId,
          staffId: appt.staffId,
          status: { not: "CANCELLED" },
          id: { not: appt.id },
          startsAt: { lt: endBuffered },
          endsAt: { gt: startBuffered },
        },
      });
      if (overlap > 0) {
        return { conflict: true };
      }
    }

    const updated = await tx.appointment.update({
      where: { id: appt.id },
      data: { startsAt: start, endsAt: end },
      select: { id: true, startsAt: true, endsAt: true },
    });

    return { conflict: false, updated };
  });

  // ...everything above stays the same

    if (result.conflict) {
    return json({ ok: false, error: "Overlaps an existing booking" }, 409);
  }

  const updated = result.updated;
  if (!updated) {
    return json({ ok: false, error: "Update failed" }, 500);
  }

  // updated is now guaranteed
  createOrUpdateAppointmentEvent(appt.orgId, updated.id).catch((err) =>
    console.error("google-sync(staff-reschedule) error:", err)
  );

  const dashboardConfig = (org.dashboardConfig as Record<string, unknown>) || {};
  const notifications = (dashboardConfig.notifications as Record<string, unknown>) || {};
  const emailEnabled = (notifications as any).emailEnabled !== false;

  const contact = (dashboardConfig.contact as Record<string, unknown>) || {};
  const orgPhone =
    typeof (contact as any).phone === "string" ? ((contact as any).phone as string) : null;
  const orgAddress =
    org.address ||
    (typeof (contact as any).address === "string" ? ((contact as any).address as string) : null);

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  const bookingUrl = org.slug && appUrl ? `${appUrl}/book/${org.slug}` : null;

  const service = appt.serviceId
    ? await prisma.service.findUnique({ where: { id: appt.serviceId }, select: { name: true } })
    : null;

  if (emailEnabled && appt.customerEmail) {
    sendRescheduleEmail({
      orgId: appt.orgId,
      orgName: org.name,
      timezone: org.timezone,
      startsAt: start,
      customerName: appt.customerName,
      customerEmail: appt.customerEmail,
      customerPhone: appt.customerPhone,
      orgAddress,
      orgPhone,
      bookingUrl,
      serviceName: service?.name ?? null,
    }).catch((err) => console.error("reschedule-email failed:", err));
  }

  return json({
    ok: true,
    startsAt: updated.startsAt.toISOString(),
    endsAt: updated.endsAt.toISOString(),
  });
}