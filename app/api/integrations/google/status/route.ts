import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readGoogleCalendarIntegration } from "@/lib/orgSettings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  const membership = await prisma.membership.findFirst({
    where: { user: { email: session.user.email } },
    select: { orgId: true },
    orderBy: { orgId: "asc" },
  });

  if (!membership?.orgId) {
    return NextResponse.json({ ok: false, error: "No organization" }, { status: 400 });
  }

  const [connection, orgSettings] = await Promise.all([
    prisma.calendarConnection.findFirst({
      where: { orgId: membership.orgId, provider: "google" },
      orderBy: { updatedAt: "desc" },
      select: { accountEmail: true, expiresAt: true },
    }),
    prisma.orgSettings.findUnique({
      where: { orgId: membership.orgId },
      select: { data: true },
    }),
  ]);

  const data = (orgSettings?.data as Record<string, unknown>) || {};
  const google = readGoogleCalendarIntegration(data);
  const calendarId = google.calendarId;
  const lastSyncAt = google.lastSyncAt;
  const errors = Array.isArray(data.calendarSyncErrors) ? data.calendarSyncErrors : [];
  const lastError = errors.length ? errors[0] : null;
  const expiresAt = connection?.expiresAt ? connection.expiresAt.getTime() : null;
  const connected = Boolean(google.connected && calendarId);
  const needsReconnect = connected ? !connection || (expiresAt ? expiresAt < Date.now() - 2 * 60 * 1000 : true) : false;

  return NextResponse.json({
    ok: true,
    orgId: membership.orgId,
    connected,
    email: connection?.accountEmail ?? google.accountEmail ?? null,
    expiresAt,
    needsReconnect,
    calendarId,
    lastSyncAt,
    lastError,
    startUrl: `/api/integrations/google/start?orgId=${encodeURIComponent(membership.orgId)}`,
  });
}
