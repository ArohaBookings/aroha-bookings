import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deleteAppointmentEvent } from "@/lib/integrations/google/syncAppointment";
import { sendCancellationEmail } from "@/lib/notifications";
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

const VALID_STATUS = ["SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"] as const;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffContext();
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as { status?: string };
  const status = (body.status || "").toUpperCase();
  if (!VALID_STATUS.includes(status as (typeof VALID_STATUS)[number])) {
    return json({ ok: false, error: "Invalid status" }, 400);
  }

  const appt = await prisma.appointment.findUnique({
    where: { id },
    select: {
      id: true,
      orgId: true,
      staffId: true,
      startsAt: true,
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

  await prisma.appointment.update({
    where: { id: appt.id },
    data: {
      status: status as any,
      ...(status === "CANCELLED"
        ? { cancelledAt: new Date(), cancelledBy: auth.email }
        : { cancelledAt: null, cancelledBy: null }),
    },
  });

  if (status === "CANCELLED") {
    deleteAppointmentEvent(appt.orgId, appt.id).catch((err) =>
      console.error("google-sync(staff-cancel) error:", err)
    );

    const org = await prisma.organization.findUnique({
      where: { id: appt.orgId },
      select: { name: true, slug: true, timezone: true, dashboardConfig: true, address: true },
    });
    if (org) {
      const dashboardConfig = (org.dashboardConfig as Record<string, unknown>) || {};
      const notifications = (dashboardConfig.notifications as Record<string, unknown>) || {};
      const emailEnabled = notifications.emailEnabled !== false;
      const contact = (dashboardConfig.contact as Record<string, unknown>) || {};
      const orgPhone = typeof contact.phone === "string" ? contact.phone : null;
      const orgAddress = org.address || (typeof contact.address === "string" ? contact.address : null);
      const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
      const bookingUrl = org.slug && appUrl ? `${appUrl}/book/${org.slug}` : null;
      const service = appt.serviceId
        ? await prisma.service.findUnique({ where: { id: appt.serviceId }, select: { name: true } })
        : null;
      if (emailEnabled && appt.customerEmail) {
        sendCancellationEmail({
  orgId: appt.orgId, // ✅ org select doesn't include id
  orgName: org.name,
  timezone: org.timezone,
  startsAt: appt.startsAt,
  customerName: appt.customerName,
  customerEmail: appt.customerEmail,
  customerPhone: appt.customerPhone,
  orgAddress,
  orgPhone,
  bookingUrl,
  serviceName: service?.name ?? null,
}).catch((err) => console.error("cancellation-email failed:", err));
      }
    }
  }

  return json({ ok: true });
}
