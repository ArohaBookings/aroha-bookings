import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canAccessSuperAdminByEmail } from "@/lib/roles";
import { randomUUID } from "crypto";

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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export async function GET(req: Request) {
  const auth = await requireSuperadmin();
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const traceId = randomUUID();
  const url = new URL(req.url);
  const orgId = (url.searchParams.get("orgId") || "").trim();
  if (!orgId) return json({ ok: false, error: "Missing orgId", traceId }, 400);

  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  let dbOk = true;
  try {
    await prisma.organization.findFirst({ select: { id: true } });
  } catch {
    dbOk = false;
  }

  const [settings, retellConn, googleConn, callLogCount24h, callLogCountTotal, lastCall] = await Promise.all([
    prisma.orgSettings.findUnique({ where: { orgId }, select: { data: true } }),
    prisma.retellConnection.findFirst({
      where: { orgId },
      orderBy: { updatedAt: "desc" },
      select: { agentId: true, apiKeyEncrypted: true, active: true },
    }),
    prisma.calendarConnection.findFirst({
      where: { orgId, provider: "google" },
      orderBy: { updatedAt: "desc" },
      select: { accountEmail: true, expiresAt: true },
    }),
    prisma.callLog.count({ where: { orgId, startedAt: { gte: since } } }),
    prisma.callLog.count({ where: { orgId } }),
    prisma.callLog.findFirst({
      where: { orgId },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    }),
  ]);

  const data = asRecord(settings?.data);
  const callsMeta = asRecord(data.calls);
  const lastWebhookAt = typeof callsMeta.lastWebhookAt === "string" ? callsMeta.lastWebhookAt : null;
  const lastWebhookError = typeof callsMeta.lastWebhookError === "string" ? callsMeta.lastWebhookError : null;
  const lastWebhookErrorAt =
    typeof callsMeta.lastWebhookErrorAt === "string" ? callsMeta.lastWebhookErrorAt : null;
  const lastSyncAt = typeof callsMeta.lastSyncAt === "string" ? callsMeta.lastSyncAt : null;
  const lastSyncError = typeof callsMeta.lastSyncError === "string" ? callsMeta.lastSyncError : null;
  const lastSyncTraceId = typeof callsMeta.lastSyncTraceId === "string" ? callsMeta.lastSyncTraceId : null;
  const lastSyncHttpStatus = typeof callsMeta.lastSyncHttpStatus === "number" ? callsMeta.lastSyncHttpStatus : null;
  const lastSyncEndpointTried =
    typeof callsMeta.lastSyncEndpointTried === "string" ? callsMeta.lastSyncEndpointTried : null;

  const calendarId = typeof data.googleCalendarId === "string" ? data.googleCalendarId : null;
  const calendarLastSyncAt = typeof data.calendarLastSyncAt === "string" ? data.calendarLastSyncAt : null;
  const calendarSyncErrors = Array.isArray(data.calendarSyncErrors) ? data.calendarSyncErrors : [];
  const lastGoogleError = calendarSyncErrors.length ? JSON.stringify(calendarSyncErrors[0]) : null;
  const accountEmail =
    (typeof data.googleAccountEmail === "string" && data.googleAccountEmail) || googleConn?.accountEmail || null;

  const hasConnection = Boolean(retellConn);
  const agentIdPresent = Boolean(retellConn?.agentId);
  const apiKeyPresent = Boolean(retellConn?.apiKeyEncrypted);
  const canDecrypt = Boolean(retellConn?.apiKeyEncrypted);
  const retellOk = hasConnection && agentIdPresent && apiKeyPresent && retellConn?.active !== false;

  const googleConnected = Boolean(calendarId && googleConn);
  const googleExpired = googleConn?.expiresAt ? googleConn.expiresAt.getTime() <= now.getTime() : true;
  const needsReconnect = !googleConnected || googleExpired;
  const googleOk = googleConnected && !needsReconnect;

  let pendingForwardJobs = 0;
  let failedForwardJobs = 0;
  const forwardDelegate = (prisma as any).webhookForwardJob;
  if (forwardDelegate?.count) {
    [pendingForwardJobs, failedForwardJobs] = await Promise.all([
      forwardDelegate.count({ where: { orgId, status: "PENDING" } }),
      forwardDelegate.count({ where: { orgId, status: "FAILED" } }),
    ]);
  }

  const callsOk = !lastSyncError;

  return json({
    ok: true,
    traceId,
    data: {
      db: { ok: dbOk },
      retell: {
        ok: retellOk,
        hasConnection,
        agentIdPresent,
        apiKeyPresent,
        canDecrypt,
        lastWebhookAt,
        lastWebhookError,
        lastWebhookErrorAt,
        lastSyncAt,
        lastSyncError,
        lastSyncTraceId,
        lastSyncHttpStatus,
        lastSyncEndpointTried,
      },
      calls: {
        ok: callsOk,
        callLogCount24h,
        callLogCountTotal,
        lastCallAt: lastCall?.startedAt?.toISOString() ?? null,
        pendingForwardJobs,
        failedForwardJobs,
      },
      google: {
        ok: googleOk,
        connected: googleConnected,
        calendarId,
        accountEmail,
        expiresAt: googleConn?.expiresAt?.toISOString() ?? null,
        needsReconnect,
        lastSyncAt: calendarLastSyncAt,
        lastError: lastGoogleError,
      },
      server: { now: now.toISOString(), env: process.env.NODE_ENV || "unknown" },
    },
  });
}
