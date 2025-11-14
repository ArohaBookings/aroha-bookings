// app/api/email-ai/rewrite/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });

    const { logId, body, tone } = (await req.json()) as {
      logId: string;
      body: string;
      tone?: "firm" | "warm";
    };
    if (!logId || !body) return NextResponse.json({ ok: false, error: "Missing logId/body" }, { status: 400 });

    // ensure access
    const log = await prisma.emailAILog.findUnique({ where: { id: logId } });
    if (!log) return NextResponse.json({ ok: false, error: "Log not found" }, { status: 404 });

    const membership = await prisma.membership.findFirst({
      where: { user: { email: session.user.email }, orgId: log.orgId },
      select: { orgId: true },
    });
    if (!membership) return NextResponse.json({ ok: false, error: "No access to org" }, { status: 403 });

    const settings = await prisma.emailAISettings.findUnique({ where: { orgId: log.orgId } });

    // Fallback when no OpenAI key
    if (!openai) {
      // Light, deterministic tweak so button “works” in dev
      const prefix =
        tone === "firm"
          ? "[Made a little firmer]\n\n"
          : tone === "warm"
          ? "[Made a little warmer]\n\n"
          : "[Rewritten slightly]\n\n";
      return NextResponse.json({ ok: true, body: prefix + body });
    }

    const toneLine =
      tone === "firm"
        ? "Make the reply slightly firmer and more decisive without sounding rude."
        : tone === "warm"
        ? "Make the reply warmer and friendlier while staying professional."
        : "Improve clarity, trim fluff, keep meaning. Keep it concise.";

    const sys = `
You edit email replies for ${settings?.businessName || "our business"}.
- Keep NZ English.
- Do not invent prices or promises.
- Keep roughly the same length unless brevity helps.
- Keep signatures intact if present.
`.trim();

    const usr = `
Current reply body:
---
${body}
---

Edit the reply. ${toneLine}
Return ONLY the revised body text (no markdown, no commentary).
`.trim();

    const c = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: usr },
      ],
    });

    const out = c.choices[0]?.message?.content?.trim() || body;

    // Optionally stash last rewrite in rawMeta for audit
    await prisma.emailAILog.update({
      where: { id: logId },
      data: {
        rawMeta: {
          ...(log.rawMeta as any),
          lastRewriteAt: new Date().toISOString(),
        } as any,
      },
    });

    return NextResponse.json({ ok: true, body: out });
  } catch (e: any) {
    console.error("rewrite error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Rewrite failed" }, { status: 500 });
  }
}