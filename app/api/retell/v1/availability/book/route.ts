// app/api/retell/v1/book/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRetellContext } from "@/lib/retell/auth";
import { normalizePhone } from "@/lib/retell/phone";
import { withCors } from "@/lib/cors";
import { pushAppointmentToGoogle } from "@/lib/google-calendar";

export const runtime = "nodejs";

/** CORS preflight */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: withCors("*") });
}

type Body = {
  serviceId: string;
  staffId?: string | null;
  startISO: string;
  customer: { name: string; phone: string; email?: string | null };
  notes?: string | null;
  /** Optional idempotency key passed by your VA flow to avoid dupes on retries */
  idempotencyKey?: string | null;
};

function badReq(msg: string) {
  return NextResponse.json({ ok: false, error: msg }, { status: 400, headers: withCors("*") });
}

export async function POST(req: Request) {
  try {
    // Auth + org context (verifies x-retell-signature)
    const ctx = await requireRetellContext(req);
    const body = (await req.json()) as Body;

    // ── Validate required fields
    if (!body?.serviceId) return badReq("Missing serviceId");
    if (!body?.startISO) return badReq("Missing startISO");
    if (!body?.customer?.name) return badReq("Missing customer.name");
    if (!body?.customer?.phone) return badReq("Missing customer.phone");

    // ── Parse start time
    const startsAt = new Date(body.startISO);
    if (Number.isNaN(startsAt.getTime())) return badReq("Invalid startISO (must be ISO 8601 date-time)");

    // ── Fetch service (must belong to org)
    const service = await prisma.service.findFirst({
      where: { id: body.serviceId, orgId: ctx.org.id },
      select: { id: true, name: true, durationMin: true, priceCents: true },
    });
    if (!service) {
      return NextResponse.json(
        { ok: false, error: "Service not found in this organization" },
        { status: 404, headers: withCors("*") }
      );
    }
    if (service.durationMin <= 0 || service.durationMin > 24 * 60) {
      return badReq("Service duration is invalid");
    }

    const endsAt = new Date(startsAt.getTime() + service.durationMin * 60_000);

    // ── If a staff is specified, ensure it belongs to org and is active
    let staffRow: { id: string; name: string | null } | null = null;
    if (body.staffId) {
      staffRow = await prisma.staffMember.findFirst({
        where: { id: body.staffId, orgId: ctx.org.id, active: true },
        select: { id: true, name: true },
      });
      if (!staffRow) {
        return NextResponse.json(
          { ok: false, error: "Staff not found or inactive in this organization" },
          { status: 404, headers: withCors("*") }
        );
      }
    }

    // ── Normalize phone
    const phone = normalizePhone(body.customer.phone);

    // ── Idempotency (optional): if client passes a key, refuse duplicate within 5 minutes
    if (body.idempotencyKey) {
      const existing = await prisma.appointment.findFirst({
        where: {
          orgId: ctx.org.id,
          // stash idempotency key inside notes marker or use a dedicated column if you add one
          notes: { contains: `#idem:${body.idempotencyKey}#` },
          startsAt: { gte: new Date(Date.now() - 5 * 60_000) },
        },
        select: { id: true },
      });
      if (existing) {
        return NextResponse.json(
          { ok: true, duplicate: true, bookingId: existing.id },
          { headers: withCors("*") }
        );
      }
    }

    // ── Overlap check for staff (if provided)
    if (staffRow) {
      const overlap = await prisma.appointment.count({
        where: {
          orgId: ctx.org.id,
          staffId: staffRow.id,
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
          status: { in: ["SCHEDULED", "COMPLETED"] }, // scheduled blocks
        },
      });
      if (overlap > 0) {
        return NextResponse.json(
          { ok: false, error: "Time slot is no longer available for the selected staff" },
          { status: 409, headers: withCors("*") }
        );
      }
    }

    // ── Create/Update customer + appointment in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.upsert({
        where: { orgId_phone: { orgId: ctx.org.id, phone } },
        update: {
          name: body.customer.name,
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

      const notesWithIdem =
        (body.notes ?? "") + (body.idempotencyKey ? `\n#idem:${body.idempotencyKey}#` : "");

      const appt = await tx.appointment.create({
        data: {
          orgId: ctx.org.id,
          staffId: staffRow?.id ?? null,
          serviceId: service.id,
          customerId: customer.id,
          customerName: customer.name,
          customerPhone: customer.phone,
          customerEmail: customer.email,
          notes: notesWithIdem || null,
          startsAt,
          endsAt,
          source: "retell",
          status: "SCHEDULED",
        },
        select: { id: true, startsAt: true, endsAt: true },
      });

      return { appt, customer };
    });

    // ── Fire-and-forget Google Calendar sync (does nothing if not connected)
    pushAppointmentToGoogle(result.appt.id).catch((err) =>
      console.error("google-sync(book) error:", err)
    );

    // ── Shape response for Retell variable mapping
    const payload = {
      ok: true,
      bookingId: result.appt.id,
      serviceName: service.name,
      staffName: staffRow?.name ?? null,
      endsAt: result.appt.endsAt.toISOString(),
      // Include any extra you want to template in Retell:
      durationMin: service.durationMin,
      customerName: result.customer.name,
      customerPhone: result.customer.phone,
      customerEmail: result.customer.email,
    };

    return new NextResponse(JSON.stringify(payload), { headers: withCors("*") });
  } catch (e: any) {
    if (e instanceof Response) return e; // bubble up from auth/cors helpers
    console.error("retell.book error:", e);
    return new NextResponse(
      JSON.stringify({ ok: false, error: e?.message ?? "Server error" }),
      { status: 500, headers: withCors("*") }
    );
  }
}
