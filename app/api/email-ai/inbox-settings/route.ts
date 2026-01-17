// app/api/email-ai/inbox-settings/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type InboxSettings = {
  enableAutoDraft: boolean;
  enableAutoSend: boolean;
  autoSendAllowedCategories: string[];
  autoSendMinConfidence: number;
  neverAutoSendCategories: string[];
  businessHoursOnly: boolean;
  dailySendCap: number;
  requireApprovalForFirstN: number;
  automationPaused: boolean;
};

function resolveInboxSettings(data: Record<string, unknown>): InboxSettings {
  const raw = (data.emailAiInbox as Partial<InboxSettings>) || {};
  return {
    enableAutoDraft: raw.enableAutoDraft ?? true,
    enableAutoSend: raw.enableAutoSend ?? false,
    autoSendAllowedCategories:
      raw.autoSendAllowedCategories ?? ["booking_request", "reschedule", "cancellation", "pricing", "faq", "admin"],
    autoSendMinConfidence: typeof raw.autoSendMinConfidence === "number" ? raw.autoSendMinConfidence : 92,
    neverAutoSendCategories: raw.neverAutoSendCategories ?? ["complaint", "spam"],
    businessHoursOnly: raw.businessHoursOnly ?? true,
    dailySendCap: typeof raw.dailySendCap === "number" ? raw.dailySendCap : 40,
    requireApprovalForFirstN: typeof raw.requireApprovalForFirstN === "number" ? raw.requireApprovalForFirstN : 20,
    automationPaused: raw.automationPaused ?? false,
  };
}

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

  const orgSettings = await prisma.orgSettings.findUnique({
    where: { orgId: membership.orgId },
    select: { data: true },
  });

  const data = (orgSettings?.data as Record<string, unknown>) || {};
  return NextResponse.json({ ok: true, settings: resolveInboxSettings(data) });
}

export async function POST(req: Request) {
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

  const payload = (await req.json()) as Partial<InboxSettings>;

  const orgSettings = await prisma.orgSettings.findUnique({
    where: { orgId: membership.orgId },
    select: { data: true },
  });

  const data = (orgSettings?.data as Record<string, unknown>) || {};
  const next = {
    ...resolveInboxSettings(data),
    ...payload,
  } as InboxSettings;

  await prisma.orgSettings.upsert({
    where: { orgId: membership.orgId },
    update: {
      data: {
        ...data,
        emailAiInbox: next,
      } as any,
    },
    create: {
      orgId: membership.orgId,
      data: {
        emailAiInbox: next,
      } as any,
    },
  });

  return NextResponse.json({ ok: true, settings: next });
}
