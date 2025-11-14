// app/api/retell/v1/cancel/route.ts
import { NextResponse } from "next/server";
import { requireRetellContext } from "@/lib/retell/auth";
import { prisma } from "@/lib/db";
import { pushAppointmentToGoogle, updateAppointmentInGoogle, deleteAppointmentFromGoogle } from "@/lib/google-calendar";

export const runtime = "nodejs";
// Before returning:


export async function POST(req: Request) {
  try {
    const ctx = await requireRetellContext(req);
    const body = await req.json();
    const { appointmentId, reason } = body ?? {};
    if (!appointmentId) return NextResponse.json({ error: "Missing appointmentId" }, { status: 400 });

    // ensure belongs to this org
    const appt = await prisma.appointment.findFirst({
      where: { id: appointmentId, orgId: ctx.org.id },
      select: { id: true, status: true },
    });
    if (!appt) return NextResponse.json({ error: "Appointment not found" }, { status: 404 });

    const updated = await prisma.appointment.update({
      where: { id: appt.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledBy: reason ? `retell: ${reason}` : "retell",
      },
      select: { id: true, status: true, cancelledAt: true },
    });

    return NextResponse.json({ ok: true, appointment: updated });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
