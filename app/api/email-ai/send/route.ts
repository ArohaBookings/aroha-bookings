// app/api/email-ai/send/route.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { google, gmail_v1 } from "googleapis";
import { getOrgEntitlements } from "@/lib/entitlements";
import { resolveEmailIdentity } from "@/lib/emailIdentity";
import { createHash } from "crypto";
import { readGmailIntegration } from "@/lib/orgSettings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/* ──────────────────────────────────────────────
   SMALL UTILS
────────────────────────────────────────────── */
function b64url(s: string) {
  return Buffer.from(s)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function header(
  headers: Array<{ name?: string; value?: string }> | undefined,
  name: string
): string {
  if (!headers) return "";
  const n = name.toLowerCase();
  const h = headers.find((x) => String(x?.name || "").toLowerCase() === n);
  return (h?.value || "").trim();
}

function normalizeSubject(raw: string | null | undefined): string {
  const s = (raw || "").trim();
  if (!s) return "Re: (no subject)";
  return s.toLowerCase().startsWith("re:") ? s : `Re: ${s}`;
}

function hashSuggestion(subject: string, body: string) {
  return createHash("sha256").update(`${subject}\n${body}`).digest("hex").slice(0, 24);
}

function buildReplyRaw(opts: {
  to: string;
  subject: string;
  inReplyTo?: string;
  references?: string;
  body: string;
  from?: string;
  replyTo?: string;
  labelTag?: string;
}) {
  const lines = [
    `To: ${opts.to}`,
    ...(opts.from ? [`From: ${opts.from}`] : []),
    ...(opts.replyTo ? [`Reply-To: ${opts.replyTo}`] : []),
    `Subject: ${opts.subject}`,
    ...(opts.inReplyTo ? [`In-Reply-To: ${opts.inReplyTo}`] : []),
    ...(opts.references ? [`References: ${opts.references}`] : []),
    `X-ArohaAI-Tag: ${opts.labelTag || "Aroha-AI-Email"}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    opts.body,
  ];
  return lines.join("\r\n");
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function firstString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

async function safeJson<T = any>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

function requireEnv(name: string) {
  const v = (process.env[name] || "").trim();
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function looksLikeAuthError(msg: string) {
  return /Invalid Credentials|invalid_grant|unauthorized|401|403|No Gmail refresh token/i.test(msg);
}

/* ──────────────────────────────────────────────
   GMAIL ACCESS TOKEN (session → JWT refresh)
────────────────────────────────────────────── */
async function ensureGoogleAccessToken(req: Request, session: any): Promise<string> {
  const sessToken = (session as any)?.google?.access_token as string | null;
  if (sessToken) return sessToken;

  const jwt = await getToken({ req: req as any, raw: false, secureCookie: false });
  const g = (jwt as any) || {};
  const rt = g.google_refresh_token as string | undefined;
  const at = g.google_access_token as string | undefined;
  const exp = typeof g.google_expires_at === "number" ? g.google_expires_at : 0;

  if (at && exp && Date.now() < exp - 60_000) return at;
  if (!rt) throw new Error("No Gmail refresh token in JWT");

  const body = new URLSearchParams({
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
    refresh_token: rt,
    grant_type: "refresh_token",
  });

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const j = await r.json().catch(() => ({} as any));
  if (!r.ok || !j.access_token) {
    throw new Error(`Google token refresh failed: ${j.error || r.status}`);
  }
  return j.access_token as string;
}

/* ──────────────────────────────────────────────
   MAIN HANDLER
────────────────────────────────────────────── */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    const bodyJson = await safeJson<any>(req);
    if (!bodyJson) {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const logId = firstString(bodyJson.logId);
    const overrideBody = firstString(bodyJson.overrideBody) ?? undefined;
    const dryRun = Boolean(bodyJson.dryRun);
    const uiSubject = firstString(bodyJson.subject) ?? undefined;
    const uiBody = firstString(bodyJson.body) ?? undefined;

    if (!logId) {
      return NextResponse.json({ ok: false, error: "Missing logId" }, { status: 400 });
    }

    const log = await prisma.emailAILog.findUnique({ where: { id: logId } });
    if (!log) return NextResponse.json({ ok: false, error: "Log not found" }, { status: 404 });

    // idempotency: already sent
    if (log.action === "auto_sent") {
      return NextResponse.json({ ok: true, delivered: true, gmailMsgId: log.gmailMsgId ?? null });
    }

    const membership = await prisma.membership.findFirst({
      where: { user: { email: session.user.email }, orgId: log.orgId },
      select: { orgId: true },
    });
    if (!membership) return NextResponse.json({ ok: false, error: "No access to org" }, { status: 403 });

    const orgSettingsRow = await prisma.orgSettings.findUnique({
      where: { orgId: log.orgId },
      select: { data: true },
    });

    // ✅ FIX TS2451: don't redeclare `gmail`
    const gmailIntegration = readGmailIntegration((orgSettingsRow?.data as Record<string, unknown>) || {});
    if (!gmailIntegration.connected) {
      return NextResponse.json({ ok: false, error: "Gmail disconnected" }, { status: 400 });
    }

    const settings = await prisma.emailAISettings.findUnique({ where: { orgId: log.orgId } });
    if (!settings?.enabled) return NextResponse.json({ ok: false, error: "Email AI disabled" }, { status: 400 });

    const entitlements = await getOrgEntitlements(log.orgId);
    if (!entitlements.features.emailAi) {
      return NextResponse.json({ ok: false, error: "Email AI disabled for this org" }, { status: 403 });
    }

    let accessToken: string | null = null;
    try {
      accessToken = await ensureGoogleAccessToken(req, session);
    } catch (e: any) {
      const msg = e?.message || "Failed to obtain Gmail access token";
      console.error("ensureGoogleAccessToken error:", msg);
      return NextResponse.json(
        { ok: false, error: msg, type: looksLikeAuthError(msg) ? "auth" : "upstream" },
        { status: looksLikeAuthError(msg) ? 401 : 502 }
      );
    }

    if (!accessToken) {
      return NextResponse.json(
        { ok: false, error: "Failed to obtain Gmail access token", type: "auth" },
        { status: 401 }
      );
    }

    const oauth2 = new google.auth.OAuth2();
    oauth2.setCredentials({ access_token: accessToken });

    // ✅ FIX TS2339: strongly type the Gmail client so `.users.*` exists
    const gmailClient: gmail_v1.Gmail = google.gmail({ version: "v1", auth: oauth2 });

    /* ──────────────────────────────────────────────
       FETCH THREAD CONTEXT
    ─────────────────────────────────────────────── */
    let toHeader = "";
    let inReplyTo = "";
    let references = "";
    let subject = log.subject ? normalizeSubject(log.subject) : "Re: (no subject)";

    if (log.gmailThreadId) {
      try {
        const thread = await gmailClient.users.threads.get({
          userId: "me",
          id: log.gmailThreadId,
          format: "metadata",
        });

        const last = thread.data.messages?.slice(-1)[0];
        const headers = (last?.payload?.headers || []) as any[];

        const originalFrom = header(headers, "From");
        const originalSubject = header(headers, "Subject");
        const originalMsgId = header(headers, "Message-ID");
        const prevRefs = header(headers, "References");

        toHeader = originalFrom || toHeader;
        subject = normalizeSubject(originalSubject || subject);
        inReplyTo = originalMsgId;
        references = [prevRefs, originalMsgId].filter(Boolean).join(" ").trim();
      } catch (e: any) {
        // Thread context improves headers but is not required to send a reply.
        const msg = e?.message || "Thread fetch failed";
        console.warn("gmail threads.get failed:", msg);
      }
    }

    if (!toHeader) {
      const rm = (log.rawMeta as any) || {};
      toHeader = String(rm.replyTo || rm.from || "").trim();
    }
    if (!toHeader) {
      return NextResponse.json({ ok: false, error: "Could not determine recipient" }, { status: 400 });
    }

    /* ──────────────────────────────────────────────
       COMPOSE SUBJECT & BODY
    ─────────────────────────────────────────────── */
    const suggestedRaw = (log.rawMeta as any)?.suggested ?? {};
    const suggested = {
      subject: typeof suggestedRaw?.subject === "string" ? suggestedRaw.subject : undefined,
      body: typeof suggestedRaw?.body === "string" ? suggestedRaw.body : undefined,
    } as { subject?: string; body?: string };

    if (uiSubject && uiSubject.trim()) subject = uiSubject.trim();
    else if (suggested.subject && suggested.subject.trim()) subject = suggested.subject.trim();

    let body = (overrideBody ?? uiBody ?? suggested.body ?? "").toString().trim();

    if (!body) {
      return NextResponse.json(
        { ok: false, error: "No body to send. Provide body (or suggested.body)." },
        { status: 400 }
      );
    }

    const idemHeader = req.headers.get("Idempotency-Key")?.trim();
    const idemKey =
      idemHeader || `send:${log.gmailThreadId ?? log.gmailMsgId ?? log.id}:${hashSuggestion(subject, body)}`;

    const prevMeta = (log.rawMeta as any) || {};
    const prevIdem = (prevMeta.idempotency as Record<string, any>) || {};
    if (!dryRun && prevIdem[idemKey]?.result?.gmailMsgId) {
      return NextResponse.json({
        ok: true,
        delivered: true,
        gmailMsgId: prevIdem[idemKey].result.gmailMsgId,
        idempotent: true,
      });
    }

    if (settings.signature) {
      const sig = settings.signature.trim();
      if (sig) {
        const normBody = body.replace(/\s+$/g, "");
        const normSig = sig.replace(/^\s+|\s+$/g, "");
        if (!normBody.endsWith(normSig)) {
          body = `${normBody}\n\n${normSig}`;
        }
      }
    }

    const identity = await resolveEmailIdentity(log.orgId, "");

    let senderEmail: string | null = null;
    try {
      const profile = await gmailClient.users.getProfile({ userId: "me" });
      senderEmail = profile.data.emailAddress ?? null;
    } catch {
      senderEmail = null;
    }

    const raw = buildReplyRaw({
      to: toHeader,
      subject,
      inReplyTo,
      references,
      body,
      from: senderEmail ? `${identity.fromName} <${senderEmail}>` : undefined,
      replyTo: identity.replyTo,
      labelTag: `Aroha-${log.orgId}`,
    });

    /* ──────────────────────────────────────────────
       DRY RUN PREVIEW
    ─────────────────────────────────────────────── */
    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        composed: {
          to: toHeader,
          subject,
          body,
          base64urlRaw: b64url(raw),
          tokenEstimate: body.length,
        },
      });
    }

    /* ──────────────────────────────────────────────
       SEND WITH RETRY / BACKOFF
    ─────────────────────────────────────────────── */
    let sendRes: gmail_v1.Schema$Message | null = null;
    let attempt = 0;
    const maxAttempts = 3;

    while (attempt < maxAttempts) {
      try {
        const res = await gmailClient.users.messages.send({
          userId: "me",
          requestBody: {
            raw: b64url(raw),
            threadId: log.gmailThreadId ?? undefined,
          },
        });

        sendRes = (res.data || null) as gmail_v1.Schema$Message | null;
        break;
      } catch (err: unknown) {
        attempt++;
        const msg = err instanceof Error ? err.message : "Unknown Gmail send error";
        console.warn(`Gmail send attempt ${attempt} failed:`, msg);
        if (attempt >= maxAttempts) throw new Error(`Failed after ${attempt} retries: ${msg}`);
        await sleep(1000 * attempt);
      }
    }

    const sentId = sendRes?.id ?? null;

    /* ──────────────────────────────────────────────
       UPDATE LOG / AUDIT
    ─────────────────────────────────────────────── */
    const audit = Array.isArray(prevMeta.audit) ? prevMeta.audit : [];
    audit.push({
      at: new Date().toISOString(),
      by: session.user.email,
      action: "auto_sent",
      note: "Sent via /api/email-ai/send",
    });

    const resultPayload = { ok: true, gmailMsgId: sentId, delivered: true };

    await prisma.emailAILog.update({
      where: { id: logId },
      data: {
        action: "auto_sent",
        direction: "outbound",
        gmailMsgId: sentId ?? log.gmailMsgId,
        rawMeta: {
          ...prevMeta,
          audit,
          sentAt: new Date().toISOString(),
          to: toHeader,
          subject,
          inReplyTo,
          references,
          modelUsed: "email-ai/send",
          idempotency: {
            ...prevIdem,
            [idemKey]: { at: new Date().toISOString(), op: "send", result: resultPayload },
          },
        } as any,
      },
    });

    return NextResponse.json(resultPayload);
  } catch (err: unknown) {
    console.error("SEND ROUTE ERROR:", err);
    const message = err instanceof Error ? err.message : "Send failed";

    // Map common upstream failures to useful status codes
    const status = looksLikeAuthError(message)
      ? 401
      : /rate limit|429|too many requests/i.test(message)
      ? 429
      : 502;

    return NextResponse.json(
      {
        ok: false,
        delivered: false,
        error: message,
        type: status === 401 ? "auth" : "upstream",
      },
      { status }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    info: "POST { logId, subject?, body?, overrideBody?, dryRun? } → send or preview reply",
  });
}
