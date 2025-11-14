// app/api/email-ai/reply/route.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/* ──────────────────────────────────────────────
   CONFIG / CLIENTS
────────────────────────────────────────────── */
const openaiKey = (process.env.OPENAI_API_KEY || "").trim();
const openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;
const defaultModel = (process.env.OPENAI_MODEL || "gpt-4o-mini").trim();

const INTERNAL_API_KEY = (process.env.INTERNAL_API_KEY || "").trim(); // optional; enables server→server auth

/* ──────────────────────────────────────────────
   UTILS
────────────────────────────────────────────── */
const clean = (s?: string) => (s || "").replace(/\s+/g, " ").trim();

const tooShort = (s: string, min = 15) => clean(s).length < min;

function classify(txt: string): "inquiry" | "job" | "support" | "other" {
  if (/(quote|book|price|appointment|availability|schedule|booking)/i.test(txt)) return "inquiry";
  if (/(job|cv|résumé|resume|career|position|role)/i.test(txt)) return "job";
  if (/(cancel|refund|complain|issue|broken|problem|fault|warranty|support|help)/i.test(txt)) return "support";
  return "other";
}

const SPAM_RX =
  /(viagra|bitcoin|casino|porn|bet|lottery|click here|investment scheme|crypto giveaway|xxx|adult cam)/i;

const PROFANITY_RX = /(fuck|shit|bitch|cunt|nigga|nigger|retard|slut|whore)/i;

/** Tiny in-memory rate limiter per IP (best-effort; fine for internal use). */
const callsByIp = new Map<string, { last: number; count: number }>();
function rateLimit(ip: string, maxPerMinute = 60) {
  const now = Date.now();
  const m = callsByIp.get(ip) || { last: now, count: 0 };
  // reset every minute
  if (now - m.last > 60_000) {
    m.last = now;
    m.count = 0;
  }
  m.count++;
  callsByIp.set(ip, m);
  return m.count <= maxPerMinute;
}

/** Allow either: (a) internal server call with key; or (b) signed-in user. */
async function ensureAuthOrInternal(req: Request) {
  const key = req.headers.get("x-internal-key")?.trim() || "";
  if (INTERNAL_API_KEY && key && key === INTERNAL_API_KEY) {
    return { kind: "internal" as const, session: null as any };
  }
  const session = await getServerSession(authOptions);
  if (session?.user?.email) return { kind: "session" as const, session };
  return null;
}

