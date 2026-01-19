import { NextResponse } from "next/server";
import { requireAdminContext } from "@/app/api/org/appointments/utils";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext();
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  const { id } = await params;

  const appt = await prisma.appointment.findUnique({
    where: { id },
    select: {
      id: true,
      orgId: true,
      status: true,
      externalProvider: true,
      externalCalendarEventId: true,
      externalCalendarId: true,
      syncedAt: true,
    },
  });
  if (!appt || appt.orgId !== auth.orgId) {
    return json({ ok: false, error: "Appointment not found" }, 404);
  }

  let action = "skip";
  let reason = "No action required.";
  if (appt.status === "CANCELLED" && appt.externalCalendarEventId) {
    action = "delete";
    reason = "Appointment cancelled; would delete Google event.";
  } else if (appt.externalProvider === "google" && appt.externalCalendarEventId) {
    action = "update";
    reason = "Appointment has a Google event; would update it.";
  } else if (!appt.externalCalendarEventId) {
    action = "create";
    reason = "No external event found; would create a Google event.";
  }

  return json({
    ok: true,
    action,
    reason,
    externalCalendarId: appt.externalCalendarId,
    externalEventId: appt.externalCalendarEventId,
    syncedAt: appt.syncedAt?.toISOString() ?? null,
  });
}
