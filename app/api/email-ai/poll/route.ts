// app/api/Email-ai/poll/route.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getOrgEntitlements } from "@/lib/entitlements";
import { auth } from "@/lib/auth";
import { getToken } from "next-auth/jwt";
import { google, gmail_v1 } from "googleapis";
import OpenAI from "openai";


/* ──────────────────────────────────────────────
   Runtime / cache
────────────────────────────────────────────── */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/* ──────────────────────────────────────────────
   Constants / guards
────────────────────────────────────────────── */
const MAX_PAGES = 5;                   // safety for long inboxes
const MAX_RESULTS_PER_PAGE = 50;       // Gmail API page size
const MAX_DRAFTS_PER_RUN = 40;         // keeps runs bounded
const DEFAULT_LOOKBACK_DAYS = 14;      // quick poll
const BACKFILL_LOOKBACK_DAYS = 90;     // deeper scan
const OPENAI_MODEL = "gpt-4o-mini";    // change if you like
const AI_TIMEOUT_MS = 12_000;
const GMAIL_TIMEOUT_MS = 15_000;
const OPENAI_CONCURRENCY = 4;          // small pool
const MIN_BODY_CHARS_TO_REPLY = 12;    // skip ultra-short

/* ──────────────────────────────────────────────
   OpenAI client (optional)
────────────────────────────────────────────── */
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

/* ──────────────────────────────────────────────
   Helpers
────────────────────────────────────────────── */
function h(
  headers: Array<{ name?: string; value?: string }> | undefined,
  name: string
) {
  if (!headers?.length) return "";
  const row = headers.find((x) => (x?.name || "").toLowerCase() === name.toLowerCase());
  return (row?.value || "").trim();
}

function b64url(s: string) {
  return Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function asBool(v: string | null) {
  return v === "1" || v === "true";
}

function safeStr(v: unknown, fallback = "") {
  if (typeof v === "string") return v;
  if (v == null) return fallback;
  try { return String(v); } catch { return fallback; }
}

type Snippet = {
  id?: string;
  title: string;
  body: string;
  keywords?: string[];
};

function normalizeSnippets(raw: unknown): Snippet[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const row = item as Record<string, unknown>;
      const title = safeStr(row.title || row.name || "", "");
      const body = safeStr(row.body || row.content || "", "");
      const keywords = Array.isArray(row.keywords)
        ? row.keywords.map((k) => safeStr(k, "")).filter(Boolean)
        : [];
      if (!title || !body) return null;
      return { id: safeStr(row.id, ""), title, body, keywords };
    })
    .filter(Boolean) as Snippet[];
}

function pickSnippets(snippets: Snippet[], text: string) {
  const haystack = text.toLowerCase();
  return snippets.filter((snip) => {
    if (!snip.keywords || snip.keywords.length === 0) return false;
    return snip.keywords.some((k) => haystack.includes(k.toLowerCase()));
  });
}

/** Prefer Gmail internalDate (epoch ms). Fallback to Date header. */
function parseGmailDate(internalDate?: string | null, dateHeader?: string) {
  const a = internalDate ? Number(internalDate) : 0;
  if (a > 0 && Number.isFinite(a)) return a;
  const b = dateHeader ? Date.parse(dateHeader) : NaN;
  return Number.isFinite(b) ? b : Date.now();
}

/** Run a promise with a timeout. */
async function withTimeout<T>(p: Promise<T>, ms: number, label = "operation"): Promise<T> {
  let t: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    // ts-expect-error union
    const res = await Promise.race([p, timeout]);
    return res as T;
  } finally {
    clearTimeout(t!);
  }
}

/** Get Gmail auth from session or refresh using JWT. */
async function getGmail(session: any, req: Request) {
  let accessToken: string | undefined = (session as any)?.google?.access_token;
  if (!accessToken) {
    const jwt = await getToken({ req: req as any, raw: false, secureCookie: false });
    const g = (jwt as any) || {};
    const rt = g.google_refresh_token as string | undefined;
    const at = g.google_access_token as string | undefined;
    const exp = typeof g.google_expires_at === "number" ? g.google_expires_at : 0;
    if (at && exp && Date.now() < exp - 60_000) {
      accessToken = at;
    } else if (rt) {
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
      if (r.ok && j?.access_token) accessToken = j.access_token as string;
    }
  }
  if (!accessToken) throw new Error("No Gmail access token (connect Google first).");
  const auth2 = new google.auth.OAuth2();
  auth2.setCredentials({ access_token: accessToken });
  return google.gmail({ version: "v1", auth: auth2 });
}

