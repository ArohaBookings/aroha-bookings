import OpenAI from "openai";

// Default can be overridden by OPENAI_EMAIL_MODEL in env.
const DEFAULT_EMAIL_MODEL = "gpt-4o-mini";
let cachedClient: OpenAI | null = null;
let cachedKey = "";

function getOpenAIClient() {
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return null;
  if (cachedClient && cachedKey === apiKey) return cachedClient;
  cachedKey = apiKey;
  cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}

export function hasAI() {
  return Boolean((process.env.OPENAI_API_KEY || "").trim());
}


export type EmailContext = {
  businessName: string;
  tone: string;
  instructionPrompt?: string | null;
  signature?: string | null;
  subject: string;
  from: string;
  snippet: string;
  threadPeek?: Array<{ from: string; subject: string }>;
  label?: string;
  snippets?: Array<{ title: string; body: string }>;
};

export type EmailReply = {
  subject: string;
  body: string;
  meta: Record<string, unknown>;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function stripCodeFences(s: string) {
  const t = (s || "").trim();
  if (!t) return "";
  // ```json ... ```
  if (t.startsWith("```")) {
    return t.replace(/^```[a-zA-Z]*\n?/, "").replace(/```\s*$/, "").trim();
  }
  return t;
}

function normalizeText(input: string) {
  return (input || "")
    .toLowerCase()
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toNgrams(s: string, n: number) {
  const t = normalizeText(s);
  if (!t) return [] as string[];
  if (t.length <= n) return [t];
  const out: string[] = [];
  for (let i = 0; i <= t.length - n; i++) out.push(t.slice(i, i + n));
  return out;
}

function jaccard(a: string[], b: string[]) {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

// Stronger anti-echo than substring match.
function looksLikeEcho(replyBody: string, inboundSnippet: string) {
  const body = normalizeText(replyBody);
  const snip = normalizeText(inboundSnippet);
  if (!body || !snip) return false;
  if (snip.length < 40) return false;

  // If it contains a long contiguous chunk from the inbound snippet.
  const sample = snip.slice(0, Math.min(160, snip.length));
  if (sample && body.includes(sample)) return true;

  // Or high n-gram overlap.
  const score = jaccard(toNgrams(body, 8), toNgrams(snip, 8));
  return score >= 0.25;
}

function safeSubjectBase(s: string) {
  const trimmed = (s || "").trim();
  return trimmed || "(no subject)";
}

function parseReplyPayload(raw: string, fallbackSubject: string) {
  const cleaned = stripCodeFences(raw);
  const trimmed = cleaned.trim();
  if (!trimmed) return { subject: fallbackSubject, body: "" };

  // Try to find a JSON object anywhere in the response.
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const maybeJson = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(maybeJson) as { subject?: unknown; body?: unknown };
      const subject = (typeof parsed.subject === "string" ? parsed.subject : fallbackSubject).toString().trim();
      const body = (typeof parsed.body === "string" ? parsed.body : "").toString().trim();
      return { subject: subject || fallbackSubject, body };
    } catch {
      // fallthrough
    }
  }

  // Fallback: Subject:/Body: format.
  const subjectMatch = trimmed.match(/subject:\s*(.+)/i);
  const bodyMatch = trimmed.match(/body:\s*([\s\S]+)/i);
  if (subjectMatch || bodyMatch) {
    const subject = (subjectMatch?.[1] || fallbackSubject).trim();
    const body = (bodyMatch?.[1] || "").trim();
    return { subject: subject || fallbackSubject, body };
  }

  // Last resort: treat everything as body.
  return { subject: fallbackSubject, body: trimmed };
}

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAI(
  opts: {
    model: string;
    temperature: number;
    system: string;
    user: string;
    maxAttempts?: number;
    timeoutMs?: number;
  }
): Promise<{ content: string; model: string }>
{
  const openai = getOpenAIClient();
  if (!openai) throw new Error("AI disabled: missing OPENAI_API_KEY");

  const maxAttempts = clamp(opts.maxAttempts ?? 3, 1, 6);
  const timeoutMs = clamp(opts.timeoutMs ?? 18_000, 5_000, 60_000);

  let lastErr: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (process.env.NODE_ENV !== "production") {
        console.log("[email-ai] OpenAI call attempt", attempt, "model:", opts.model);
      }

      const res = await withTimeout(timeoutMs, (signal) =>
        openai.chat.completions.create(
          {
            model: opts.model,
            temperature: opts.temperature,
            messages: [
              { role: "system", content: opts.system },
              { role: "user", content: opts.user },
            ],
          },
          { signal }
        )
      );

      // Some OpenAI SDK versions/type configs don't expose `choices` / `model` on the inferred type.
      // Read them defensively at runtime.
      const resAny = res as any;
      const content = (resAny?.choices?.[0]?.message?.content ?? "").toString().trim();
      const model = (typeof resAny?.model === "string" && resAny.model.trim()) ? resAny.model : opts.model;
      return { content, model };
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message || e || "");
      const status = Number(e?.status || e?.response?.status || 0);
      const code = String(e?.code || e?.error?.code || "");

      // Retry on transient / rate / gateway problems.
      const retryable =
        status === 408 ||
        status === 409 ||
        status === 425 ||
        status === 429 ||
        (status >= 500 && status <= 599) ||
        /timeout|timed out|ECONNRESET|ENOTFOUND|EAI_AGAIN|overloaded|temporarily/i.test(msg);

      // Fail fast for non-retryable model errors so callers can fall back to another model.
      const looksLikeModelIssue =
        status === 400 ||
        status === 404 ||
        /model/i.test(msg) ||
        code === "model_not_found";

      if (!retryable || attempt === maxAttempts) {
        const err = new Error(msg || "OpenAI request failed");
        (err as any).status = status;
        (err as any).code = code;
        (err as any).modelIssue = looksLikeModelIssue;
        throw err;
      }

      const backoff = Math.round(250 * Math.pow(2, attempt - 1) + Math.random() * 250);
      await sleep(backoff);
    }
  }

  throw new Error(String((lastErr as any)?.message || lastErr || "OpenAI request failed"));
}

