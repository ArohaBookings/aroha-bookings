// app/api/email-ai/draft/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { google, gmail_v1 } from "googleapis";
import { readGmailIntegration } from "@/lib/orgSettings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function b64url(s: string) {
  return Buffer.from(s)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function firstString(...values: Array<unknown>): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function safeString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function buildRawEmail(input: {
  to: string;
  subject: string;
  body: string;
safeInReplyTo?: string | null;
  safeReferences?: string | null;
}) {
  const headers: string[] = [];
  headers.push(`To: ${input.to}`);
  headers.push(`Subject: ${input.subject}`);
  if (input.safeInReplyTo) headers.push(`In-Reply-To: ${input.safeInReplyTo}`);
  if (input.safeReferences) headers.push(`References: ${input.safeReferences}`);
  headers.push(`MIME-Version: 1.0`);
  headers.push(`Content-Type: text/plain; charset="UTF-8"`);
  headers.push(`Content-Transfer-Encoding: 7bit`);
  headers.push("");
  headers.push(input.body);

  return headers.join("\r\n");
}

function gmailDraftUrl(draftId: string) {
  return `https://mail.google.com/mail/u/0/#drafts?compose=${encodeURIComponent(draftId)}`;
}

// Keep this as a function so it’s easy to swap token source later (refresh token flow, service account, etc.)
function getGoogleAccessToken(session: unknown): string | null {
  const token = (session as any)?.google?.access_token;
  return typeof token === "string" && token.trim() ? token.trim() : null;
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const userEmail = session?.user?.email;
    if (!userEmail) return json({ ok: false, error: "Not authenticated" }, 401);

    const bodyJson = (await req.json().catch(() => ({}))) as {
      logId?: string;
      subject?: string;
      body?: string;
    };

    const logId = safeString(bodyJson.logId).trim();
    if (!logId) return json({ ok: false, error: "Missing logId" }, 400);

    const log = await prisma.emailAILog.findUnique({
      where: { id: logId },
    });
    if (!log) return json({ ok: false, error: "Log not found" }, 404);

    const membership = await prisma.membership.findFirst({
      where: { user: { email: userEmail }, orgId: log.orgId },
      select: { orgId: true },
    });
    if (!membership) return json({ ok: false, error: "No access to org" }, 403);

    const orgSettings = await prisma.orgSettings.findUnique({
      where: { orgId: log.orgId },
      select: { data: true },
    });

    const gmailIntegration = readGmailIntegration((orgSettings?.data as Record<string, unknown>) || {});
    if (!gmailIntegration.connected) return json({ ok: false, error: "Gmail disconnected" }, 400);

    const prevMeta = ((log as any).rawMeta as any) || {};
    const existingDraftId = firstString(prevMeta?.draftId);
    if (existingDraftId) {
      return json({
        ok: true,
        draftId: existingDraftId,
        gmailDraftUrl: gmailDraftUrl(existingDraftId),
        idempotent: true,
      });
    }

    const accessToken = getGoogleAccessToken(session);
    if (!accessToken) return json({ ok: false, error: "No Gmail token" }, 400);

    const oauth2 = new google.auth.OAuth2();
    oauth2.setCredentials({ access_token: accessToken });

    // ✅ TS2339 fix: strongly type the client (gmail_v1.Gmail)
    const gmailClient: gmail_v1.Gmail = google.gmail({ version: "v1", auth: oauth2 });

    // Determine recipient: reply-to preferred, then from
    const rawMeta = ((log as any).rawMeta as any) || {};
    const to = firstString(rawMeta?.replyTo, rawMeta?.from);
    if (!to) return json({ ok: false, error: "Missing recipient in log.rawMeta" }, 400);

    const subj =
      firstString(bodyJson.subject) ||
      (log.subject ? `Re: ${log.subject}` : "Re: (no subject)");

    const suggestedBody =
      firstString(bodyJson.body) ||
      firstString(rawMeta?.suggested?.body);
    if (!suggestedBody) {
      return json({ ok: false, error: "No suggested reply available" }, 400);
    }

    const safeInReplyTo = firstString((log as any).gmailMsgId);
    const safeReferences = firstString((log as any).gmailMsgId);

    const raw = buildRawEmail({
      to,
      subject: subj,
      body: suggestedBody.trim(),
      safeInReplyTo,
      safeReferences,
    });

    const threadId = firstString((log as any).gmailThreadId) || undefined;

    // ✅ TS2339 fix: users.drafts.create exists on gmail_v1.Gmail
    const createRes = await gmailClient.users.drafts.create({
      userId: "me",
      requestBody: {
        message: {
          raw: b64url(raw),
          ...(threadId ? { threadId } : {}),
        },
      },
    });

    const draftId = firstString(createRes?.data?.id);
    if (!draftId) {
      return json({ ok: false, error: "Draft created but missing draftId" }, 502);
    }

    // Persist draft meta (idempotency + review UI)
    await prisma.emailAILog.update({
      where: { id: logId },
      data: {
        action: "draft_created",
        rawMeta: {
          ...(rawMeta || {}),
          draftId,
          suggested: { subject: subj, body: suggestedBody.trim() },
          lastDraftAt: new Date().toISOString(),
        } as any,
      },
    });

    return json({ ok: true, draftId, gmailDraftUrl: gmailDraftUrl(draftId) });
  } catch (e: any) {
    // Google APIs often put details in e.response.data
    console.error("email-ai draft error:", e?.response?.data || e);
    return json({ ok: false, error: e?.message || "Draft failed" }, 500);
  }
}
