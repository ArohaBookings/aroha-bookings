import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deleteAppointmentEvent } from "@/lib/integrations/google/syncAppointment";
import { getManageContext } from "@/app/manage/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const callsByIp = new Map<string, { last: number; count: number }>();
function rateLimit(ip: string, maxPerMinute = 30) {
  const now = Date.now();
  const m = callsByIp.get(ip) || { last: now, count: 0 };
  if (now - m.last > 60_000) {
    m.last = now;
    m.count = 0;
  }
  m.count++;
  callsByIp.set(ip, m);
  return m.count <= maxPerMinute;
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function POST(req: Request, ctx: { params: { token: string } }) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    (req as { ip?: string }).ip ||
    "0.0.0.0";
  if (!rateLimit(ip, 40)) {
    return json({ ok: false, error: "Rate limit" }, 429);
  }

  const body = (await req.json().catch(() => ({}))) as { honeypot?: string };
  if (body.honeypot) {
    return json({ ok: false, error: "Invalid submission" }, 400);
  }

  const token = ctx.params.token || "";
  const managed = await getManageContext(token);
  if (!managed.ok) {
    return json({ ok: false, error: managed.error }, 403);
  }

  const appt = managed.appointment;
  if (appt.status === "CANCELLED") {
    return json({ ok: true });
  }

  await prisma.appointment.update({
    where: { id: appt.id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelledBy: "manage-link",
    },
  });

  deleteAppointmentEvent(appt.orgId, appt.id).catch((err) =>
    console.error("google-sync(manage-cancel) error:", err)
  );

  return json({ ok: true });
}
