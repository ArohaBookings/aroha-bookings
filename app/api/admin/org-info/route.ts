// app/api/admin/org-info/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canAccessSuperAdminByEmail } from "@/lib/roles";
import { readGoogleCalendarIntegration } from "@/lib/orgSettings";

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

  const [org, os, connection, services] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, slug: true, timezone: true },
    }),
    prisma.orgSettings.findUnique({
      where: { orgId },
      select: { data: true },
    }),
    prisma.calendarConnection.findFirst({
      where: { orgId, provider: "google" },
      orderBy: { updatedAt: "desc" },
      select: { accountEmail: true, expiresAt: true },
    }),
    prisma.service.findMany({
      where: { orgId },
      select: { id: true, name: true, durationMin: true },
      orderBy: { name: "asc" },
      take: 5,
    }),
  ]);

  if (!org) return json({ ok: false, error: "Org not found" }, 404);

  const data = (os?.data as Record<string, unknown>) || {};
  const google = readGoogleCalendarIntegration(data);
  const calendarId = google.calendarId;
  const accountEmail = google.accountEmail || connection?.accountEmail || null;

  return json({
    ok: true,
    org,
    google: {
      connected: Boolean(calendarId && connection && google.connected),
      calendarId,
      accountEmail,
      expiresAt: connection?.expiresAt ?? null,
    },
    services,
  });
}
