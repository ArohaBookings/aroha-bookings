import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizePhone } from "@/lib/retell/phone";
import { withCors } from "@/lib/cors";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: withCors("*") });
}

export async function POST(req: Request) {
  try {
    const { orgSlug, serviceId, staffId, startISO, customer } = await req.json();
    if (!orgSlug || !serviceId || !startISO || !customer?.name || !customer?.phone)
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });

    const org = await prisma.organization.findUnique({ where: { slug: orgSlug }, select: { id: true } });
    if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 });

    const service = await prisma.service.findFirst({
      where: { id: serviceId, orgId: org.id },
      select: { id: true, durationMin: true },
    });
    if (!service) return NextResponse.json({ error: "Service not found" }, { status: 404 });

    const startsAt = new Date(startISO);
    const endsAt = new Date(startsAt.getTime() + service.durationMin * 60_000);

    const phone = normalizePhone(customer.phone);
    let cust = await prisma.customer.findFirst({ where: { orgId: org.id, phone } });
    if (!cust) {
      cust = await prisma.customer.create({
        data: { orgId: org.id, name: customer.name, phone, email: customer.email ?? null },
      });
    }

    const appt = await prisma.appointment.create({
      data: {
        orgId: org.id,
        staffId: staffId ?? null,
        serviceId: service.id,
        customerId: cust.id,
        customerName: cust.name,
        customerPhone: cust.phone,
        customerEmail: cust.email,
        startsAt,
        endsAt,
        source: "web",
        status: "SCHEDULED",
      },
      select: { id: true, startsAt: true, endsAt: true },
    });

    return new NextResponse(JSON.stringify({ ok: true, appointment: appt }),
      { headers: withCors("*") });
  } catch (e: any) {
    return new NextResponse(JSON.stringify({ error: e?.message ?? "Server error" }),
      { status: 500, headers: withCors("*") });
  }
}
