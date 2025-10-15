import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { findAvailability } from "@/lib/availability";
import { withCors } from "@/lib/cors";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: withCors("*") });
}

export async function POST(req: Request) {
  try {
    const { orgSlug, serviceId, dateFrom, dateTo, staffId, bufferMin } = await req.json();

    if (!orgSlug || !serviceId || !dateFrom || !dateTo)
      return NextResponse.json({ error: "Missing orgSlug/serviceId/dateFrom/dateTo" }, { status: 400 });

    const org = await prisma.organization.findUnique({ where: { slug: orgSlug }, select: { id: true } });
    if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 });

    const service = await prisma.service.findFirst({
      where: { id: serviceId, orgId: org.id },
      select: { durationMin: true },
    });
    if (!service) return NextResponse.json({ error: "Service not found" }, { status: 404 });

    const slots = await findAvailability({
      orgId: org.id,
      serviceDurationMin: service.durationMin,
      dateFrom: new Date(dateFrom),
      dateTo: new Date(dateTo),
      staffId: staffId ?? undefined,
      bufferMin: bufferMin ?? 0,
    });

    return new NextResponse(JSON.stringify({ slots }), { headers: withCors("*") });
  } catch (e: any) {
    return new NextResponse(JSON.stringify({ error: e?.message ?? "Server error" }),
      { status: 500, headers: withCors("*") });
  }
}
