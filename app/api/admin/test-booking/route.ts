import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canAccessSuperAdminByEmail } from "@/lib/roles";
import { getAvailability } from "@/lib/availability/index";

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

  const [org, service] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, timezone: true },
    }),
    prisma.service.findFirst({
      where: { orgId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, durationMin: true },
    }),
  ]);

  if (!org) return json({ ok: false, error: "Org not found" }, 404);
  if (!service) return json({ ok: false, error: "No services available" }, 400);

  const from = new Date();
  const to = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const availability = await getAvailability({
    orgId: org.id,
    from,
    to,
    serviceId: service.id,
  });

  const slot = availability.slots[0] || null;
  if (!slot) {
    return json({ ok: false, error: "No slots available", meta: availability.meta }, 200);
  }

  return json({
    ok: true,
    org: { id: org.id, name: org.name },
    service,
    slot,
    meta: availability.meta,
  });
}
