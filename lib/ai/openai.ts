import OpenAI from "openai";

const apiKey = (process.env.OPENAI_API_KEY || "").trim();
const client = apiKey ? new OpenAI({ apiKey }) : null;

const DEFAULT_MODEL = "gpt-5-mini";

type EmailContext = {
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

type EmailReply = {
  subject: string;
  body: string;
  meta: Record<string, unknown>;
};

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

function parseReplyPayload(raw: string, fallbackSubject: string) {
  const trimmed = raw.trim();
  if (!trimmed) return { subject: fallbackSubject, body: "" };
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { subject?: string; body?: string };
      const subject = (parsed.subject || fallbackSubject).toString().trim();
      const body = (parsed.body || "").toString().trim();
      return { subject, body };
    } catch {
      // fallthrough
    }
  }

  const subjectMatch = trimmed.match(/subject:\s*(.+)/i);
  const bodyMatch = trimmed.match(/body:\s*([\s\S]+)/i);
  if (subjectMatch || bodyMatch) {
    const subject = (subjectMatch?.[1] || fallbackSubject).trim();
    const body = (bodyMatch?.[1] || "").trim();
    return { subject, body };
  }

  return { subject: fallbackSubject, body: trimmed };
}

export function hasOpenAI() {
  return Boolean(client);
}

export async function generateEmailReply(ctx: EmailContext): Promise<EmailReply> {
  if (!client) {
    throw new Error("AI disabled: missing OPENAI_API_KEY");
  }

  const model = (process.env.OPENAI_EMAIL_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const subject = ctx.subject.toLowerCase().startsWith("re:") ? ctx.subject : `Re: ${ctx.subject}`;
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

  const system = `
You are the email assistant for ${ctx.businessName}.
Tone: ${ctx.tone}. Use NZ English.
Owner instructions (follow strictly):
${ctx.instructionPrompt || "(none)"}

Rules:
- Write a new reply. Do NOT quote or repeat the customer's email.
- Be concise (80–140 words).
- Never invent prices, timings, policies, or promises.
- If booking intent is unclear: ask one clarifying question + helpful next step.
- If booking intent exists and availability is unknown: invite them to pick a time or use the booking link.
- Use approved snippets when relevant; do NOT invent policy text.
${snippetBlock ? `\n${snippetBlock}\n` : ""}
Return JSON only with keys: subject, body.
`.trim();

  const user = `
From: ${ctx.from || "unknown"}
Subject: ${ctx.subject}
Category: ${ctx.label || "other"}
Snippet: ${ctx.snippet}
${threadBlock}
`.trim();

  const attempt = async (retry: boolean) => {
    const res = await client.chat.completions.create({
      model,
      temperature: retry ? 0.2 : 0.4,
      messages: [
        { role: "system", content: system + (retry ? "\nAvoid repeating any phrasing from the email." : "") },
        { role: "user", content: user },
      ],
    });
    const content = res.choices[0]?.message?.content?.trim() || "";
    return parseReplyPayload(content, subject);
  };

  let reply = await attempt(false);
  if (hasLongOverlap(reply.body, ctx.snippet)) {
    reply = await attempt(true);
  }
  if (hasLongOverlap(reply.body, ctx.snippet)) {
    throw new Error("AI reply echoed source content");
  }

  const finalBody = reply.body ? (ctx.signature ? `${reply.body}\n\n${ctx.signature}` : reply.body) : "";
  return {
    subject: reply.subject || subject,
    body: finalBody,
    meta: { model },
  };
}
