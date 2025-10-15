// app/api/retell/v1/book/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRetellContext } from "@/lib/retell/auth";
import { normalizePhone } from "@/lib/retell/phone";
import { withCors } from "@/lib/cors";

export const runtime = "nodejs";

// Preflight
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: withCors("*") });
}

type Body = {
  serviceId: string;
  staffId?: string | null;
  startISO: string;
  customer: { name: string; phone: string; email?: string | null };
  notes?: string | null;
};

export async function POST(req: Request) {
  try {
    const ctx = await requireRetellContext(req); // verifies x-retell-signature and resolves org
    const body = (await req.json()) as Body;

    // ── Validate input
    if (!body?.serviceId || !body?.startISO || !body?.customer?.name || !body?.customer?.phone) {
      return NextResponse.json(
        { error: "Missing required fields: serviceId, startISO, customer.name, customer.phone" },
        { status: 400, headers: withCors("*") },
      );
    }

    const startsAt = new Date(body.startISO);
    if (Number.isNaN(startsAt.getTime())) {
      return NextResponse.json(
        { error: "Invalid startISO (must be an ISO date-time string)" },
        { status: 400, headers: withCors("*") },
      );
    }

    // ── Fetch service in this org
    const service = await prisma.service.findFirst({
      where: { id: body.serviceId, orgId: ctx.org.id },
      select: { id: true, name: true, durationMin: true, priceCents: true },
    });
    if (!service) {
      return NextResponse.json(
        { error: "Service not found in this organization" },
        { status: 404, headers: withCors("*") },
      );
    }

    const endsAt = new Date(startsAt.getTime() + service.durationMin * 60_000);

    // ── If a staffId was provided, ensure it belongs to this org and is not double-booked
    let staffName: string | null = null;
    if (body.staffId) {
      const staff = await prisma.staffMember.findFirst({
        where: { id: body.staffId, orgId: ctx.org.id, active: true },
        select: { id: true, name: true },
      });
      if (!staff) {
        return NextResponse.json(
          { error: "Staff not found in this organization" },
          { status: 404, headers: withCors("*") },
        );
      }
      staffName = staff.name ?? "Staff";

      // Basic overlap check for this staff
      const overlap = await prisma.appointment.count({
        where: {
          orgId: ctx.org.id,
          staffId: staff.id,
          // overlap if starts before existing ends AND ends after existing starts
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
          status: { in: ["SCHEDULED", "COMPLETED"] }, // treat scheduled as blocking
        },
      });
      if (overlap > 0) {
        return NextResponse.json(
          { error: "Time slot is no longer available for the selected staff" },
          { status: 409, headers: withCors("*") },
        );
      }
    }

    // ── Find or create customer (by normalized phone within org)
    const phone = normalizePhone(body.customer.phone);
    const customer = await prisma.customer.upsert({
      where: { orgId_phone: { orgId: ctx.org.id, phone } },
      update: {
        name: body.customer.name, // keep name fresh
        email: body.customer.email ?? undefined,
      },
      create: {
        orgId: ctx.org.id,
        name: body.customer.name,
        phone,
        email: body.customer.email ?? null,
      },
      select: { id: true, name: true, phone: true, email: true },
    });

    // ── Create the appointment
    const appt = await prisma.appointment.create({
      data: {
        orgId: ctx.org.id,
        staffId: body.staffId ?? null,
        serviceId: service.id,
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        customerEmail: customer.email,
        notes: body.notes ?? null,
        startsAt,
        endsAt,
        source: "retell",
        status: "SCHEDULED",
      },
      select: { id: true, startsAt: true, endsAt: true },
    });

    // ── Shape response for Retell variable mapping
    const payload = {
      ok: true,
      bookingId: appt.id,
      serviceName: service.name,
      staffName: staffName, // may be null if staff wasn’t specified
      endsAt: appt.endsAt.toISOString(),
      appointment: { ...appt }, // full object if you want it
    };

    return new NextResponse(JSON.stringify(payload), { headers: withCors("*") });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return new NextResponse(
      JSON.stringify({ error: e?.message ?? "Server error" }),
      { status: 500, headers: withCors("*") },
    );
  }
}
