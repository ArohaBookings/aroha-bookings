import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOrgEntitlements, type OrgEntitlements } from "@/lib/entitlements";

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

function normalizeEntitlements(payload: Partial<OrgEntitlements>, defaults: OrgEntitlements): OrgEntitlements {
  return {
    features: {
      booking: payload.features?.booking ?? defaults.features.booking,
      emailAi: payload.features?.emailAi ?? defaults.features.emailAi,
      messagesHub: payload.features?.messagesHub ?? defaults.features.messagesHub,
      calendar: payload.features?.calendar ?? defaults.features.calendar,
      holds: payload.features?.holds ?? defaults.features.holds,
      analytics: payload.features?.analytics ?? defaults.features.analytics,
    },
    automation: {
      enableAutoDraft: payload.automation?.enableAutoDraft ?? defaults.automation.enableAutoDraft,
      enableAutoSend: payload.automation?.enableAutoSend ?? defaults.automation.enableAutoSend,
      dailySendCap: payload.automation?.dailySendCap ?? defaults.automation.dailySendCap,
      minConfidence: payload.automation?.minConfidence ?? defaults.automation.minConfidence,
      requireApprovalFirstN:
        payload.automation?.requireApprovalFirstN ?? defaults.automation.requireApprovalFirstN,
    },
    limits: {
      staffMax: payload.limits?.staffMax ?? defaults.limits.staffMax,
      bookingsPerMonth: payload.limits?.bookingsPerMonth ?? defaults.limits.bookingsPerMonth,
      inboxSyncIntervalSec: payload.limits?.inboxSyncIntervalSec ?? defaults.limits.inboxSyncIntervalSec,
      messageSyncIntervalSec: payload.limits?.messageSyncIntervalSec ?? defaults.limits.messageSyncIntervalSec,
    },
    channels: {
      whatsapp: { enabled: payload.channels?.whatsapp?.enabled ?? defaults.channels.whatsapp.enabled },
      instagram: { enabled: payload.channels?.instagram?.enabled ?? defaults.channels.instagram.enabled },
      webchat: { enabled: payload.channels?.webchat?.enabled ?? defaults.channels.webchat.enabled },
    },
  };
}

export async function GET(req: Request) {
  const auth = await requireSuperadmin();
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const url = new URL(req.url);
  const orgId = (url.searchParams.get("orgId") || "").trim();
  if (!orgId) return json({ ok: false, error: "Missing orgId" }, 400);

  const entitlements = await getOrgEntitlements(orgId);
  return json({ ok: true, entitlements });
}

export async function POST(req: Request) {
  const auth = await requireSuperadmin();
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const body = (await req.json().catch(() => ({}))) as { orgId?: string; entitlements?: Partial<OrgEntitlements> };
  const orgId = (body.orgId || "").trim();
  if (!orgId) return json({ ok: false, error: "Missing orgId" }, 400);

  const defaults = await getOrgEntitlements(orgId);
  const entitlements = normalizeEntitlements(body.entitlements || {}, defaults);

  const os = await prisma.orgSettings.findUnique({ where: { orgId }, select: { data: true } });
  const data = (os?.data as Record<string, unknown>) || {};

  await prisma.orgSettings.upsert({
    where: { orgId },
    create: { orgId, data: { ...data, entitlements } as any },
    update: { data: { ...data, entitlements } as any },
  });

  return json({ ok: true, entitlements });
}
