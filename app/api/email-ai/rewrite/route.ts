// app/api/email-ai/rewrite/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateEmailReply, hasAI } from "@/lib/ai/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function normalizeText(input: string) {
  return input.toLowerCase().replace(/\s+/g, " ").trim();
}

function hasLongOverlap(body: string, snippet: string) {
  const normBody = normalizeText(body);
  const normSnippet = normalizeText(snippet);
  if (!normSnippet || normSnippet.length < 40) return false;
  const sample = normSnippet.slice(0, Math.min(120, normSnippet.length));
  return normBody.includes(sample);
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });

    const { logId, tone, body: bodyOverride, subject: subjectOverride } = (await req.json()) as {
      logId: string;
      tone?: "firm" | "warm";
      body?: string;
      subject?: string;
    };
    if (!logId) return NextResponse.json({ ok: false, error: "Missing logId" }, { status: 400 });

    // ensure access
    const log = await prisma.emailAILog.findUnique({ where: { id: logId } });
    if (!log) return NextResponse.json({ ok: false, error: "Log not found" }, { status: 404 });

    const membership = await prisma.membership.findFirst({
      where: { user: { email: session.user.email }, orgId: log.orgId },
      select: { orgId: true },
    });
    if (!membership) return NextResponse.json({ ok: false, error: "No access to org" }, { status: 403 });

    const settings = await prisma.emailAISettings.findUnique({ where: { orgId: log.orgId } });
    const rawMeta = (log.rawMeta as any) || {};
    const suggested = (rawMeta.suggested as { subject?: string; body?: string }) || {};

    // Prefer explicit overrides, then stored suggestion.
    let body = ((typeof bodyOverride === "string" ? bodyOverride : suggested.body) || "").trim();
    const subject = ((typeof subjectOverride === "string" ? subjectOverride : suggested.subject) || "").trim();

    if (!hasAI()) {
      await prisma.emailAILog.update({
        where: { id: logId },
        data: { rawMeta: { ...rawMeta, aiError: "AI unavailable" } as any },
      });
      return NextResponse.json({ ok: false, error: "AI unavailable" }, { status: 503 });
    }

    // If we don't yet have a suggestion, generate one first (so rewrite doesn't 400).
    if (!body) {
      try {
        const orgSettingsRow = await prisma.orgSettings.findUnique({
          where: { orgId: log.orgId },
          select: { data: true },
        });
        const data = (orgSettingsRow?.data as Record<string, unknown>) || {};
        const voice = (data as any).aiVoice || {};

        const emailSnippetsArr = Array.isArray((data as any).emailSnippets)
          ? ((data as any).emailSnippets as any[])
          : [];
        const snippets = emailSnippetsArr
          .map((entry: any) => ({
            title: typeof entry?.title === "string" ? entry.title : "",
            body: typeof entry?.body === "string" ? entry.body : "",
          }))
          .filter((s) => s.title && s.body);

        const threadPeek = Array.isArray((rawMeta as any)?.threadPeek)
          ? ((rawMeta as any).threadPeek as Array<{ from: string; subject: string }> )
          : undefined;

        const initial = await generateEmailReply({
          businessName: (settings?.businessName || "your business") as string,
          tone:
            (typeof voice.tone === "string" && voice.tone.trim())
              ? voice.tone.trim()
              : (settings?.defaultTone || "friendly"),
          instructionPrompt: (settings?.instructionPrompt || "") as string,
          signature: (settings?.signature as string | null | undefined) || null,
          subject: (log.subject || "") as string,
          from: (typeof (rawMeta as any)?.from === "string" ? (rawMeta as any).from : "") as string,
          snippet: (log.snippet || "") as string,
          label: (log.classification || "") as string,
          threadPeek,
          snippets,
        });

        body = (initial.body || "").trim();

        // Persist the generated suggestion so subsequent actions are consistent.
        await prisma.emailAILog.update({
          where: { id: logId },
          data: {
            rawMeta: {
              ...rawMeta,
              aiError: null,
              suggested: {
                subject: initial.subject,
                body: initial.body,
                model: (initial.meta as any)?.model || null,
                createdAt: Date.now(),
              },
            } as any,
          },
        });
      } catch (err: any) {
        await prisma.emailAILog.update({
          where: { id: logId },
          data: { rawMeta: { ...rawMeta, aiError: err?.message || "AI generation failed" } as any },
        });
        return NextResponse.json({ ok: false, error: err?.message || "AI generation failed" }, { status: 502 });
      }
    }

    const toneLine =
      tone === "firm"
        ? "Make the reply slightly firmer and more decisive without sounding rude."
        : tone === "warm"
        ? "Make the reply warmer and friendlier while staying professional."
        : "Improve clarity, trim fluff, keep meaning. Keep it concise.";

    // Use the shared generator with a rewrite-specific instruction prompt.
    const rewriteInstruction = [
      (settings?.instructionPrompt || "").toString().trim(),
      "Rewrite the draft reply below.",
      toneLine,
      "Do NOT quote or repeat the customer's email.",
      "Return a complete final reply (not notes).",
    ]
      .filter(Boolean)
      .join("\n");

    const rewritten = await generateEmailReply({
      businessName: (settings?.businessName || "your business") as string,
      tone: (settings?.defaultTone || "friendly, concise, local") as string,
      instructionPrompt: rewriteInstruction,
      signature: null, // signature is already in `body` if present
      subject: (log.subject || "") as string,
      from: (typeof (rawMeta as any)?.from === "string" ? (rawMeta as any).from : "") as string,
      // Put the current draft in the snippet field so the model rewrites THAT.
      snippet: body,
      label: (log.classification || "") as string,
      threadPeek: Array.isArray((rawMeta as any)?.threadPeek) ? (rawMeta as any).threadPeek : undefined,
      snippets: Array.isArray((rawMeta as any)?.snippets) ? (rawMeta as any).snippets : undefined,
    });

    const out = (rewritten.body || "").trim();
    if (!out) {
      return NextResponse.json({ ok: false, error: "AI rewrite failed" }, { status: 502 });
    }
    if (hasLongOverlap(out, log.snippet || "")) {
      await prisma.emailAILog.update({
        where: { id: logId },
        data: {
          rawMeta: {
            ...rawMeta,
            aiError: "AI reply too similar to inbound",
          } as any,
        },
      });
      return NextResponse.json({ ok: false, error: "AI reply too similar to inbound" }, { status: 422 });
    }

    // Optionally stash last rewrite in rawMeta for audit
    await prisma.emailAILog.update({
      where: { id: logId },
      data: {
        rawMeta: {
          ...(log.rawMeta as any),
          lastRewriteAt: new Date().toISOString(),
          aiError: null,
          suggested: {
            ...(rawMeta.suggested || {}),
            subject: subject || rawMeta?.suggested?.subject || null,
            body: out,
            model: (rewritten.meta as any)?.model || null,
            createdAt: Date.now(),
          },
        } as any,
      },
    });

    return NextResponse.json({
      ok: true,
      suggested: {
        subject: subject || rawMeta?.suggested?.subject || null,
        body: out,
        model: (rewritten.meta as any)?.model || null,
        createdAt: Date.now(),
      },
    });
  } catch (e: any) {
    console.error("rewrite error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Rewrite failed" }, { status: 500 });
  }
}
