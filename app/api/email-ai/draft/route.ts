// app/api/email-ai/draft/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { google } from "googleapis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function b64url(s: string) {
  return Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    const { logId, subject, body } = (await req.json()) as {
      logId: string;
      subject?: string;
      body?: string;
    };
    if (!logId) return NextResponse.json({ ok: false, error: "Missing logId" }, { status: 400 });

    const log = await prisma.emailAILog.findUnique({ where: { id: logId } });
    if (!log) return NextResponse.json({ ok: false, error: "Log not found" }, { status: 404 });

    const membership = await prisma.membership.findFirst({
      where: { user: { email: session.user.email }, orgId: log.orgId },
      select: { orgId: true },
    });
    if (!membership) return NextResponse.json({ ok: false, error: "No access to org" }, { status: 403 });

    const accessToken = (session as any).google?.access_token as string | undefined;
    if (!accessToken) return NextResponse.json({ ok: false, error: "No Gmail token" }, { status: 400 });

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const gmail = google.gmail({ version: "v1", auth });

    // Build the message
    const to = (log.rawMeta as any)?.replyTo || (log.rawMeta as any)?.from || "";
    if (!to) return NextResponse.json({ ok: false, error: "Missing recipient in log.rawMeta" }, { status: 400 });

    const subj = subject || (log.subject ? `Re: ${log.subject}` : "Re: (no subject)");
    const msgBody =
      (body ?? (log.rawMeta as any)?.suggested?.body ?? log.snippet ?? "").trim() || "Thanks for your email.";

    const raw = [
      `To: ${to}`,
      `Subject: ${subj}`,
      ...(log.gmailMsgId ? [`In-Reply-To: ${log.gmailMsgId}`] : []),
      ...(log.gmailMsgId ? [`References: ${log.gmailMsgId}`] : []),
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
      "",
      msgBody,
    ].join("\r\n");

    // Create a new draft (simpler and reliable; if you want to update an existing one, call users.drafts.update)
    const createRes = await gmail.users.drafts.create({
      userId: "me",
      requestBody: {
        message: {
          raw: b64url(raw),
          threadId: log.gmailThreadId ?? undefined,
        } as any,
      },
    });

    const draftId = createRes.data.id || null;

    // Persist action + suggested body for the Review UI
    await prisma.emailAILog.update({
      where: { id: logId },
      data: {
        action: "draft_created",
        rawMeta: {
          ...(log.rawMeta as any),
          draftId,
          suggested: { subject: subj, body: msgBody },
          lastDraftAt: new Date().toISOString(),
        } as any,
      },
    });

    // Gmail web link (drafts view)
    const gmailDraftUrl = draftId
      ? `https://mail.google.com/mail/u/0/#drafts?compose=${encodeURIComponent(draftId)}`
      : undefined;

    return NextResponse.json({ ok: true, draftId, gmailDraftUrl });
  } catch (e: any) {
    console.error("draft error:", e?.response?.data || e);
    return NextResponse.json({ ok: false, error: e?.message || "Draft failed" }, { status: 500 });
  }
}