// Small helper used elsewhere in the app.
// Uses the same hardened OpenAI caller (timeouts/retries + tolerant typing).
export async function generateText(prompt: string) {
  if (!getOpenAIClient()) return null;

  const system = "You are a concise assistant that explains scheduling logic in plain language. Avoid hallucinations.";

  const modelPref = (process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini").trim() || "gpt-4o-mini";
  const candidates = Array.from(new Set([modelPref, "gpt-4o-mini"])).filter(Boolean);

  let last: any = null;
  for (const m of candidates) {
    try {
      const res = await callOpenAI({
        model: m,
        temperature: 0.4,
        system,
        user: prompt,
        maxAttempts: 3,
        timeoutMs: 12_000,
      });
      return res.content || null;
    } catch (e: any) {
      last = e;
      // Only fall back on model issues; otherwise bubble up.
      if (!(e as any)?.modelIssue) throw e;
    }
  }

  // If we exhausted fallbacks, return null (caller treats as unavailable).
  if (process.env.NODE_ENV !== "production") {
    console.warn("[ai] generateText failed:", String(last?.message || last || "unknown"));
  }
  return null;
}

export async function generateEmailReply(ctx: EmailContext): Promise<EmailReply> {
  if (!getOpenAIClient()) throw new Error("AI disabled: missing OPENAI_API_KEY");

  const modelPref = (process.env.OPENAI_EMAIL_MODEL || DEFAULT_EMAIL_MODEL).trim() || DEFAULT_EMAIL_MODEL;
  const modelCandidates = Array.from(new Set([modelPref, DEFAULT_EMAIL_MODEL, "gpt-4o-mini"])).filter(Boolean);

  const baseSubject = safeSubjectBase(ctx.subject);
  const replySubject = baseSubject.toLowerCase().startsWith("re:") ? baseSubject : `Re: ${baseSubject}`;

  const snippetBlock = ctx.snippets?.length
    ? `Approved snippets (use verbatim if relevant):\n${ctx.snippets
        .map((s) => `- ${s.title}: ${s.body}`)
        .join("\n")}`
    : "";

  const threadBlock = ctx.threadPeek?.length
    ? `Thread context (latest):\n${ctx.threadPeek
        .map((t) => `- ${t.from}: ${t.subject}`)
        .join("\n")}`
    : "";

  const systemBase = `
You are the email assistant for ${ctx.businessName}.
Tone: ${ctx.tone}. Use NZ English.
Owner instructions (follow strictly):
${ctx.instructionPrompt || "(none)"}

Hard rules:
- Write a NEW reply. Do NOT quote, paraphrase, or repeat the customer's email.
- Do NOT include the inbound email content, even partially.
- Be concise (80–140 words unless the user explicitly asked multiple questions).
- Never invent prices, timings, policies, refunds, guarantees, or availability.
- If booking intent is unclear: ask exactly ONE clarifying question + give one next step.
- If booking intent exists and availability is unknown: invite them to pick a time or use the booking link.
- Use approved snippets verbatim if relevant; otherwise do not invent policy text.
- Output MUST be JSON ONLY: {"subject":"...","body":"..."} (no markdown, no extra keys).
${snippetBlock ? `\n${snippetBlock}\n` : ""}
`.trim();

  const user = `
From: ${ctx.from || "unknown"}
Subject: ${baseSubject}
Category: ${ctx.label || "other"}
Snippet (inbound email excerpt; do NOT echo):
${ctx.snippet || ""}
${threadBlock ? `\n${threadBlock}` : ""}
`.trim();

  // If the preferred model is unavailable, fall back cleanly to gpt-4o-mini.
  // (callOpenAI marks model issues on thrown errors; here we re-run only when needed.)

  let first: { content: string; model: string } | null = null;
  let lastErr: any = null;

  for (const m of modelCandidates) {
    try {
      first = await callOpenAI({
        model: m,
        temperature: 0.4,
        system: systemBase,
        user,
        maxAttempts: 3,
        timeoutMs: 18_000,
      });
      break;
    } catch (e: any) {
      lastErr = e;
      if (!(e as any)?.modelIssue) throw e;
      // try next model
    }
  }

  if (!first) {
    throw new Error(String(lastErr?.message || "AI unavailable"));
  }

  let parsed = parseReplyPayload(first.content, replySubject);

  // Basic cleanup: if model returned empty body, treat as failure.
  if (!parsed.body || parsed.body.trim().length < 10) {
    throw new Error("AI returned an empty reply");
  }

  // If it still looks like it echoed the inbound email, force a stricter retry.
  if (looksLikeEcho(parsed.body, ctx.snippet)) {
    const second = await callOpenAI({
      model: first.model,
      temperature: 0.2,
      system: systemBase + "\n\nYou violated the no-echo rule previously. Generate a totally fresh reply now.",
      user,
      maxAttempts: 2,
      timeoutMs: 18_000,
    });

    parsed = parseReplyPayload(second.content, replySubject);

    if (looksLikeEcho(parsed.body, ctx.snippet)) {
      throw new Error("AI reply too similar to inbound");
    }
  }

  // Enforce reasonable size (guard against rambles)
  const body = parsed.body.trim();
  const words = body.split(/\s+/).filter(Boolean);
  if (words.length > 220) {
    // One more compress pass (fast) — if it fails, still return trimmed version.
    try {
      const third = await callOpenAI({
        model: first.model,
        temperature: 0.2,
        system:
          systemBase +
          "\n\nRewrite your reply to be shorter and punchier (<= 140 words) without losing the key action/next-step. Output JSON only.",
        user: `Here is your draft reply (do NOT include inbound email):\n\n${body}`,
        maxAttempts: 2,
        timeoutMs: 15_000,
      });
      const compact = parseReplyPayload(third.content, replySubject);
      parsed.body = compact.body?.trim() || body;
      parsed.subject = compact.subject?.trim() || parsed.subject;
    } catch {
      // keep original
    }
  }

  const finalBody = ctx.signature ? `${parsed.body.trim()}\n\n${ctx.signature}` : parsed.body.trim();

  return {
    subject: (parsed.subject || replySubject).trim() || replySubject,
    body: finalBody,
    meta: {
      model: first.model,
      generatedAt: new Date().toISOString(),
    },
  };
}
