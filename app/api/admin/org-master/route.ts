import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canAccessSuperAdminByEmail } from "@/lib/roles";
import { resolvePlanConfig } from "@/lib/plan";
import { getOrgEntitlements } from "@/lib/entitlements";
import {
  readCallsSettings,
  readGmailIntegration,
  readGoogleCalendarIntegration,
  writeCallsSettings,
} from "@/lib/orgSettings";

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

  const [org, os, connection, staffCount, latestAppointment, lastEmailSend, retellConn] = await Promise.all([
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
    prisma.retellConnection.findFirst({
      where: { orgId },
      orderBy: { updatedAt: "desc" },
      select: { agentId: true, apiKeyEncrypted: true, webhookSecret: true, active: true },
    }),
  ]);

  if (!org) return json({ ok: false, error: "Org not found" }, 404);

  const data = (os?.data as Record<string, unknown>) || {};
  const planConfig = resolvePlanConfig(org?.plan ?? null, data);
  const google = readGoogleCalendarIntegration(data);
  const calendarId = google.calendarId;
  const accountEmail = google.accountEmail || connection?.accountEmail || null;

  const calendarSyncErrors = Array.isArray(data.calendarSyncErrors)
    ? data.calendarSyncErrors.slice(0, 10)
    : [];
  const entitlements = await getOrgEntitlements(orgId);
  const planNotes = typeof data.planNotes === "string" ? data.planNotes : "";
  const emailAiSync = (data.emailAiSync as Record<string, unknown>) || {};
  const messagesSync = (data.messagesSync as Record<string, unknown>) || {};
  const retell = (data.retell as Record<string, unknown>) || {};
  const calls = readCallsSettings(data);
  const gmail = readGmailIntegration(data);
  const retellZapierWebhookUrl =
    typeof retell.zapierWebhookUrl === "string" ? retell.zapierWebhookUrl : null;
  const retellLastWebhookAt =
    typeof retell.lastWebhookAt === "string" ? retell.lastWebhookAt : null;

return json({
  ok: true,
  org,
  staffCount,
  planLimits: planConfig.limits,
  planFeatures: planConfig.features,
  entitlements,
  planNotes,
  google: {
    connected: Boolean(calendarId && connection && google.connected),
    calendarId,
    accountEmail,
    expiresAt: connection?.expiresAt ?? null,
    lastSyncAt: google.lastSyncAt,
    lastSyncError: google.lastSyncError,
  },
  gmail: {
    connected: gmail.connected,
    accountEmail: gmail.accountEmail,
    lastError: gmail.lastError,
  },
  calls: {
    retell: {
      agentId: calls.retell.agentId ?? retellConn?.agentId ?? null,
      phoneNumber: calls.retell.phoneNumber ?? null,
      webhookUrl: calls.retell.webhookUrl ?? null,
      webhookSecret: calls.retell.webhookSecret ?? retellConn?.webhookSecret ?? null,
    },
    bookingTools: {
      enabled: calls.bookingTools.enabled,
    },
  },
  cronLastRun: typeof data.cronLastRun === "string" ? data.cronLastRun : null,
  recentSyncErrors: calendarSyncErrors,
  latestAppointment,
  emailAiSync,
  messagesSync,
  lastEmailSendAt:
    (lastEmailSend as { createdAt?: Date } | null)?.createdAt ?? null,
  retell: {
    agentId: retellConn?.agentId || null,
    apiKeyEncrypted: retellConn?.apiKeyEncrypted || null,
    webhookSecret: retellConn?.webhookSecret || null,
    active: typeof retellConn?.active === "boolean" ? retellConn.active : null,
    zapierWebhookUrl: retellZapierWebhookUrl,
    lastWebhookAt: retellLastWebhookAt,
  },
});
}

export async function POST(req: Request) {
  const auth = await requireSuperadmin();
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const body = (await req.json().catch(() => ({}))) as {
    orgId?: string;
    retell?: {
      agentId?: string;
      apiKeyEncrypted?: string | null;
      webhookSecret?: string;
      active?: boolean;
      phoneNumber?: string;
    };
    bookingToolsEnabled?: boolean;
    zapierWebhookUrl?: string | null;
  };
  const orgId = (body.orgId || "").trim();
  if (!orgId) return json({ ok: false, error: "Missing orgId" }, 400);

  const zapierWebhookUrl = typeof body.zapierWebhookUrl === "string" ? body.zapierWebhookUrl.trim() : "";
  if (body.retell) {
    const agentId = (body.retell.agentId || "").trim();
    const webhookSecret = (body.retell.webhookSecret || "").trim();
    const active = Boolean(body.retell.active);
    const phoneNumber = (body.retell.phoneNumber || "").trim();
    const apiKeyEncrypted =
      typeof body.retell.apiKeyEncrypted === "string" ? body.retell.apiKeyEncrypted : undefined;
    if (agentId && webhookSecret) {
      await prisma.retellConnection.upsert({
        where: { orgId_agentId: { orgId, agentId } },
        update: {
          webhookSecret,
          active,
          ...(apiKeyEncrypted !== undefined ? { apiKeyEncrypted } : {}),
        },
        create: {
          orgId,
          agentId,
          webhookSecret,
          active,
          apiKeyEncrypted: apiKeyEncrypted ?? "",
        },
      });
    }
    const settings = await prisma.orgSettings.findUnique({
      where: { orgId },
      select: { data: true },
    });
    const data = (settings?.data as Record<string, unknown>) || {};
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "").replace(/\/$/, "");
    const webhookUrl = appUrl ? `${appUrl}/api/webhooks/voice/retell/${orgId}` : null;
    const next = writeCallsSettings(data, {
      retell: {
        agentId: agentId || null,
        webhookSecret: webhookSecret || null,
        phoneNumber: phoneNumber || null,
        webhookUrl,
      },
    });
    await prisma.orgSettings.upsert({
      where: { orgId },
      create: { orgId, data: next as any },
      update: { data: next as any },
    });
  }

  if (typeof body.bookingToolsEnabled === "boolean") {
    const settings = await prisma.orgSettings.findUnique({
      where: { orgId },
      select: { data: true },
    });
    const data = (settings?.data as Record<string, unknown>) || {};
    const next = writeCallsSettings(data, {
      bookingTools: { enabled: body.bookingToolsEnabled },
    });
    await prisma.orgSettings.upsert({
      where: { orgId },
      create: { orgId, data: next as any },
      update: { data: next as any },
    });
  }

  if (zapierWebhookUrl || body.zapierWebhookUrl === null) {
    const settings = await prisma.orgSettings.findUnique({
      where: { orgId },
      select: { data: true },
    });
    const data = (settings?.data as Record<string, unknown>) || {};
    const retell = (data.retell as Record<string, unknown>) || {};
    retell.zapierWebhookUrl = zapierWebhookUrl || null;
    data.retell = retell;
    await prisma.orgSettings.upsert({
      where: { orgId },
      create: { orgId, data: data as any },
      update: { data: data as any },
    });
  }

  return json({ ok: true });
}