type InboxSettings = {
  enableAutoDraft: boolean;
  enableAutoSend: boolean;
  autoSendAllowedCategories: string[];
  autoSendMinConfidence: number;
  neverAutoSendCategories: string[];
  businessHoursOnly: boolean;
  dailySendCap: number;
  requireApprovalForFirstN: number;
};

function resolveInboxSettings(data: Record<string, unknown>): InboxSettings {
  const raw = (data.emailAiInbox as Partial<InboxSettings>) || {};
  return {
    enableAutoDraft: raw.enableAutoDraft ?? true,
    enableAutoSend: raw.enableAutoSend ?? false,
    autoSendAllowedCategories:
      raw.autoSendAllowedCategories ?? ["booking_request", "reschedule", "cancellation", "pricing", "faq", "admin"],
    autoSendMinConfidence: typeof raw.autoSendMinConfidence === "number" ? raw.autoSendMinConfidence : 92,
    neverAutoSendCategories: raw.neverAutoSendCategories ?? ["complaint", "spam"],
    businessHoursOnly: raw.businessHoursOnly ?? true,
    dailySendCap: typeof raw.dailySendCap === "number" ? raw.dailySendCap : 40,
    requireApprovalForFirstN: typeof raw.requireApprovalForFirstN === "number" ? raw.requireApprovalForFirstN : 20,
  };
}

type Classification = {
  category: string;
  priority: "low" | "normal" | "high" | "urgent";
  risk: "safe" | "needs_review" | "blocked";
  confidence: number;
  reasons: string[];
};

function classifyDeterministic(subject: string, snippet: string): Classification {
  const t = `${subject} ${snippet}`.toLowerCase();
  const reasons: string[] = [];

  const has = (re: RegExp, reason: string) => {
    if (re.test(t)) reasons.push(reason);
    return re.test(t);
  };

  const isComplaint = has(/complaint|unhappy|bad service|refund|chargeback|fraud|scam|lawsuit/, "Complaint or dispute language");
  const isLegal = has(/lawyer|legal|court|claim|liability|contract breach/, "Legal-sensitive language");
  const isMedical = has(/medical|doctor|injury|pain|emergency|diagnosis/, "Medical-sensitive language");

  const urgent = has(/urgent|asap|immediately|today|emergency/, "Urgency cues detected");
  const high = has(/tomorrow|soon|priority/, "High urgency words detected");

  let category = "other";
  if (has(/reschedul|postpone|move appointment|change time/, "Reschedule request")) category = "reschedule";
  else if (has(/cancel|cancellation/, "Cancellation request")) category = "cancellation";
  else if (has(/price|pricing|cost|quote|estimate|rate|fee/, "Pricing intent")) category = "pricing";
  else if (has(/booking|book|appointment|availability|consult/, "Booking intent")) category = "booking_request";
  else if (has(/complaint|unhappy|refund|issue|problem|broken/, "Complaint or issue")) category = "complaint";
  else if (has(/hours|open|location|address|parking|where are you/, "FAQ-like inquiry")) category = "faq";
  else if (has(/invoice|receipt|billing|account|login|password/, "Admin/account request")) category = "admin";
  else if (has(/unsubscribe|promotion|win money|crypto|lottery/, "Spam-like content")) category = "spam";

  let risk: Classification["risk"] = "safe";
  if (isComplaint || isLegal || isMedical) risk = "needs_review";
  if (has(/threat|sue|suing|legal action/, "Threatening language")) risk = "blocked";

  let priority: Classification["priority"] = "normal";
  if (urgent) priority = "urgent";
  else if (high) priority = "high";
  else if (has(/whenever|no rush/, "Low urgency")) priority = "low";

  const confidence = Math.min(0.98, Math.max(0.5, 0.6 + reasons.length * 0.08));

  return { category, priority, risk, confidence, reasons: reasons.slice(0, 3) };
}

