// app/api/email-ai/logs/route.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { readGmailIntegration } from "@/lib/orgSettings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/** Canonical action names used across your app */
const ACTION = {
  QUEUED: "queued_for_review",
  DRAFT: "draft_created",
  SENT: "auto_sent",
  SKIPPED: "skipped_manual",
} as const;

type Tab = "inbox" | "drafts" | "sent" | "skipped";

/** Map UI tabs to server-side actions */
function actionsForTab(tab: Tab): readonly string[] {
  switch (tab) {
    case "inbox":
      // Only items awaiting review (not drafts)
      return [ACTION.QUEUED];
    case "drafts":
      return [ACTION.DRAFT];
    case "sent":
      return [ACTION.SENT];
    case "skipped":
      return [ACTION.SKIPPED];
    default:
      return [ACTION.QUEUED];
  }
}

function clampInt(n: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function safeISOToDate(s: string | null): Date | null {
  if (!s) return null;
  try {
    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? d : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    const url = new URL(req.url);

    // --- query params (all sanitized) ---
    const tabParam = (url.searchParams.get("tab") || "inbox").toLowerCase();
    const tab: Tab =
      tabParam === "drafts" || tabParam === "sent" || tabParam === "skipped" ? (tabParam as Tab) : "inbox";

    const q = (url.searchParams.get("q") || "").trim();
    const classFilter = (url.searchParams.get("class") || "").trim().toLowerCase(); // e.g., inquiry/job/support/other
    const minConfRaw = Number(url.searchParams.get("minConf") || "");
    const minConf = Number.isFinite(minConfRaw) ? Math.max(0, Math.min(100, minConfRaw)) : null;

    const limit = clampInt(Number(url.searchParams.get("limit") || 25), 1, 100, 25);
    const offset = clampInt(Number(url.searchParams.get("offset") || 0), 0, 10000, 0);

    // optional time cursor: only return items created before this ISO timestamp
    const beforeISO = url.searchParams.get("before");
    const beforeDate = safeISOToDate(beforeISO);

    // superadmin can pass orgId query to view another org
    const requestedOrgId = url.searchParams.get("orgId") || null;
    const isSuperAdmin = Boolean((session as any)?.isSuperAdmin);

    // Resolve orgId for the viewer
    let orgId: string | null = null;
    if (isSuperAdmin && requestedOrgId) {
      orgId = requestedOrgId;
    } else {
      const m = await prisma.membership.findFirst({
        where: { user: { email: session.user.email } },
        select: { orgId: true },
        orderBy: { orgId: "asc" },
      });
      if (!m) {
        return NextResponse.json({ ok: false, error: "No org membership" }, { status: 403 });
      }
      orgId = m.orgId;
    }

    const actions = actionsForTab(tab);

    const settingsRow = await prisma.orgSettings.findUnique({
      where: { orgId },
      select: { data: true },
    });
    const settingsData = (settingsRow?.data as Record<string, unknown>) || {};
    const gmail = readGmailIntegration(settingsData);
    const gmailConnected = gmail.connected;

    // --- build where clause safely ---
    const where: any = {
      orgId,
      action: { in: actions as any },
    };

    if (q) {
      where.OR = [
        { subject: { contains: q, mode: "insensitive" } },
        { snippet: { contains: q, mode: "insensitive" } },
      ];
    }

    if (classFilter) {
      // stored lowercased on the review page; keep compare simple
      where.classification = classFilter;
    }

    if (minConf !== null) {
      // DB stores confidence as 0..1 float
      where.confidence = { gte: minConf / 100 };
    }

    if (beforeDate) {
      where.createdAt = { lt: beforeDate };
    }

    // --- fetch rows + total (rawMeta selected to derive minimal flags, then stripped) ---
    const [rawRows, total] = await Promise.all([
      prisma.emailAILog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          createdAt: true,
          subject: true,
          snippet: true,
          action: true,
          classification: true,
          confidence: true,
          gmailThreadId: true,
          gmailMsgId: true,
          rawMeta: true, // we'll derive flags from this, then omit
        },
        take: limit,
        skip: offset,
      }),
      prisma.emailAILog.count({ where }),
    ]);

    // derive lightweight flags and strip rawMeta
    const rows = rawRows.map((r) => {
      const rm = (r as any).rawMeta || {};
      const hasDraft = gmailConnected ? Boolean(rm.draftId) : false;
      const hasSuggested = gmailConnected
        ? Boolean(rm.suggested && (rm.suggested.subject || rm.suggested.body))
        : false;
      return {
        id: r.id,
        createdAt: r.createdAt,
        subject: gmailConnected ? r.subject : null,
        snippet: gmailConnected ? r.snippet : null,
        action: r.action,
        classification: r.classification,
        confidence: r.confidence,
        gmailThreadId: gmailConnected ? r.gmailThreadId : null,
        gmailMsgId: gmailConnected ? r.gmailMsgId : null,
        hasDraft,
        hasSuggested,
        gmailConnected,
      };
    });

    // compute next cursor (ISO) for infinite scroll if desired
    const nextCursor =
      rows.length === limit ? rows[rows.length - 1]?.createdAt?.toISOString?.() ?? null : null;

    return NextResponse.json({
      ok: true,
      tab,
      orgId,
      total,
      count: rows.length,
      nextCursor, // pass to client as ?before=<nextCursor>
      rows,
    });
  } catch (err: any) {
    console.error("[email-ai/logs] error:", err);
    const msg = err?.message || "Server error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
