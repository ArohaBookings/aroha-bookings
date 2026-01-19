import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canAccessSuperAdminByEmail } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

async function requireSuperadmin() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email || null;
  if (!email) return { ok: false, error: "Not signed in", status: 401 } as const;
  const allowed = await canAccessSuperAdminByEmail(email);
  if (!allowed) return { ok: false, error: "Not authorized", status: 403 } as const;
  return { ok: true } as const;
}

export async function GET(req: Request) {
  const auth = await requireSuperadmin();
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const url = new URL(req.url);
  const orgId = (url.searchParams.get("orgId") || "").trim();
  if (!orgId) return json({ ok: false, error: "Missing orgId" }, 400);

  const appt = await prisma.appointment.findFirst({
    where: { orgId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      status: true,
      externalProvider: true,
      externalCalendarEventId: true,
      externalCalendarId: true,
      syncedAt: true,
    },
  });

  if (!appt) return json({ ok: false, error: "No appointments found" }, 404);

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
    appointmentId: appt.id,
    action,
    reason,
    externalCalendarId: appt.externalCalendarId,
    externalEventId: appt.externalCalendarEventId,
    syncedAt: appt.syncedAt?.toISOString() ?? null,
  });
}