/** Generate reply body per org settings. */
async function generateReplyBody(opts: {
  businessName: string;
  defaultTone: string;
  instructionPrompt?: string | null;
  signature?: string | null;
  subject: string;
  preview: string;
  label: string;
  snippets?: Snippet[];
}) {
  const { businessName, defaultTone, instructionPrompt, signature, subject, preview, label, snippets } = opts;

  if (!openai) {
    const base = `Kia ora,\n\nThanks for reaching out about “${subject}”. We’ll come back to you shortly.\n`;
    return signature ? `${base}\n${signature}` : base;
  }

  const snippetBlock = snippets?.length
    ? `Approved snippets (use verbatim if relevant):\n${snippets
        .map((s) => `- ${s.title}: ${s.body}`)
        .join("\n")}`
    : "";

  const system = `
You are the email assistant for ${businessName}.
Tone: ${defaultTone}. Use NZ English.
Follow owner's instructions strictly:
${instructionPrompt || "(none)"}
- Use approved snippets when relevant. Do not invent policy text.
${snippetBlock}
- Be concise (80–140 words).
- Never invent prices/times/promises.
- Ask only for essentials if needed.
- Support/complaint: acknowledge + empathy + one next step.
- Job: acknowledge + clear next step (review CV or link/form).
- Unsure: say a human will follow up.
`.trim();

  const user = `
Email summary:
Subject: ${subject}
Preview: ${preview}
Class: ${label}

Write the reply BODY ONLY (no headers/signoff unless signature is appended).
`.trim();

  const res = await withTimeout(
    openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.4,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    AI_TIMEOUT_MS,
    "reply generation"
  );

  let body = res.choices[0]?.message?.content?.trim() || "";
  if (!body) body = `Kia ora,\n\nThanks for your email about “${subject}”. We’ll be back with you shortly.`;
  return signature ? `${body}\n\n${signature}` : body;
}

/** Create Gmail draft (thread-aware) and return draftId. */
async function createDraft(
  gmail: gmail_v1.Gmail,
  to: string,
  subject: string,
  inReplyTo: string | null,
  refs: string | null,
  body: string,
  threadId: string | null
) {
  const headers = [
    `To: ${to}`,
    `Subject: ${subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`}`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`] : []),
    ...(refs ? [`References: ${refs}`] : []),
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
  ];
  const raw = b64url(headers.join("\r\n") + body);
const res = await withTimeout(
  gmail.users.drafts.create({
    userId: "me",
    // keep this loose so TS doesn't complain about extra props
    requestBody: { message: { raw, threadId: threadId || undefined } as any },
  }),
  GMAIL_TIMEOUT_MS,
  "gmail.drafts.create"
);

return typeof res.data?.id === "string" ? res.data.id : undefined;
}

/** Mark message READ (optional hygiene). */
async function markRead(gmail: gmail_v1.Gmail, id: string) {
  try {
    await withTimeout(
      gmail.users.messages.modify({
        userId: "me",
        id,
        requestBody: { removeLabelIds: ["UNREAD"] },
      }),
      GMAIL_TIMEOUT_MS,
      "gmail.messages.modify"
    );
  } catch {
    /* non-fatal */
  }
}

/** Import existing drafts so UI sees them. */
async function syncExistingDrafts(gmail: gmail_v1.Gmail, orgId: string) {
  let imported = 0;
  let pageToken: string | undefined;

  for (let p = 0; p < MAX_PAGES; p++) {
    const list = await withTimeout(
      gmail.users.drafts.list({ userId: "me", maxResults: MAX_RESULTS_PER_PAGE, pageToken }),
      GMAIL_TIMEOUT_MS,
      "gmail.drafts.list"
    );
    const drafts = list.data.drafts || [];
    if (!drafts.length) break;

    for (const d of drafts) {
     const full = await withTimeout(
  gmail.users.drafts.get({ userId: "me", id: d.id! }),
  GMAIL_TIMEOUT_MS,
  "gmail.drafts.get"
);

      const msg = (full.data?.message ?? {}) as gmail_v1.Schema$Message;
      const msgId = safeStr(msg.id);
      const headers = (msg.payload?.headers || []) as any[];
      const subject = h(headers, "Subject") || "(no subject)";
      const snippet = msg.snippet || "";
      const threadId = msg.threadId || null;
      const from = h(headers, "From");

      // draft's "time" is the message's internalDate
      const receivedMs = parseGmailDate(msg.internalDate, h(headers, "Date"));

      const exists = await prisma.emailAILog.findFirst({
        where: { orgId, gmailMsgId: msgId },
        select: { id: true },
      });
      if (exists) continue;

      await prisma.emailAILog.create({
        data: {
          orgId,
          gmailMsgId: msgId,
          gmailThreadId: threadId,
          direction: "draft",
          classification: "other",
          confidence: null,
          subject,
          snippet,
          action: "draft_created",
          reason: "synced_existing_draft",
          createdAt: new Date(Number.isFinite(receivedMs) ? receivedMs : Date.now()),
          rawMeta: { from, draftId: d.id, emailEpochMs: receivedMs } as any,
        },
      });
      imported++;
    }

    pageToken = list.data.nextPageToken || undefined;
    if (!pageToken) break;
  }
  return imported;
}