/* ──────────────────────────────────────────────
   POST /api/email-ai/reply
────────────────────────────────────────────── */
export async function POST(req: Request) {
  try {
    // Best-effort IP rate limit (does nothing on edge, but we run nodejs runtime)
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      (req as any).ip ||
      "0.0.0.0";
    if (!rateLimit(ip, 120)) {
      return NextResponse.json({ ok: false, error: "Rate limit" }, { status: 429 });
    }

    // Auth: allow internal key OR signed-in user
    const authState = await ensureAuthOrInternal(req);
    if (!authState) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    // Parse inputs
    const body = (await req.json().catch(() => ({}))) as {
      subject?: string;
      snippet?: string;
      threadHistory?: string;
      // optional hints
      forceTone?: string;
      maxLength?: number;
    };

    const subject = clean(body.subject);
    const snippet = clean(body.snippet);
    const threadHistory = clean(body.threadHistory);

    if (!subject && !snippet) {
      return NextResponse.json({ ok: false, error: "Missing input" }, { status: 400 });
    }

    const merged = clean(`${subject} ${snippet} ${threadHistory}`);
    if (tooShort(merged)) {
      return NextResponse.json({ ok: false, error: "Too little context to reply" }, { status: 400 });
    }
    if (SPAM_RX.test(merged)) {
      return NextResponse.json({ ok: false, error: "Detected spam content" }, { status: 400 });
    }

    /* ──────────────────────────────────────────────
       Resolve org + settings when session-based.
       For internal calls we can’t infer a user; we’ll use safe defaults.
    ─────────────────────────────────────────────── */
    let orgId: string | null = null;
    let businessName = "Your business";
    let defaultTone = "friendly, concise, local";
    let instructionPrompt = "";
    let signature: string | null = null;
    let enabled = true; // internal calls assume enabled — they are initiated by your backend

    if (authState.kind === "session") {
      const userEmail = authState.session.user?.email!;
      const membership = await prisma.membership.findFirst({
        where: { user: { email: userEmail } },
        select: { orgId: true },
        orderBy: { orgId: "asc" },
      });

      orgId = membership?.orgId ?? null;
      if (!orgId) {
        return NextResponse.json({ ok: false, error: "No organization found" }, { status: 400 });
      }

      const s = await prisma.emailAISettings.findUnique({ where: { orgId } });
      if (!s) {
        return NextResponse.json({ ok: false, error: "Email AI not configured" }, { status: 400 });
      }
      enabled = s.enabled;
      if (!enabled) {
        return NextResponse.json({ ok: false, error: "Email AI not enabled for this org" }, { status: 400 });
      }
      businessName = s.businessName || businessName;
      defaultTone = s.defaultTone || defaultTone;
      instructionPrompt = s.instructionPrompt || "";
      signature = (s.signature || "").trim() || null;
    }

    /* ──────────────────────────────────────────────
       Classify & build prompts
    ─────────────────────────────────────────────── */
    const textForClf = merged.toLowerCase();
    const classification = classify(textForClf);

    const tone = clean(body.forceTone) || defaultTone;

    const systemPrompt = `
You are an AI email assistant for ${businessName}.
Tone: ${tone}.
${instructionPrompt ? `Owner's instructions:\n${instructionPrompt}` : ""}

Rules:
- Use NZ English spelling.
- Do not invent facts, dates, or prices.
- Be concise, natural, and professional.
- If missing key details, ask exactly ONE brief clarifying question.
- Avoid profanity; if present from sender, ignore it and stay professional.
- If sender requests a price/quote but no price list is known, ask for necessary details instead of guessing.
`.trim();

    const userPrompt = `
Incoming email
Subject: ${subject || "(no subject)"}
Preview: ${snippet || "(no preview)"}
${threadHistory ? `\nEarlier thread:\n${threadHistory}` : ""}

Write a short, helpful reply that fits the tone and classification "${classification}".
Keep it under ${Math.max(160, Math.min(600, Number(body.maxLength) || 420))} characters where possible.
If scheduling or booking is implied but details are missing, ask for the minimum info.
End with a single friendly closing line.
`.trim();

    /* ──────────────────────────────────────────────
       Generate
    ─────────────────────────────────────────────── */
    let reply = "";
    let confidence = 0.86;
    let modelUsed = defaultModel;

    try {
      if (!openai) throw new Error("OpenAI not configured");

      const completion = await openai.chat.completions.create({
        model: defaultModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.4,
      });

      const choice = completion.choices?.[0];
      const content = (choice?.message?.content ?? "").trim();
      reply = clean(content);
      modelUsed = (completion as any)?.model ?? defaultModel;
      if (!reply) throw new Error("Empty model output");
    } catch (err) {
      console.warn("⚠️ reply: AI fallback:", err);
      // ultra-safe fallback reply
      reply =
        `Thanks for your email about “${subject || "your enquiry"}”. ` +
        `We’ve received it and will get back to you shortly. ` +
        `If it’s urgent, please reply with best contact number and availability.`;
      confidence = 0.55;
      modelUsed = "fallback";
    }

    // safety: strip profanity if any slipped through
    if (PROFANITY_RX.test(reply)) {
      reply = reply.replace(PROFANITY_RX, "—");
      confidence = Math.min(confidence, 0.5);
    }

    if (signature) reply = `${reply}\n\n${signature}`;

   /* ──────────────────────────────────────────────
   Log (session calls only; internal calls skip persisting)
────────────────────────────────────────────── */
if (authState?.kind === "session" && orgId) {
  const tokenEstimate = reply.length;

  // TS-safe: guard + fallback to a string to satisfy Prisma Json type
  const userEmail: string =
    (authState.session && authState.session.user && authState.session.user.email) ||
    "unknown";

  await prisma.emailAILog.create({
    data: {
      orgId,
      direction: "outbound",
      classification,
      confidence,
      subject: subject || "",
      snippet: snippet || "",
      action: "draft_preview",
      rawMeta: {
        user: userEmail,
        modelUsed,
        tokenEstimate,
        suggestedBody: reply,
      } as any,
    },
  });
}

    /* ──────────────────────────────────────────────
       Response
    ─────────────────────────────────────────────── */
    const summary = reply.length > 220 ? reply.slice(0, 220) + "…" : reply;

    return NextResponse.json({
      ok: true,
      reply,
      classification,
      confidence,
      modelUsed,
      tokenEstimate: reply.length,
      insights: `Classification: ${classification}; Confidence: ${(confidence * 100).toFixed(
        0
      )}% ; Model: ${modelUsed}; Summary: ${summary}`,
    });
  } catch (e: any) {
    console.error("Reply route error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Reply generation failed" },
      { status: 500 }
    );
  }
}

/* ──────────────────────────────────────────────
   GET (INFO)
────────────────────────────────────────────── */
export async function GET() {
  return NextResponse.json({
    ok: true,
    info:
      "POST { subject, snippet, threadHistory?, forceTone?, maxLength? } → { reply, classification, confidence, modelUsed }",
  });
}