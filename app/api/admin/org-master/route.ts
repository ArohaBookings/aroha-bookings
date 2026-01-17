import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolvePlanConfig } from "@/lib/plan";
import { getOrgEntitlements } from "@/lib/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function isSuperadmin(email?: string | null): boolean {
  if (!email) return false;
  const list = (process.env.SUPERADMINS || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

async function requireSuperadmin() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email || null;
  if (!email) return { ok: false, error: "Not signed in", status: 401 } as const;
  if (!isSuperadmin(email)) return { ok: false, error: "Not authorized", status: 403 } as const;
  return { ok: true } as const;
}

export async function GET(req: Request) {
  const auth = await requireSuperadmin();
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const url = new URL(req.url);
  const orgId = (url.searchParams.get("orgId") || "").trim();
  if (!orgId) return json({ ok: false, error: "Missing orgId" }, 400);

  const [org, os, connection, staffCount, latestAppointment, lastEmailSend] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, slug: true, timezone: true, plan: true },
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
    prisma.staffMember.count({ where: { orgId } }),
    prisma.appointment.findFirst({
      where: { orgId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, status: true, startsAt: true, updatedAt: true },
    }),
    (prisma as any).emailAILog?.findFirst
      ? (prisma as any).emailAILog.findFirst({
          where: { orgId, action: { in: ["auto_sent", "sent"] } },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        })
      : Promise.resolve(null),
  ]);

  if (!org) return json({ ok: false, error: "Org not found" }, 404);

  const data = (os?.data as Record<string, unknown>) || {};
  const planConfig = resolvePlanConfig(org?.plan ?? null, data);
  const calendarId = typeof data.googleCalendarId === "string" ? data.googleCalendarId : null;
  const accountEmail =
    (typeof data.googleAccountEmail === "string" && data.googleAccountEmail) ||
    connection?.accountEmail ||
    null;

  const calendarSyncErrors = Array.isArray(data.calendarSyncErrors)
    ? data.calendarSyncErrors.slice(0, 10)
    : [];
  const entitlements = await getOrgEntitlements(orgId);
  const planNotes = typeof data.planNotes === "string" ? data.planNotes : "";
  const emailAiSync = (data.emailAiSync as Record<string, unknown>) || {};
  const messagesSync = (data.messagesSync as Record<string, unknown>) || {};

  return json({
    ok: true,
    org,
    staffCount,
    planLimits: planConfig.limits,
    planFeatures: planConfig.features,
    entitlements,
    planNotes,
    google: {
      connected: Boolean(calendarId && connection),
      calendarId,
      accountEmail,
      expiresAt: connection?.expiresAt ?? null,
    },
    cronLastRun: typeof data.cronLastRun === "string" ? data.cronLastRun : null,
    recentSyncErrors: calendarSyncErrors,
    latestAppointment,
    emailAiSync,
    messagesSync,
    lastEmailSendAt: lastEmailSend?.createdAt ?? null,
  });
}