/** Detect obvious automation/list mail. */
function looksAutomated(headers: any[]) {
  const listId = h(headers, "List-Id");
  const autoSub = h(headers, "List-Unsubscribe");
  const autoType = h(headers, "Auto-Submitted");
  const precedence = h(headers, "Precedence");
  const from = h(headers, "From").toLowerCase();
  if (autoType && autoType.toLowerCase() !== "no") return true;
  if (precedence && /(bulk|junk|list)/i.test(precedence)) return true;
  if (listId || autoSub) return true;
  if (/no-?reply|noreply|do-?not-?reply/.test(from)) return true;
  return false;
}
/** True if the last message in the thread is already me. */
async function threadLatestIsMe(gmail: gmail_v1.Gmail, threadId: string) {
  const tRes = await withTimeout(
    gmail.users.threads.get({ userId: "me", id: threadId, format: "metadata" }),
    GMAIL_TIMEOUT_MS,
    "gmail.threads.get"
  );

  const msgs = (tRes.data?.messages ?? []) as gmail_v1.Schema$Message[];
  if (!msgs.length) return false;

  const last = msgs[msgs.length - 1];
  const labels = new Set(last.labelIds || []);

  // If Gmail tagged the last message as SENT or DRAFT, assume we already replied.
  if (labels.has("SENT") || labels.has("DRAFT")) return true;

  // Extra sanity: if "From" header contains my address and Gmail labeled as SENT, that's me.
  const fromVal =
    (last.payload?.headers || []).find((hh) => (hh.name || "").toLowerCase() === "from")?.value || "";
  if (/<([^>]+)>/.test(fromVal) && labels.has("SENT")) return true;

  return false;
}
/* ──────────────────────────────────────────────
   Small ranked work queue for OpenAI
────────────────────────────────────────────── */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
) {
  const out: R[] = [];
  let idx = 0;
  const running: Promise<void>[] = [];

  const spawn = () => {
    if (idx >= items.length) return;
    const i = idx++;
    const p = worker(items[i]).then((r) => {
      // ts-expect-error push
      out[i] = r;
    }).catch(() => {
      // leave hole undefined
      // @ts-expect-error push
      out[i] = undefined;
    }).finally(() => spawn());
    running.push(p.then(() => {}));
  };

  for (let k = 0; k < Math.min(limit, items.length); k++) spawn();
  await Promise.all(running);
  return out;
}

