import { NextResponse } from "next/server";
import { requireRetellContext } from "@/lib/retell/auth";
import { findAvailability } from "@/lib/availability";
import { prisma } from "@/lib/db";
import { withCors } from "@/lib/cors"; // ✅ import the helper

export const runtime = "nodejs";

export async function OPTIONS() {
  // Handle preflight
  return new NextResponse(null, { status: 204, headers: withCors("*") });
}

export async function POST(req: Request) {
  try {
    const ctx = await requireRetellContext(req);
    const body = await req.json();

    const { serviceId, dateFrom, dateTo, staffId, bufferMin } = body ?? {};
    if (!serviceId || !dateFrom || !dateTo)
      return NextResponse.json({ error: "Missing serviceId/dateFrom/dateTo" }, { status: 400 });

    const service = await prisma.service.findFirst({
      where: { id: serviceId, orgId: ctx.org.id },
      select: { durationMin: true },
    });
    if (!service)
      return NextResponse.json({ error: "Service not found" }, { status: 404 });

    const slots = await findAvailability({
      orgId: ctx.org.id,
      serviceDurationMin: service.durationMin,
      dateFrom: new Date(dateFrom),
      dateTo: new Date(dateTo),
      staffId,
      bufferMin: bufferMin ?? 0,
    });

    // ✅ Add CORS headers before returning
    const headers = withCors("*");
    return new NextResponse(JSON.stringify({ slots }), { headers });
  } catch (e: any) {
    if (e instanceof Response) return e;
    const headers = withCors("*");
    return new NextResponse(JSON.stringify({ error: e?.message ?? "Server error" }), {
      status: 500,
      headers,
    });
  }
}
