// app/api/retell/v1/reschedule/route.ts
import { NextResponse } from "next/server";
import { requireRetellContext } from "@/lib/retell/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const ctx = await requireRetellContext(req);
    const body = await req.json();
    const { appointmentId, newStartISO } = body ?? {};
    if (!appointmentId || !newStartISO) {
      return NextResponse.json({ error: "Missing appointmentId/newStartISO" }, { status: 400 });
    }

    const appt = await prisma.appointment.findFirst({
      where: { id: appointmentId, orgId: ctx.org.id },
      include: { service: { select: { durationMin: true } } },
    });
    if (!appt || !appt.service) return NextResponse.json({ error: "Appointment/service not found" }, { status: 404 });

    const newStart = new Date(newStartISO);
    const newEnd = new Date(newStart.getTime() + appt.service.durationMin * 60_000);

    const updated = await prisma.appointment.update({
      where: { id: appt.id },
      data: { startsAt: newStart, endsAt: newEnd },
      select: { id: true, startsAt: true, endsAt: true, status: true },
    });

    return NextResponse.json({ ok: true, appointment: updated });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
