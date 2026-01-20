// app/api/email-ai/inbox/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionOrgFeature } from "@/lib/entitlements";
import { readGmailIntegration } from "@/lib/orgSettings";

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

type SyncState = {
  lastAttemptAt?: number | null;
  lastSuccessAt?: number | null;
  lastErrorAt?: number | null;
  lastError?: string | null;
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

function resolveSyncState(data: Record<string, unknown>): SyncState {
  const raw = (data.emailAiSync as SyncState) || {};
  return {
    lastAttemptAt: typeof raw.lastAttemptAt === "number" ? raw.lastAttemptAt : null,
    lastSuccessAt: typeof raw.lastSuccessAt === "number" ? raw.lastSuccessAt : null,
    lastErrorAt: typeof raw.lastErrorAt === "number" ? raw.lastErrorAt : null,
    lastError: typeof raw.lastError === "string" ? raw.lastError : null,
  };
}

function parseNum(v: string | null, fallback: number) {
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(req: Request) {
  try {
    const gate = await requireSessionOrgFeature("emailAi");
    if (!gate.ok) {
      return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
    }

    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();
    const limit = Math.min(200, Math.max(20, parseNum(url.searchParams.get("limit"), 120)));

    const orgSettings = await prisma.orgSettings.findUnique({
      where: { orgId: gate.orgId },
      select: { data: true },
    });

    const data = (orgSettings?.data as Record<string, unknown>) || {};
    const gmail = readGmailIntegration(data);
    const gmailConnected = gmail.connected;
    const inboxSettings = resolveInboxSettings(data);
    const syncState = resolveSyncState(data);

    const where: any = { orgId: gate.orgId };
    if (q) {
      where.OR = [
        { subject: { contains: q, mode: "insensitive" } },
        { snippet: { contains: q, mode: "insensitive" } },
      ];
    }

    const rows = await (prisma as any).emailAILog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        receivedAt: true,
        subject: true,
        snippet: true,
        gmailThreadId: true,
        gmailMsgId: true,
        rawMeta: true,
        action: true,
        confidence: true,
        classification: true,
        orgId: true,
      },
    });

    const items = rows.map((r: any) => ({
      id: r.id as string,
      createdAt: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)).toISOString(),
      receivedAt: r.receivedAt
        ? (r.receivedAt instanceof Date ? r.receivedAt : new Date(r.receivedAt)).toISOString()
        : null,
      subject: gmailConnected ? (r.subject ?? null) : null,
      snippet: gmailConnected ? (r.snippet ?? null) : null,
      gmailThreadId: gmailConnected ? (r.gmailThreadId ?? null) : null,
      gmailMsgId: gmailConnected ? (r.gmailMsgId ?? null) : null,
      action: r.action ?? null,
      confidence: typeof r.confidence === "number" ? r.confidence : null,
      classification: r.classification ?? null,
      rawMeta: gmailConnected ? (r.rawMeta ?? null) : null,
    }));

    return NextResponse.json({
      ok: true,
      items,
      inboxSettings,
      syncState,
      gmailConnected,
      ts: Date.now(),
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}
