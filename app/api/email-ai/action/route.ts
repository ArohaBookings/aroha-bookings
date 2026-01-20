// app/api/email-ai/action/route.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getToken } from "next-auth/jwt";
import { google } from "googleapis";
import { createHash } from "crypto";
import { readGmailIntegration } from "@/lib/orgSettings";

// Reuse your real SEND handler (approve/send + dryRun composition)
import { POST as sendPOST } from "@/app/api/email-ai/send/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/* ────────────────────────────────────────────────────────────
   Types
────────────────────────────────────────────────────────────── */
type Op = "approve" | "send" | "save_draft" | "skip" | "rewrite";
type ParsedBody = {
  op?: Op;
  id?: string;
  subject?: string;
  body?: string;
  note?: string;
};

/* ────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────── */
async function getUserOrgId(email: string) {
  const m = await prisma.membership.findFirst({
    where: { user: { email } },
    select: { orgId: true },
  });
  return m?.orgId ?? null;
}

/** Accept JSON, form, or raw-urlencoded text. */
async function readBody(req: Request): Promise<ParsedBody> {
  const ct = (req.headers.get("content-type") || "").toLowerCase();

  // JSON
  if (ct.includes("application/json")) {
    try {
      const j = await req.json();
      return {
        op: j?.op as Op | undefined,
        id: typeof j?.id === "string" ? j.id : undefined,
        body: typeof j?.body === "string" ? j.body : undefined,
        subject: typeof j?.subject === "string" ? j.subject : undefined,
        note: typeof j?.note === "string" ? j.note : undefined,
      };
    } catch {
      return {};
    }
  }

  // Form posts (buttons)
  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    try {
      const fd = await req.formData();
      const val = (k: string) => {
        const v = fd.get(k);
        return typeof v === "string" ? v : undefined;
      };
      return {
        op: val("op") as Op | undefined,
        id: val("id"),
        body: val("body"),
        subject: val("subject"),
        note: val("note"),
      };
    } catch {
      return {};
    }
  }

  // Raw urlencoded
  try {
    const txt = await req.text();
    const p = new URLSearchParams(txt);
    const get = (k: string) => p.get(k) ?? undefined;
    return {
      op: get("op") as Op | undefined,
      id: get("id"),
      body: get("body"),
      subject: get("subject"),
      note: get("note"),
    };
  } catch {
    return {};
  }
}

/** Ensure a Gmail access token (session first, else refresh via JWT). */
async function ensureGoogleAccessTokenFromJWT(req: Request, session: any): Promise<string> {
  const sessAT = session?.google?.access_token as string | null;
  if (sessAT) return sessAT;

  const jwt = await getToken({ req: req as any, raw: false, secureCookie: false });
  const g = (jwt as any) || {};
  const rt = g.google_refresh_token as string | undefined;
  const at = g.google_access_token as string | undefined;
  const exp = typeof g.google_expires_at === "number" ? g.google_expires_at : 0;

  if (at && exp && Date.now() < exp - 60_000) return at; // still valid (1m skew)
  if (!rt) throw new Error("No Gmail refresh token available");

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
  if (!r.ok || !j.access_token) {
    throw new Error(`Google token refresh failed: ${j.error || r.status}`);
  }
  return j.access_token as string;
}

/** Create a Gmail draft from base64url raw (thread-aware). */
async function createGmailDraft(
  userAccessToken: string,
  base64urlRaw: string,
  threadId?: string | null
) {
  const auth2 = new google.auth.OAuth2();
  auth2.setCredentials({ access_token: userAccessToken });
  const gmail = google.gmail({ version: "v1", auth: auth2 });

  const res = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: {
        raw: base64urlRaw,
        threadId: threadId || undefined,
      } as any,
    },
  });

  const draftId = (res.data?.id as string | undefined) ?? null;
  const msgId = (res.data?.message?.id as string | undefined) ?? null;
  return { draftId, msgId };
}

/** Safe absolute origin for internal route-to-route calls. */
function resolveOrigin(req: Request): string {
  const envOrigin =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://aroha-bookings.vercel.app";

  const proto = req.headers.get("x-forwarded-proto");
  const host = req.headers.get("x-forwarded-host");
  if (proto && host) return `${proto}://${host}`;

  try {
    const u = new URL(req.url);
    if (u.origin && u.origin !== "null") return u.origin;
  } catch {
    /* noop */
  }
  return envOrigin;
}