/* ──────────────────────────────────────────────
   Route: POST  (run a poll)
────────────────────────────────────────────── */
export async function POST(req: Request) {
  let orgId: string | null = null;
  try {
    // 1) Auth & org
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }
  
    const membership = await prisma.membership.findFirst({
      where: { user: { email: session.user.email } },
      select: { orgId: true },
      orderBy: { orgId: "asc" },
    });
    orgId = membership?.orgId ?? null;
    if (!orgId) {
      return NextResponse.json({ ok: false, error: "No organization found for user" }, { status: 400 });
    }

    const entitlements = await getOrgEntitlements(orgId);
    if (!entitlements.features.emailAi) {
      return NextResponse.json({ ok: false, error: "Email AI disabled for this org" }, { status: 403 });
    }

    // 2) Settings
    const settings = await prisma.emailAISettings.findUnique({ where: { orgId } });
    if (!settings?.enabled) {
      await prisma.orgSettings.upsert({
        where: { orgId },
        update: {
          data: {
            ...(((await prisma.orgSettings.findUnique({ where: { orgId }, select: { data: true } }))?.data as Record<string, unknown>) || {}),
            emailAiSync: {
              lastAttemptAt: Date.now(),
              lastErrorAt: Date.now(),
              lastError: "Email AI disabled for this org",
            },
          } as any,
        },
        create: {
          orgId,
          data: {
            emailAiSync: {
              lastAttemptAt: Date.now(),
              lastErrorAt: Date.now(),
              lastError: "Email AI disabled for this org",
            },
          } as any,
        },
      });
      return NextResponse.json({ ok: false, error: "Email AI disabled for this org" }, { status: 400 });
    }

    const orgSettings = await prisma.orgSettings.findUnique({
      where: { orgId },
      select: { data: true },
    });
    const orgSettingsData = (orgSettings?.data as Record<string, unknown>) || {};
    const inboxSettings = resolveInboxSettings(orgSettingsData);
    const effectiveInboxSettings = {
      ...inboxSettings,
      enableAutoDraft: inboxSettings.enableAutoDraft && entitlements.automation.enableAutoDraft,
      enableAutoSend: inboxSettings.enableAutoSend && entitlements.automation.enableAutoSend,
      autoSendMinConfidence: Math.max(inboxSettings.autoSendMinConfidence, entitlements.automation.minConfidence),
      dailySendCap: Math.min(inboxSettings.dailySendCap, entitlements.automation.dailySendCap),
      requireApprovalForFirstN: Math.max(
        inboxSettings.requireApprovalForFirstN,
        entitlements.automation.requireApprovalFirstN
      ),
    };
    const voice = (orgSettingsData.aiVoice as {
      tone?: string;
      signature?: string;
      tabooPhrases?: string[];
      forbiddenPhrases?: string[];
      emojiLevel?: 0 | 1 | 2;
      length?: "short" | "medium" | "long";
      lengthPreference?: "short" | "medium" | "long";
    }) || {};
    const voiceTone = voice.tone && voice.tone.trim() ? voice.tone : settings.defaultTone;
    const voiceSignature = typeof voice.signature === "string" ? voice.signature : settings.signature;
    const forbidden = [
      ...(Array.isArray(voice.tabooPhrases) ? voice.tabooPhrases : []),
      ...(Array.isArray(voice.forbiddenPhrases) ? voice.forbiddenPhrases : []),
    ].filter(Boolean);
    const lengthPref = voice.lengthPreference || voice.length;
    const kbEntries = Array.isArray(orgSettingsData.knowledgeBase) ? orgSettingsData.knowledgeBase : [];
    const kbSnippets = kbEntries.map((entry: any) => ({
      id: entry.id ? `kb_${entry.id}` : `kb_${Math.random().toString(36).slice(2)}`,
      title: String(entry.title || ""),
      body: String(entry.content || ""),
      keywords: Array.isArray(entry.tags) ? entry.tags : [],
    }));
    const snippets = normalizeSnippets([...(orgSettingsData.emailSnippets || []), ...kbSnippets]);
    const voiceInstruction = [
      settings.instructionPrompt || "",
      forbidden.length ? `Forbidden phrases: ${forbidden.join(", ")}` : "",
      typeof voice.emojiLevel === "number" ? `Emoji level (0-2): ${voice.emojiLevel}` : "",
      lengthPref ? `Preferred reply length: ${lengthPref}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    await prisma.orgSettings.upsert({
      where: { orgId },
      update: {
        data: {
          ...orgSettingsData,
          emailAiSync: {
            ...(orgSettingsData.emailAiSync as any),
            lastAttemptAt: Date.now(),
          },
        } as any,
      },
      create: {
        orgId,
        data: {
          emailAiSync: {
            lastAttemptAt: Date.now(),
          },
        } as any,
      },
    });

    // 3) Gmail client
    const gmail = await getGmail(session, req);

    // 4) Options
    const url = new URL(req.url);
    const backfill = asBool(url.searchParams.get("backfill"));
    const importDraftsOnly = asBool(url.searchParams.get("importDraftsOnly"));

    // Always sync existing drafts so the UI sees them
    const draftsImported = await syncExistingDrafts(gmail, orgId);
    if (importDraftsOnly) {
      return NextResponse.json({ ok: true, scanned: 0, drafted: 0, skipped: 0, draftsImported });
    }

    // 5) Search
    const lookback = backfill ? BACKFILL_LOOKBACK_DAYS : DEFAULT_LOOKBACK_DAYS;
    const q = `in:inbox newer_than:${lookback}d -in:chats -category:promotions -category:social`;

    let pageToken: string | undefined;
    let scanned = 0;
    let drafted = 0;
    let skipped = 0;

    // We’ll collect viable candidates first, rank them, then draft with concurrency
    type Candidate = {
      id: string;
      threadId: string | null;
      subject: string;
      snippet: string;
      from: string;
      replyTo: string;
      messageId: string;
      receivedMs: number;
      label: string;
      confidence: number;
      priority: "low" | "normal" | "high" | "urgent";
      risk: "safe" | "needs_review" | "blocked";
      reasons: string[];
      score: number;
      // small thread peek for UI
      threadPeek?: { from: string; subject: string }[];
    };
    const candidates: Candidate[] = [];

    for (let page = 0; page < MAX_PAGES; page++) {
      const list = await withTimeout(
        gmail.users.messages.list({ userId: "me", q, maxResults: MAX_RESULTS_PER_PAGE, pageToken }),
        GMAIL_TIMEOUT_MS,
        "gmail.messages.list"
      );
      const ids = (list.data.messages || []).map((m: any) => m.id!).filter(Boolean);
      if (!ids.length) break;

      for (const id of ids) {
        // Idempotency
        const already = await prisma.emailAILog.findFirst({
          where: { orgId, gmailMsgId: id },
          select: { id: true },
        });
        if (already) { skipped++; continue; }

        scanned++;

        const msg = await withTimeout(
          gmail.users.messages.get({
            userId: "me",
            id,
            format: "metadata",
            metadataHeaders: [
              "Subject","From","Reply-To","Message-ID","Date",
              "List-Id","List-Unsubscribe","Precedence","Auto-Submitted"
            ],
          }),
          GMAIL_TIMEOUT_MS,
          "gmail.messages.get"
        );

        const headers: any[] = msg.data.payload?.headers || [];
        const subject = h(headers, "Subject") || "(no subject)";
        const from = h(headers, "From");
        const replyTo = h(headers, "Reply-To") || from;
        const messageId = h(headers, "Message-ID") || id;
        const snippet = (msg.data.snippet || "").trim();
        const threadId = msg.data.threadId || null;

        const receivedMs = parseGmailDate(msg.data.internalDate, h(headers, "Date"));

        // Skip obvious automation (DISABLED – we don't auto-skip here anymore)
        // if (looksAutomated(headers)) { ... }

        // Too short to be meaningful (DISABLED – still let it go to review)
        // if (!snippet || snippet.replace(/\s+/g, "").length < MIN_BODY_CHARS_TO_REPLY) { ... }

        // Already replied on this thread? (DISABLED – still show in review)
        // if (threadId && (await threadLatestIsMe(gmail, threadId))) { ... }

        // Allow/Block checks (DISABLED – don't auto-skip based on regex; everything goes to review)
        // If you want to re-enable later, tighten these regexes and add a controlled skip.
        const allowed = true;
        const blocked = false;
        // if (!allowed || blocked) { ... }  // removed

        // Light thread peek (last 2 from headers) to enrich UI later
        let threadPeek: Candidate["threadPeek"] = undefined;
        if (threadId) {
          try {
            const t = await withTimeout(
              gmail.users.threads.get({
                userId: "me",
                id: threadId,
                format: "metadata",
                metadataHeaders: ["From","Subject"]
              }),
              GMAIL_TIMEOUT_MS,
              "gmail.threads.get.peek"
            );
            const ms = (t.data.messages || []).slice(-2);
            threadPeek = ms.map(m => ({
              from: h(m.payload?.headers as any[], "From"),
              subject: h(m.payload?.headers as any[], "Subject")
            }));
          } catch { /* ignore */ }
        }

        // Classification (deterministic-first)
        const classification = classifyDeterministic(subject, snippet);
        const label = classification.category;
        const confidence = classification.confidence;

        // Rank score: newer + confident first
        const ageHours = Math.max(1, (Date.now() - receivedMs) / 3_600_000);
        const score = confidence * 0.7 + (1 / ageHours) * 0.3;

        candidates.push({
          id,
          threadId,
          subject,
          snippet,
          from,
          replyTo,
          messageId,
          receivedMs,
          label,
          confidence,
          priority: classification.priority,
          risk: classification.risk,
          reasons: classification.reasons,
          score,
          threadPeek,
        });
      }

      pageToken = list.data.nextPageToken || undefined;
      if (!pageToken) break;
    }

    // Sort by score (fresh + confident) then received time (newest first)
    candidates.sort((a, b) => (b.score - a.score) || (b.receivedMs - a.receivedMs));

    // Hard cap
    const take = candidates.slice(0, Math.max(0, Math.min(MAX_DRAFTS_PER_RUN, candidates.length)));

    // Daily caps and approval threshold (org-wide)
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const [sentToday, totalSent] = await Promise.all([
      prisma.emailAILog.count({
        where: { orgId, action: { in: ["auto_sent", "sent"] }, createdAt: { gte: dayStart } },
      }),
      prisma.emailAILog.count({
        where: { orgId, action: { in: ["auto_sent", "sent"] } },
      }),
    ]);
    let sentCounter = sentToday;
    let totalSentCounter = totalSent;

    const withinBusinessHours = (ms: number) => {
      if (!inboxSettings.businessHoursOnly) return true;
      const hours = settings.businessHoursJson as Record<string, [number, number]> | null | undefined;
      const tz = settings.businessHoursTz || "Pacific/Auckland";
      if (!hours || !Object.keys(hours).length) return true;
      const date = new Date(ms);
      const parts = new Intl.DateTimeFormat("en-NZ", {
        timeZone: tz,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(date);
      const map = new Map(parts.map((p) => [p.type, p.value]));
      const weekday = (map.get("weekday") || "Mon").toLowerCase().slice(0, 3);
      const hour = Number(map.get("hour") || 0);
      const minute = Number(map.get("minute") || 0);
      const minutes = hour * 60 + minute;
      const window = hours[weekday];
      if (!window) return false;
      return minutes >= window[0] && minutes <= window[1];
    };

    // Draft with small OpenAI concurrency
    await runWithConcurrency(take, OPENAI_CONCURRENCY, async (c) => {
      try {
        const nameGuess = (c.from.split("<")[0]?.trim().replace(/["']/g, "")) || "there";
        const preview = `From ${nameGuess}: ${c.snippet}`;

        const isBlocked = c.risk === "blocked";
        const isNeedsReview = c.risk === "needs_review";
        const automationPaused = inboxSettings.automationPaused;
        const autoSendEligible =
          !automationPaused &&
          effectiveInboxSettings.enableAutoSend &&
          !isBlocked &&
          c.risk === "safe" &&
          inboxSettings.autoSendAllowedCategories.includes(c.label) &&
          !inboxSettings.neverAutoSendCategories.includes(c.label) &&
          c.confidence * 100 >= effectiveInboxSettings.autoSendMinConfidence &&
          withinBusinessHours(c.receivedMs) &&
          sentCounter < effectiveInboxSettings.dailySendCap &&
          totalSentCounter >= effectiveInboxSettings.requireApprovalForFirstN;

        const shouldDraft = !automationPaused && effectiveInboxSettings.enableAutoDraft && !isBlocked;
        const shouldGenerate = shouldDraft || autoSendEligible;

        const matchedSnippets = shouldGenerate
          ? pickSnippets(snippets, `${c.subject} ${c.snippet} ${c.threadPeek}`)
          : [];
        const suggestedBody = shouldGenerate
          ? await generateReplyBody({
              businessName: settings.businessName,
              defaultTone: voiceTone,
              instructionPrompt: voiceInstruction,
              signature: voiceSignature,
              subject: c.subject,
              preview,
              label: c.label,
              snippets: matchedSnippets,
            })
          : "";

        const draftId = shouldDraft
          ? await createDraft(
              gmail,
              c.replyTo,
              c.subject,
              c.messageId,
              c.messageId,
              suggestedBody,
              c.threadId
            )
          : null;

        await markRead(gmail, c.id);

        const action = isBlocked
          ? "skipped_blocked"
          : autoSendEligible
          ? "queued_for_review"
          : "queued_for_review";

        const log = await prisma.emailAILog.create({
          data: {
            orgId,
            gmailThreadId: c.threadId,
            gmailMsgId: c.id,
            direction: "inbound",
            classification: c.label,
            confidence: c.confidence,
            subject: c.subject,
            snippet: c.snippet,
            action,
            reason:
              c.confidence >= (settings.minConfidenceToSend ?? 0.65)
                ? "auto_drafted_high_conf"
                : "auto_drafted_low_conf",

            // use the real Gmail delivery time for ordering (until you add receivedAt column)
            createdAt: new Date(Number.isFinite(c.receivedMs) ? c.receivedMs : Date.now()),

            // everything else lives in rawMeta
            rawMeta: {
              from: c.from,
              replyTo: c.replyTo,
              emailEpochMs: c.receivedMs,
              threadPeek: c.threadPeek,
              draftId: draftId ?? null,
              suggested: shouldGenerate
                ? {
                    subject: c.subject.toLowerCase().startsWith("re:")
                      ? c.subject
                      : `Re: ${c.subject}`,
                    body: suggestedBody,
                  }
                : null,
              ai: {
                category: c.label,
                priority: c.priority,
                risk: c.risk,
                confidence: c.confidence,
                reasons: c.reasons,
                autoSendEligible,
                usedSnippets: matchedSnippets.map((s) => s.title),
              },
            } as any,
          },
        });

        if (autoSendEligible) {
          const origin = new URL(req.url).origin;
          await fetch(`${origin}/api/email-ai/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ logId: log.id, subject: log.subject, body: suggestedBody }),
          }).catch(() => {});
          sentCounter += 1;
          totalSentCounter += 1;
        }

        if (shouldDraft) drafted++;
} catch {
  skipped++;
}
});

    await prisma.orgSettings.upsert({
      where: { orgId },
      update: {
        data: {
          ...orgSettingsData,
          emailAiSync: {
            ...(orgSettingsData.emailAiSync as any),
            lastSuccessAt: Date.now(),
            lastError: null,
            lastErrorAt: null,
          },
        } as any,
      },
      create: {
        orgId,
        data: {
          emailAiSync: {
            lastSuccessAt: Date.now(),
            lastError: null,
            lastErrorAt: null,
          },
        } as any,
      },
    });

    // ---- response
    return NextResponse.json({
      ok: true,
      scanned,
      drafted,
      skipped,
      draftsImported,
      caps: {
        MAX_PAGES,
        MAX_RESULTS_PER_PAGE,
        MAX_DRAFTS_PER_RUN,
        OPENAI_CONCURRENCY,
      },
    });
  } catch (err: any) {
    console.error("[email-ai/poll] error:", err);
    try {
      // best-effort sync status update (if orgId available via closure)
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      if (typeof orgId === "string") {
        await prisma.orgSettings.upsert({
          where: { orgId },
          update: {
            data: {
              ...(((await prisma.orgSettings.findUnique({ where: { orgId }, select: { data: true } }))?.data as Record<string, unknown>) || {}),
              emailAiSync: {
                lastAttemptAt: Date.now(),
                lastErrorAt: Date.now(),
                lastError: err?.message || "Unexpected error",
              },
            } as any,
          },
          create: {
            orgId,
            data: {
              emailAiSync: {
                lastAttemptAt: Date.now(),
                lastErrorAt: Date.now(),
                lastError: err?.message || "Unexpected error",
              },
            } as any,
          },
        });
      }
    } catch {
      // ignore sync status failures
    }
    return NextResponse.json(
      { ok: false, error: err?.message || "Unexpected error" },
      { status: 500 }
    );
  }
} // <-- closes export async function POST

/* ──────────────────────────────────────────────
   Small info endpoint
────────────────────────────────────────────── */
export async function GET() {
  return NextResponse.json({
    ok: true,
    info:
      "POST to trigger poll. Options: ?backfill=1 (90d window) and/or ?importDraftsOnly=1 (sync only existing drafts).",
  });
}
