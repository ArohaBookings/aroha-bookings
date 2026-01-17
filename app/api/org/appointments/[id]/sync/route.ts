import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createOrUpdateAppointmentEvent } from "@/lib/integrations/google/syncAppointment";
import { requireAdminContext } from "@/app/api/org/appointments/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function POST(_req: Request, ctx: { params: { id: string } }) {
  const auth = await requireAdminContext();
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const appt = await prisma.appointment.findUnique({
    where: { id: ctx.params.id },
    select: { id: true, orgId: true },
  });
  if (!appt || appt.orgId !== auth.orgId) {
    return json({ ok: false, error: "Appointment not found" }, 404);
  }

  await createOrUpdateAppointmentEvent(appt.orgId, appt.id);
  return json({ ok: true });
}
