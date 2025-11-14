// app/api/email-ai/send/route.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { google } from "googleapis";
import { getToken } from "next-auth/jwt";

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

function header(headers: Array<{ name?: string; value?: string }> | undefined, name: string): string {
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

function buildReplyRaw(opts: {
  to: string;
  subject: string;
  inReplyTo?: string;
  references?: string;
  body: string;
  from?: string;
  labelTag?: string;
}) {
  const lines = [
    `To: ${opts.to}`,
    ...(opts.from ? [`From: ${opts.from}`] : []),
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

/** Pick a safe absolute origin for internal fetches (Vercel + local). */
function resolveOrigin(req: Request): string {
  // Prefer explicit envs
  const envOrigin =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://aroha-bookings.vercel.app";

  // On Vercel behind proxy
  const proto = req.headers.get("x-forwarded-proto");
  const host = req.headers.get("x-forwarded-host");
  if (proto && host) return `${proto}://${host}`;

  // Dev/local
  try {
    const u = new URL(req.url);
    if (u.origin && u.origin !== "null") return u.origin;
  } catch {
    /* noop */
  }
  return envOrigin;
}

/* ──────────────────────────────────────────────
   GMAIL ACCESS TOKEN (session → JWT refresh)
────────────────────────────────────────────── */
async function ensureGoogleAccessToken(req: Request, session: any): Promise<string> {
  // 1) Try session (populated by your auth callbacks)
  const sessToken = session?.google?.access_token as string | null;
  if (sessToken) return sessToken;

  // 2) Fallback to JWT (server-only) and refresh if needed
  const jwt = await getToken({ req: req as any, raw: false, secureCookie: false });
  const g = (jwt as any) || {};
  const rt = g.google_refresh_token as string | undefined;
  const at = g.google_access_token as string | undefined;
  const exp = typeof g.google_expires_at === "number" ? g.google_expires_at : 0;

  if (at && exp && Date.now() < exp - 60_000) return at; // valid w/ 1m skew
  if (!rt) throw new Error("No Gmail refresh token in JWT");

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

/* ──────────────────────────────────────────────
   MAIN HANDLER
────────────────────────────────────────────── */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    // NOTE: accept UI subject/body in addition to overrideBody for backwards-compat
    const {
      logId,
      overrideBody,
      dryRun,
      subject: uiSubject,
      body: uiBody,
    } = (await req.json()) as {
      logId: string;
      overrideBody?: string;
      dryRun?: boolean;
      subject?: string;
      body?: string;
    };

    if (!logId) {
      return NextResponse.json({ ok: false, error: "Missing logId" }, { status: 400 });
    }

    /* ──────────────────────────────────────────────
       FETCH LOG + ORG VALIDATION
    ─────────────────────────────────────────────── */
    const log = await prisma.emailAILog.findUnique({ where: { id: logId } });
    if (!log) {
      return NextResponse.json({ ok: false, error: "Log not found" }, { status: 404 });
    }

    // idempotency: if already sent, just echo success
    if (log.action === "auto_sent") {
      return NextResponse.json({ ok: true, delivered: true, gmailMsgId: log.gmailMsgId ?? null });
    }

    const membership = await prisma.membership.findFirst({
      where: { user: { email: session.user.email }, orgId: log.orgId },
      select: { orgId: true },
    });
    if (!membership) {
      return NextResponse.json({ ok: false, error: "No access to org" }, { status: 403 });
    }

    const settings = await prisma.emailAISettings.findUnique({
      where: { orgId: log.orgId },
    });
    if (!settings?.enabled) {
      return NextResponse.json({ ok: false, error: "Email AI disabled" }, { status: 400 });
    }

    /* ──────────────────────────────────────────────
       GMAIL AUTH (robust: JWT refresh if needed)
    ─────────────────────────────────────────────── */
    const accessToken = await ensureGoogleAccessToken(req, session).catch((e) => {
      console.error("ensureGoogleAccessToken error:", e);
      return null;
    });

    if (!accessToken) {
      return NextResponse.json(
        { ok: false, error: "No Gmail access token (and refresh failed)" },
        { status: 401 }
      );
    }

    const oauth2 = new google.auth.OAuth2();
    oauth2.setCredentials({ access_token: accessToken });
    const gmail = google.gmail({ version: "v1", auth: oauth2 });

    /* ──────────────────────────────────────────────
       FETCH THREAD CONTEXT
    ─────────────────────────────────────────────── */
    let toHeader = "";
    let inReplyTo = "";
    let references = "";
    let subject = log.subject ? normalizeSubject(log.subject) : "Re: (no subject)";

    if (log.gmailThreadId) {
      const thread = await gmail.users.threads.get({
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
    }

    // fallback recipient (from log meta if we didn't get a thread)
    if (!toHeader) {
      const rm = (log.rawMeta as any) || {};
      toHeader = (rm.replyTo || rm.from || "").trim();
    }
    if (!toHeader) {
      return NextResponse.json({ ok: false, error: "Could not determine recipient" }, { status: 400 });
    }

/* ──────────────────────────────────────────────
   COMPOSE SUBJECT & BODY  (REPLACED)
────────────────────────────────────────────── */
// pull suggestion saved on the log (if any)
const suggested = ((log.rawMeta as any)?.suggested ?? {}) as {
  subject?: string;
  body?: string;
};

// Subject precedence:
// 1) uiSubject (from Review page)
// 2) suggested.subject (from rawMeta)
// 3) keep the normalized thread subject computed earlier
if (uiSubject && uiSubject.trim()) {
  subject = uiSubject.trim();
} else if (suggested.subject && suggested.subject.trim()) {
  subject = suggested.subject.trim();
}

// Body precedence (NO generic fallback):
// 1) overrideBody
// 2) uiBody (from Review page)
// 3) suggested.body
let body =
  (overrideBody ?? uiBody ?? suggested.body ?? "").toString().trim();

if (!body) {
  // Stop and report instead of silently composing a generic response
  return NextResponse.json(
    { ok: false, error: "No body to send. Provide body (or suggested.body)." },
    { status: 400 }
  );
}

    if (settings.signature) {
      const sig = settings.signature.trim();
      // avoid duplicate signature if already appended
      if (!body.trim().endsWith(sig)) {
        body = `${body}\n\n${sig}`;
      }
    }

    const raw = buildReplyRaw({
      to: toHeader,
      subject,
      inReplyTo,
      references,
      body,
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
       SEND WITH RETRY / FALLBACK
    ─────────────────────────────────────────────── */
    let sendRes: any = null;
    let attempt = 0;
    const maxAttempts = 3;

    while (attempt < maxAttempts) {
      try {
        sendRes = await gmail.users.messages.send({
          userId: "me",
          requestBody: {
            raw: b64url(raw),
            threadId: log.gmailThreadId ?? undefined,
          } as any,
        });
        break;
      } catch (err: any) {
        attempt++;
        const msg = err?.errors?.[0]?.message || err?.message;
        console.warn(`Gmail send attempt ${attempt} failed:`, msg);
        if (attempt >= maxAttempts) throw new Error(`Failed after ${attempt} retries: ${msg}`);
        await sleep(1000 * attempt); // backoff
      }
    }

    const sentId = sendRes?.data?.id ?? null;

    /* ──────────────────────────────────────────────
       UPDATE LOG / AUDIT
    ─────────────────────────────────────────────── */
    const prevMeta = (log.rawMeta as any) || {};
    const audit = Array.isArray(prevMeta.audit) ? prevMeta.audit : [];
    audit.push({
      at: new Date().toISOString(),
      by: session.user.email,
      action: "auto_sent",
      note: "Sent via /api/email-ai/send",
    });

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
        } as any,
      },
    });

    return NextResponse.json({
      ok: true,
      gmailMsgId: sentId,
      delivered: true,
    });
  } catch (err: any) {
    console.error("SEND ROUTE ERROR:", err);
    return NextResponse.json(
      {
        ok: false,
        delivered: false,
        error: err?.message || "Send failed",
        type:
          err?.message?.includes("Invalid Credentials") ||
          err?.message?.includes("401")
            ? "auth"
            : "server",
      },
      { status: 500 }
    );
  }
}

/* ──────────────────────────────────────────────
   GET (INFO ENDPOINT)
────────────────────────────────────────────── */
export async function GET() {
  return NextResponse.json({
    ok: true,
    info: "POST { logId, subject?, body?, overrideBody?, dryRun? } → send or preview reply",
  });
}
