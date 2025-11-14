// app/api/public/v1/availability/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { findAvailability } from "@/lib/availability";
import { withCors } from "@/lib/cors";

export const runtime = "nodejs";

/** CORS preflight */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: withCors("*") });
}

/** Helpers */
function bad(msg: string, code = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status: code, headers: withCors("*") });
}
function parseISO(d: unknown): Date | null {
  if (typeof d !== "string") return null;
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/**
 * Public availability search
 * Body:
 * {
 *   orgSlug: string,
 *   serviceId: string,
 *   dateFrom: ISO,
 *   dateTo: ISO,
 *   staffId?: string,
 *   bufferMin?: number
 * }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const orgSlug = String(body?.orgSlug || "");
    const serviceId = String(body?.serviceId || "");
    const dateFromStr = body?.dateFrom;
    const dateToStr = body?.dateTo;
    const staffId = body?.staffId ? String(body.staffId) : undefined;
    const bufferMinRaw = body?.bufferMin;

    if (!orgSlug || !serviceId || !dateFromStr || !dateToStr) {
      return bad("Missing orgSlug/serviceId/dateFrom/dateTo");
    }

    const from = parseISO(dateFromStr);
    const to = parseISO(dateToStr);
    if (!from || !to) return bad("dateFrom/dateTo must be valid ISO date strings");
    if (to <= from) return bad("dateTo must be after dateFrom");

    // clamp the search window to prevent abusive queries (max 60 days)
    const MAX_RANGE_DAYS = 60;
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) {
      return bad(`Date range too large (max ${MAX_RANGE_DAYS} days)`);
    }

    // sanitize buffer
    const bufferMin =
      typeof bufferMinRaw === "number" && bufferMinRaw >= 0 && bufferMinRaw <= 240
        ? Math.floor(bufferMinRaw)
        : 0;

    // org
    const org = await prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { id: true },
    });
    if (!org) return bad("Organization not found", 404);

    // service (must belong to org)
    const service = await prisma.service.findFirst({
      where: { id: serviceId, orgId: org.id },
      select: { id: true, durationMin: true },
    });
    if (!service) return bad("Service not found", 404);
    if (service.durationMin <= 0 || service.durationMin > 24 * 60) {
      return bad("Service duration is invalid");
    }

    // optional staff check (must belong to org & be active)
    if (staffId) {
      const staff = await prisma.staffMember.findFirst({
        where: { id: staffId, orgId: org.id, active: true },
        select: { id: true },
      });
      if (!staff) return bad("Staff not found or inactive", 404);
    }

    // compute availability
    const slots = await findAvailability({
      orgId: org.id,
      serviceDurationMin: service.durationMin,
      dateFrom: from,
      dateTo: to,
      staffId,
      bufferMin,
    });

    // normalize output; keep compatible with existing clients
    return new NextResponse(
      JSON.stringify({
        ok: true,
        orgId: org.id,
        serviceDurationMin: service.durationMin,
        bufferMin,
        window: { from: from.toISOString(), to: to.toISOString() },
        count: Array.isArray(slots) ? slots.length : 0,
        slots, // expected to be ISO strings or {start,end,staffId} objects from your finder
      }),
      { headers: withCors("*") }
    );
  } catch (err: any) {
    console.error("availability POST error:", err);
    return new NextResponse(
      JSON.stringify({ ok: false, error: err?.message ?? "Server error" }),
      { status: 500, headers: withCors("*") }
    );
  }
}
