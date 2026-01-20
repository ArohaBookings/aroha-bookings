// app/api/email-ai/log/[id]/route.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { readGmailIntegration } from "@/lib/orgSettings";
import { getToken } from "next-auth/jwt";
import { google } from "googleapis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/* ───────────────────────────────────────────────────────────────
   Utils
────────────────────────────────────────────────────────────── */
const nocache = { "Cache-Control": "no-store, max-age=0" };

function headerVal(
  headers: Array<{ name?: string; value?: string }> | undefined,
  name: string
) {
  if (!headers?.length) return "";
  const row = headers.find((x) => (x?.name || "").toLowerCase() === name.toLowerCase());
  return (row?.value || "").trim();
}

function s(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (v == null) return fallback;
  try {
    return String(v);
  } catch {
    return fallback;
  }
}

function iso(d?: Date | string | null) {
  if (!d) return null;
  try {
    return (d instanceof Date ? d : new Date(d)).toISOString();
  } catch {
    return null;
  }
}

function cloneSmall(obj: any, init?: any) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return init ?? null;
  }
}

/** Try session token first; if expired/missing, refresh from JWT. */
async function ensureGoogleAccessToken(req: Request, session: any): Promise<string | null> {
  const sessAT = session?.google?.access_token as string | null;
  if (sessAT) return sessAT;

  const jwt = await getToken({ req: req as any, raw: false, secureCookie: false });
  const g = (jwt as any) || {};
  const rt = g.google_refresh_token as string | undefined;
  const at = g.google_access_token as string | undefined;
  const exp = typeof g.google_expires_at === "number" ? g.google_expires_at : 0;

  if (at && exp && Date.now() < exp - 60_000) return at; // valid w/ 1m skew
  if (!rt) return null;

  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    refresh_token: rt,
    grant_type: "refresh_token",
  });

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) return null;
  return j.access_token as string;
}

/* ───────────────────────────────────────────────────────────────
   GET /api/email-ai/log/:id
────────────────────────────────────────────────────────────── */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 0) Validate param
    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { ok: false, error: "Missing log id" },
        { status: 400, headers: nocache }
      );
    }

    // 1) Auth + org resolution
    const session = await auth();
    const viewer = session?.user?.email || null;
    if (!viewer) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401, headers: nocache }
      );
    }

    const isSuperAdmin = Boolean((session as any)?.isSuperAdmin);
    const url = new URL(req.url);
    const requestedOrgId = url.searchParams.get("orgId") || null;

    // 2) Fetch log
    const log = await prisma.emailAILog.findUnique({ where: { id } });
    if (!log) {
      return NextResponse.json(
        { ok: false, error: "Log not found" },
        { status: 404, headers: nocache }
      );
    }

    // 3) Enforce org access (superadmin may override via ?orgId)
    if (isSuperAdmin && requestedOrgId && requestedOrgId !== log.orgId) {
      // superadmin asked for a different org than this log belongs to -> forbid
      return NextResponse.json(
        { ok: false, error: "Log does not belong to requested org" },
        { status: 403, headers: nocache }
      );
    }

    if (!isSuperAdmin) {
      const membership = await prisma.membership.findFirst({
        where: { user: { email: viewer }, orgId: log.orgId },
        select: { orgId: true },
      });
      if (!membership) {
        return NextResponse.json(
          { ok: false, error: "No access to this organization" },
          { status: 403, headers: nocache }
        );
      }
    }

    const settingsRow = await prisma.orgSettings.findUnique({
      where: { orgId: log.orgId },
      select: { data: true },
    });
    const settingsData = (settingsRow?.data as Record<string, unknown>) || {};
    const gmail = readGmailIntegration(settingsData);
    const gmailConnected = gmail.connected;

    // 4) Build base payload (stable shape for the Edit page)
    const rawMeta = (log.rawMeta ?? {}) as any;
    const suggested = gmailConnected ? cloneSmall(rawMeta?.suggested) || undefined : undefined;
    const lastDraftPreview = gmailConnected ? cloneSmall(rawMeta?.lastDraftPreview) || undefined : undefined;
    const draftId = gmailConnected ? s(rawMeta?.draftId, "") || undefined : undefined;
    const ai = cloneSmall(rawMeta?.ai) || undefined;

    // Provide a Gmail draft edit link if we have a draftId
    const editUrl = draftId
      ? `https://mail.google.com/mail/u/0/#drafts?compose=${encodeURIComponent(draftId)}`
      : null;

    const base = {
      ok: true,
      id: log.id,
      orgId: log.orgId,
      createdAt: iso(log.createdAt),
      subject: gmailConnected ? s(log.subject, "(no subject)") : "Connect Gmail to view email",
      snippet: gmailConnected ? s(log.snippet, "") : "",
      classification: s(log.classification, "other"),
      action: s(log.action, "queued_for_review"),
      confidence: typeof log.confidence === "number" ? log.confidence : null,
      gmailThreadId: gmailConnected ? s(log.gmailThreadId, "") || null : null,

      // edit helpers
      suggested,           // { subject?, body? } if present
      lastDraftPreview,    // { to, subject, body } from save_draft
      draftId,             // for client logic
      editUrl,             // deep-link to Gmail draft if exists

      // thread preview (filled below)
      thread: [] as Array<{ id: string; date: string; from: string; body: string }>,

      // tiny meta preview if client wants to show origin
      meta: {
        from: gmailConnected ? s(rawMeta?.from, "") || undefined : undefined,
        replyTo: gmailConnected ? s(rawMeta?.replyTo, "") || undefined : undefined,
      },
      ai,
      gmailConnected,
    };

    // 5) Try to fetch a light Gmail thread preview (soft-fail)
    const accessToken = await ensureGoogleAccessToken(req, session);
    if (gmailConnected && accessToken && base.gmailThreadId) {
      try {
        const auth2 = new google.auth.OAuth2();
        auth2.setCredentials({ access_token: accessToken });
        const gmail = google.gmail({ version: "v1", auth: auth2 });

        const resp = await gmail.users.threads.get({
          userId: "me",
          id: base.gmailThreadId,
          format: "metadata",
          metadataHeaders: ["From", "Date", "Subject"],
        });

        const messages = resp.data.messages ?? [];
        const tail = messages.slice(-6); // last few only

        base.thread = tail.map((m) => ({
          id: s(m.id),
          date: headerVal(m.payload?.headers as any[], "Date"),
          from: headerVal(m.payload?.headers as any[], "From"),
          body: s(m.snippet, ""),
        }));
      } catch (err: any) {
        // don't kill the endpoint if Gmail preview fails
        console.warn("[email-ai/log:id] Gmail preview failed:", err?.message || err);
        (base as any).gmailError = true;
      }
    }

    return NextResponse.json(base, { headers: nocache });
  } catch (err: any) {
    console.error("[email-ai/log:id] fatal:", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Server error" },
      { status: 500, headers: nocache }
    );
  }
}

/* Optional: CORS preflight if you ever embed this viewer externally */
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      ...nocache,
      "Access-Control-Allow-Origin": process.env.NEXTAUTH_URL || "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