/** Merge UI payload with suggested (and basic log subject) */
function mergeSubjectBody(
  payload: ParsedBody,
  log: { subject: string | null; rawMeta: any }
): { subject: string; body: string } {
  const suggested = ((log.rawMeta as any)?.suggested ?? {}) as {
    subject?: string;
    body?: string;
  };

  const subject =
    (payload.subject ?? suggested.subject ?? log.subject ?? "").toString().trim();

  const body =
    (payload.body ?? suggested.body ?? "").toString().trim();

  return { subject, body };
}

function hashSuggestion(subject: string, body: string) {
  return createHash("sha256").update(`${subject}\n${body}`).digest("hex").slice(0, 24);
}

function buildIdempotencyKey(op: Op, threadId: string | null, subject: string, body: string) {
  const base = threadId || "no-thread";
  const hash = hashSuggestion(subject, body);
  return `${op}:${base}:${hash}`;
}

/* ────────────────────────────────────────────────────────────
   Route: POST
────────────────────────────────────────────────────────────── */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    const payload = await readBody(req);
    if (!payload?.op || !payload?.id) {
      return NextResponse.json({ ok: false, error: "Missing op or id" }, { status: 400 });
    }

    const isSuperAdmin = Boolean((session as any)?.isSuperAdmin);
    const orgId = await getUserOrgId(session.user.email);

    const log = await prisma.emailAILog.findUnique({ where: { id: payload.id } });
    if (!log) {
      return NextResponse.json({ ok: false, error: "Log not found" }, { status: 404 });
    }

    // Enforce org boundary unless superadmin
    if (!isSuperAdmin) {
      if (!orgId) {
        return NextResponse.json({ ok: false, error: "No org membership" }, { status: 403 });
      }
      if (log.orgId !== orgId) {
        return NextResponse.json({ ok: false, error: "No access to this log" }, { status: 403 });
      }
    }

    const orgSettings = await prisma.orgSettings.findUnique({
      where: { orgId: log.orgId },
      select: { data: true },
    });
    const gmail = readGmailIntegration((orgSettings?.data as Record<string, unknown>) || {});
    if (!gmail.connected) {
      return NextResponse.json({ ok: false, error: "Gmail disconnected" }, { status: 400 });
    }

    const ORIGIN = resolveOrigin(req);
    const SEND_URL = `${ORIGIN}/api/email-ai/send`;

    /* -------------------- APPROVE / SEND -------------------- */
    if (payload.op === "approve" || payload.op === "send") {
      // merge UI fields with any saved suggestion on the log
      const { subject, body } = mergeSubjectBody(payload, {
        subject: log.subject,
        rawMeta: log.rawMeta,
      });
      const idemHeader = req.headers.get("Idempotency-Key")?.trim();
      const idempotencyKey =
        idemHeader || buildIdempotencyKey(payload.op, log.gmailThreadId ?? log.gmailMsgId ?? log.id, subject, body);

      if (!body) {
        return NextResponse.json(
          { ok: false, error: "No body to send. Provide body (or suggested.body)." },
          { status: 400 }
        );
      }

      // Call the real /send handler in-process (no cookie forwarding needed)
      const sendReq = new Request(SEND_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          logId: payload.id,
          subject,
          body,
          overrideBody: body, // keep for older code paths
        }),
      });

      const r = await sendPOST(sendReq);
      const j = (await r.json()) as any;

      if (!r.ok || !j || j.ok !== true) {
        return NextResponse.json(
          { ok: false, error: j?.error || "Send failed", details: j },
          { status: r.status || 500 }
        );
      }

      // /send updates DB → action:auto_sent
      return NextResponse.json({
        ok: true,
        id: payload.id,
        action: "auto_sent",
        delivered: true,
        gmailMsgId: j.gmailMsgId ?? null,
      });
    }

    /* -------------------- SAVE DRAFT -------------------- */
    if (payload.op === "save_draft") {
      // Merge inputs and insist on a body (no generic fallback)
      const { subject, body } = mergeSubjectBody(payload, {
        subject: log.subject,
        rawMeta: log.rawMeta,
      });
      const idemHeader = req.headers.get("Idempotency-Key")?.trim();
      const idempotencyKey =
        idemHeader || buildIdempotencyKey(payload.op, log.gmailThreadId ?? log.gmailMsgId ?? log.id, subject, body);

      if (!body) {
        return NextResponse.json(
          { ok: false, error: "No suggested reply available for this item." },
          { status: 400 }
        );
      }

      const prevMeta = (log.rawMeta as any) || {};
      const prevIdem = (prevMeta.idempotency as Record<string, any>) || {};
      if (prevIdem[idempotencyKey]?.result) {
        return NextResponse.json({ ok: true, ...prevIdem[idempotencyKey].result, idempotent: true });
      }
      if (prevMeta.draftId) {
        return NextResponse.json({
          ok: true,
          id: log.id,
          action: "draft_created",
          gmailDraftId: prevMeta.draftId,
          gmailMsgId: log.gmailMsgId ?? null,
          editUrl: prevMeta.draftId
            ? `https://mail.google.com/mail/u/0/#drafts?compose=${encodeURIComponent(prevMeta.draftId)}`
            : null,
          idempotent: true,
        });
      }

      // Compose exactly what /send would send, but as a dryRun
      const composeReq = new Request(SEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          logId: payload.id,
          dryRun: true,
          subject,
          body,
          overrideBody: body,
        }),
      });

      const composeRes = await sendPOST(composeReq);
      const composed = (await composeRes.json()) as any;

      if (
        !composeRes.ok ||
        !composed?.ok ||
        !composed?.dryRun ||
        !composed?.composed?.base64urlRaw
      ) {
        return NextResponse.json(
          { ok: false, error: composed?.error || "Draft compose failed", details: composed },
          { status: composeRes.status || 500 }
        );
      }

      // Create the draft in Gmail
      const accessToken = await ensureGoogleAccessTokenFromJWT(req, session);
      const { draftId, msgId } = await createGmailDraft(
        accessToken,
        composed.composed.base64urlRaw as string,
        log.gmailThreadId ?? null
      );

      // Update DB to reflect a draft exists
      const audit = Array.isArray(prevMeta.audit) ? prevMeta.audit : [];
      audit.push({
        at: new Date().toISOString(),
        by: session.user.email,
        action: "draft_created",
        note: "Created via /api/email-ai/action save_draft",
      });

      const resultPayload = {
        ok: true,
        id: log.id,
        action: "draft_created",
        gmailDraftId: draftId,
        gmailMsgId: msgId ?? null,
        editUrl: draftId
          ? `https://mail.google.com/mail/u/0/#drafts?compose=${encodeURIComponent(draftId)}`
          : null,
      };

      await prisma.emailAILog.update({
        where: { id: log.id },
        data: {
          action: "draft_created",
          direction: "draft",
          gmailMsgId: msgId ?? log.gmailMsgId,
          rawMeta: {
            ...prevMeta,
            audit,
            draftId: draftId ?? prevMeta.draftId,
            lastDraftPreview: {
              to: composed.composed.to,
              subject,
              body,
            },
            idempotency: {
              ...prevIdem,
              [idempotencyKey]: { at: new Date().toISOString(), op: "save_draft", result: resultPayload },
            },
          } as any,
        },
      });

      return NextResponse.json(resultPayload);
    }

    /* -------------------- SKIP -------------------- */
    if (payload.op === "skip") {
      await prisma.emailAILog.update({
        where: { id: log.id },
        data: { action: "skipped_manual" },
      });
      return NextResponse.json({ ok: true, id: log.id, action: "skipped_manual" });
    }

    /* -------------------- REWRITE FLAG -------------------- */
    if (payload.op === "rewrite") {
      const raw = (log.rawMeta as any) ?? {};
      raw.rewriteRequested = true;
      if (payload.note) raw.rewriteNote = payload.note;

      await prisma.emailAILog.update({
        where: { id: log.id },
        data: { rawMeta: raw as any },
      });
      return NextResponse.json({ ok: true, id: log.id, action: "rewrite_requested" });
    }

    return NextResponse.json({ ok: false, error: "Unknown op" }, { status: 400 });
  } catch (err: any) {
    console.error("[email-ai/action] error:", err);
    const msg = err?.message || "Server error";
    const isAuth = /refresh token|No Gmail refresh token|Invalid Credentials|401/i.test(msg);
    return NextResponse.json(
      { ok: false, error: msg, type: isAuth ? "auth" : "server" },
      { status: isAuth ? 401 : 500 }
    );
  }
}
