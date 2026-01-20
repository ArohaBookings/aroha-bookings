// app/api/email-ai/action/route.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getToken } from "next-auth/jwt";
import { google } from "googleapis";
import { createHash } from "crypto";
import { readGmailIntegration } from "@/lib/orgSettings";
import { generateEmailReply, hasAI } from "@/lib/ai/client";

// Reuse your real SEND handler (approve/send + dryRun composition)
import { POST as sendPOST } from "@/app/api/email-ai/send/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/* ────────────────────────────────────────────────────────────
   Types
────────────────────────────────────────────────────────────── */
type Op = "approve" | "send" | "save_draft" | "skip" | "rewrite" | "queue_suggested";
type ParsedBody = {
  op?: Op;
  id?: string;
  subject?: string;
  body?: string;
  note?: string;
};

/* ────────────────────────────────────────────────────────────
   Response helpers
────────────────────────────────────────────────────────────── */
function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

function isProd() {
  return process.env.NODE_ENV === "production";
}

/* ────────────────────────────────────────────────────────────
   Small utils
────────────────────────────────────────────────────────────── */
function safeStr(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function buildAiDebug(err: any) {
  const message = String(err?.message || err || "AI error");
  const status =
    typeof err?.status === "number"
      ? err.status
      : typeof err?.response?.status === "number"
      ? err.response.status
      : null;
  let responseBody = "";
  try {
    if (typeof err?.response?.data === "string") responseBody = err.response.data;
    else if (err?.response?.data) responseBody = JSON.stringify(err.response.data);
  } catch {
    responseBody = "";
  }
  if (responseBody.length > 600) responseBody = responseBody.slice(0, 600);
  return { message, status, response: responseBody || null };
}

function clampStr(s: string, max = 3000) {
  if (!s) return s;
  return s.length > max ? s.slice(0, max) : s;
}

function errToDebug(err: any) {
  const status = err?.status ?? err?.response?.status ?? err?.code ?? null;
  const data = err?.response?.data ?? err?.cause ?? null;
  return {
    message: err?.message || String(err),
    status,
    name: err?.name,
    data: typeof data === "string" ? clampStr(data, 4000) : data,
    stack: !isProd() ? err?.stack : undefined,
  };
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fn(ac.signal);
  } finally {
    clearTimeout(t);
  }
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

/* ────────────────────────────────────────────────────────────
   Access control
────────────────────────────────────────────────────────────── */
async function getUserOrgId(email: string) {
  const m = await prisma.membership.findFirst({
    where: { user: { email } },
    select: { orgId: true },
  });
  return m?.orgId ?? null;
}

async function assertAccess(session: any, logId: string) {
  const isSuperAdmin = Boolean((session as any)?.isSuperAdmin);
  const orgId = await getUserOrgId(session.user.email);

  const log = await prisma.emailAILog.findUnique({ where: { id: logId } });
  if (!log) return { ok: false as const, status: 404, error: "Log not found" };

  if (!isSuperAdmin) {
    if (!orgId) return { ok: false as const, status: 403, error: "No org membership" };
    if (log.orgId !== orgId) return { ok: false as const, status: 403, error: "No access to this log" };
  }

  return { ok: true as const, log, isSuperAdmin };
}

async function assertGmailConnected(orgId: string) {
  const os = await prisma.orgSettings.findUnique({
    where: { orgId },
    select: { data: true },
  });
  const gmail = readGmailIntegration((os?.data as Record<string, unknown>) || {});
  if (!gmail.connected) return { ok: false as const, status: 400, error: "Gmail disconnected" };
  return { ok: true as const };
}

/* ────────────────────────────────────────────────────────────
   Gmail token + draft helpers
────────────────────────────────────────────────────────────── */
async function ensureGoogleAccessTokenFromJWT(req: Request, session: any): Promise<string> {
  const sessAT = session?.google?.access_token as string | null;
  if (sessAT) return sessAT;

  const jwt = await getToken({ req: req as any, raw: false, secureCookie: false });
  const g = (jwt as any) || {};
  const rt = g.google_refresh_token as string | undefined;
  const at = g.google_access_token as string | undefined;
  const exp = typeof g.google_expires_at === "number" ? g.google_expires_at : 0;

  if (at && exp && Date.now() < exp - 60_000) return at;
  if (!rt) throw new Error("No Gmail refresh token available");

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error("Missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET");
  }

  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
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

async function createGmailDraft(userAccessToken: string, base64urlRaw: string, threadId?: string | null) {
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

/* ────────────────────────────────────────────────────────────
   Composition helpers
────────────────────────────────────────────────────────────── */
function hashSuggestion(subject: string, body: string) {
  return createHash("sha256").update(`${subject}\n${body}`).digest("hex").slice(0, 24);
}

function buildIdempotencyKey(op: Op, threadOrId: string, subject: string, body: string) {
  const hash = hashSuggestion(subject, body);
  return `${op}:${threadOrId}:${hash}`;
}

function mergeSubjectBody(payload: ParsedBody, log: { subject: string | null; rawMeta: any }) {
  const suggested = ((log.rawMeta as any)?.suggested ?? {}) as { subject?: string; body?: string };

  const subject = (payload.subject ?? suggested.subject ?? log.subject ?? "").toString().trim();
  const body = (payload.body ?? suggested.body ?? "").toString().trim();

  return { subject, body };
}

/* ────────────────────────────────────────────────────────────
   Main handler
────────────────────────────────────────────────────────────── */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email) return json({ ok: false, error: "Not authenticated" }, 401);

    const payload = await readBody(req);
    if (!payload?.op || !payload?.id) return json({ ok: false, error: "Missing op or id" }, 400);

    const access = await assertAccess(session, payload.id);
    if (!access.ok) return json({ ok: false, error: access.error }, access.status);

    const log = access.log;

    // Gmail must be connected for EVERYTHING in this route (matches your original behavior).
    const gOk = await assertGmailConnected(log.orgId);
    if (!gOk.ok) return json({ ok: false, error: gOk.error }, gOk.status);

    const threadOrId = log.gmailThreadId ?? log.gmailMsgId ?? log.id;

    /* -------------------- APPROVE / SEND -------------------- */
    if (payload.op === "approve" || payload.op === "send") {
      const { subject, body } = mergeSubjectBody(payload, { subject: log.subject, rawMeta: log.rawMeta });
      if (!body) return json({ ok: false, error: "No body to send. Provide body (or suggested.body)." }, 400);

      const idemHeader = req.headers.get("Idempotency-Key")?.trim();
      const idempotencyKey = idemHeader || buildIdempotencyKey(payload.op, threadOrId, subject, body);

      // IMPORTANT: calling sendPOST directly; DO NOT rely on cookies being forwarded.
      // Your send route uses getServerSession/authOptions, so this only works if sendPOST
      // does NOT require the incoming request cookies. If it does, switch to fetch(SEND_URL)
      // and forward `cookie` header. (But keep logic same for now.)
      const sendReq = new Request("http://local/api/email-ai/send", {
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
          overrideBody: body,
        }),
      });

      const r = await sendPOST(sendReq);
      const j = (await r.json().catch(() => null)) as any;

      if (!r.ok || !j || j.ok !== true) {
        return json(
          { ok: false, error: j?.error || "Send failed", details: !isProd() ? j : undefined },
          r.status || 500
        );
      }

      return json({
        ok: true,
        id: payload.id,
        action: "auto_sent",
        delivered: true,
        gmailMsgId: j.gmailMsgId ?? null,
      });
    }

    /* -------------------- SAVE DRAFT -------------------- */
    if (payload.op === "save_draft") {
      const { subject, body } = mergeSubjectBody(payload, { subject: log.subject, rawMeta: log.rawMeta });
      if (!body) return json({ ok: false, error: "No suggested reply available for this item." }, 400);

      const prevMeta = (log.rawMeta as any) || {};
      const prevIdem = (prevMeta.idempotency as Record<string, any>) || {};

      const idemHeader = req.headers.get("Idempotency-Key")?.trim();
      const idempotencyKey = idemHeader || buildIdempotencyKey(payload.op, threadOrId, subject, body);

      if (prevIdem[idempotencyKey]?.result) {
        return json({ ok: true, ...prevIdem[idempotencyKey].result, idempotent: true });
      }

      if (prevMeta.draftId) {
        return json({
          ok: true,
          id: log.id,
          action: "draft_created",
          gmailDraftId: prevMeta.draftId,
          gmailMsgId: log.gmailMsgId ?? null,
          editUrl: `https://mail.google.com/mail/u/0/#drafts?compose=${encodeURIComponent(prevMeta.draftId)}`,
          idempotent: true,
        });
      }

      // Compose via /send dryRun (keeps EXACT composition logic centralized)
      const composeReq = new Request("http://local/api/email-ai/send", {
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
      const composed = (await composeRes.json().catch(() => null)) as any;

      if (!composeRes.ok || !composed?.ok || !composed?.dryRun || !composed?.composed?.base64urlRaw) {
        return json(
          { ok: false, error: composed?.error || "Draft compose failed", details: !isProd() ? composed : undefined },
          composeRes.status || 500
        );
      }

      const accessToken = await ensureGoogleAccessTokenFromJWT(req, session);
      const { draftId, msgId } = await createGmailDraft(
        accessToken,
        composed.composed.base64urlRaw as string,
        log.gmailThreadId ?? null
      );

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
        editUrl: draftId ? `https://mail.google.com/mail/u/0/#drafts?compose=${encodeURIComponent(draftId)}` : null,
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

      return json(resultPayload);
    }

    /* -------------------- SKIP -------------------- */
    if (payload.op === "skip") {
      await prisma.emailAILog.update({
        where: { id: log.id },
        data: { action: "skipped_manual" },
      });
      return json({ ok: true, id: log.id, action: "skipped_manual" });
    }

    /* -------------------- QUEUE SUGGESTED (OpenAI-only) -------------------- */
    if (payload.op === "queue_suggested") {
      const raw = (log.rawMeta as any) ?? {};

      if (raw?.suggested?.body) return json({ ok: true, suggested: raw.suggested });

      // hard idempotency to avoid spam-generating
      const idemKey = buildIdempotencyKey("queue_suggested", threadOrId, safeStr(log.subject || "", ""), safeStr(log.snippet || "", ""));
      const prevIdem = (raw.idempotency as Record<string, any>) || {};
      if (prevIdem[idemKey]?.suggested?.body) return json({ ok: true, suggested: prevIdem[idemKey].suggested, idempotent: true });

      if (!hasAI()) {
        const debug = !isProd() ? buildAiDebug("Missing OPENAI_API_KEY") : null;
        await prisma.emailAILog.update({
          where: { id: log.id },
          data: { rawMeta: { ...raw, aiError: "AI unavailable (missing OPENAI_API_KEY?)", ...(debug ? { aiDebug: debug } : {}) } as any },
        });
        return json({ ok: false, error: "AI unavailable", ...(debug ? { debug } : {}) }, 503);
      }

      const settings = await prisma.emailAISettings.findUnique({ where: { orgId: log.orgId } });
      if (!settings?.enabled) {
        await prisma.emailAILog.update({
          where: { id: log.id },
          data: { rawMeta: { ...raw, aiError: "Email AI disabled" } as any },
        });
        return json({ ok: false, error: "Email AI disabled" }, 400);
      }

      const os = await prisma.orgSettings.findUnique({ where: { orgId: log.orgId }, select: { data: true } });
      const data = (os?.data as Record<string, unknown>) || {};
      const voice = (data as any).aiVoice || {};

      const voiceTone =
        typeof voice.tone === "string" && voice.tone.trim() ? voice.tone.trim() : settings.defaultTone || "friendly";

      const voiceSignature =
        typeof voice.signature === "string" ? voice.signature : (settings.signature as string | null | undefined) || null;

      const forbidden = [
        ...(Array.isArray(voice.tabooPhrases) ? voice.tabooPhrases : []),
        ...(Array.isArray(voice.forbiddenPhrases) ? voice.forbiddenPhrases : []),
      ]
        .map((x: any) => safeStr(x, "").trim())
        .filter(Boolean);

      const lengthPref = safeStr(voice.lengthPreference || voice.length || "", "").trim();

      const instructionPrompt = [
        safeStr(settings.instructionPrompt || "", "").trim(),
        forbidden.length ? `Forbidden phrases: ${forbidden.join(", ")}` : "",
        typeof voice.emojiLevel === "number" ? `Emoji level (0-2): ${voice.emojiLevel}` : "",
        lengthPref ? `Preferred reply length: ${lengthPref}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const emailSnippetsArr = Array.isArray((data as any).emailSnippets) ? ((data as any).emailSnippets as any[]) : [];
      const snippets = emailSnippetsArr
        .map((entry: any) => ({ title: safeStr(entry?.title || "", ""), body: safeStr(entry?.body || "", "") }))
        .filter((s) => s.title && s.body);

      const from = safeStr(raw?.from || "", "");
      const threadPeek = Array.isArray(raw?.threadPeek) ? raw.threadPeek : undefined;

      try {
        const reply = await withTimeout(
          async (_signal) =>
            generateEmailReply({
              businessName: safeStr(settings.businessName || "your business", "your business"),
              tone: voiceTone,
              instructionPrompt,
              signature: voiceSignature,
              subject: safeStr(log.subject || "", ""),
              from,
              snippet: safeStr(log.snippet || "", ""),
              label: safeStr(log.classification || "", ""),
              threadPeek,
              snippets,
            }),
          25_000
        );

        const suggested = {
          subject: safeStr(reply.subject, "").trim(),
          body: safeStr(reply.body, "").trim(),
          model: reply.meta?.model || null,
          createdAt: Date.now(),
        };

        if (!suggested.body) {
          const e = new Error("AI returned empty body");
          throw e;
        }

        await prisma.emailAILog.update({
          where: { id: log.id },
          data: {
            rawMeta: {
              ...raw,
              suggested,
              aiError: null,
              idempotency: {
                ...prevIdem,
                [idemKey]: { at: new Date().toISOString(), op: "queue_suggested", suggested },
              },
            } as any,
          },
        });

        return json({ ok: true, suggested });
      } catch (err: any) {
        const debug = !isProd() ? buildAiDebug(err) : null;

        await prisma.emailAILog.update({
          where: { id: log.id },
          data: {
            rawMeta: {
              ...raw,
              aiError: debug?.message || err?.message || "AI reply generation failed",
              aiDebug: debug ?? undefined, // keep prod clean
            } as any,
          },
        });

        // return the debug payload so you can see the REAL failure in DevTools Network
        return json(
          {
            ok: false,
            error: debug?.message || err?.message || "AI reply generation failed",
            debug: debug ?? undefined,
          },
          502
        );
      }
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

      return json({ ok: true, id: log.id, action: "rewrite_requested" });
    }

    return json({ ok: false, error: "Unknown op" }, 400);
  } catch (err: any) {
    console.error("[email-ai/action] error:", errToDebug(err));
    const msg = err?.message || "Server error";
    const isAuth = /refresh token|No Gmail refresh token|Invalid Credentials|401/i.test(msg);
    return json({ ok: false, error: msg, type: isAuth ? "auth" : "server" }, isAuth ? 401 : 500);
  }
}
