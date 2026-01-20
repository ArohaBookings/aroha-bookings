// app/api/email-ai/poll/route.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getOrgEntitlements } from "@/lib/entitlements";
import { auth } from "@/lib/auth";
import { getToken } from "next-auth/jwt";
import { google, gmail_v1 } from "googleapis";
import { readGmailIntegration } from "@/lib/orgSettings";
import { generateEmailReply, hasOpenAI } from "@/lib/ai/openai";

/* ──────────────────────────────────────────────
   Runtime / cache
────────────────────────────────────────────── */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/* ──────────────────────────────────────────────
   Safety limits
────────────────────────────────────────────── */
const MAX_PAGES = 5;
const MAX_RESULTS_PER_PAGE = 50;
const MAX_ITEMS_PER_RUN = 40;
const DEFAULT_LOOKBACK_DAYS = 14;
const BACKFILL_LOOKBACK_DAYS = 90;

const AI_TIMEOUT_MS = 12_000;
const GMAIL_TIMEOUT_MS = 15_000;
const OPENAI_CONCURRENCY = 4;

const MIN_SNIPPET_CHARS = 6; // super low: we still log nearly everything

/* ──────────────────────────────────────────────
   Helpers
────────────────────────────────────────────── */
function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store, max-age=0" } });
}

function headerValue(headers: Array<{ name?: string; value?: string }> | undefined, name: string) {
  if (!headers?.length) return "";
  const found = headers.find((x) => (x?.name || "").toLowerCase() === name.toLowerCase());
  return (found?.value || "").trim();
}

function safeStr(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (v == null) return fallback;
  try {
    return String(v);
  } catch {
    return fallback;
  }
}

function asBool(v: string | null) {
  return v === "1" || v === "true";
}

function parseGmailDate(internalDate?: string | null, dateHeader?: string) {
  const a = internalDate ? Number(internalDate) : 0;
  if (a > 0 && Number.isFinite(a)) return a;
  const b = dateHeader ? Date.parse(dateHeader) : NaN;
  return Number.isFinite(b) ? b : Date.now();
}

async function withTimeout<T>(p: Promise<T>, ms: number, label = "operation"): Promise<T> {
  let t: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return (await Promise.race([p, timeout])) as T;
  } finally {
    if (t) clearTimeout(t);
  }
}

async function getGmailClient(session: any, req: Request): Promise<gmail_v1.Gmail> {
  let accessToken: string | undefined = (session as any)?.google?.access_token;

  if (!accessToken) {
    const jwt = await getToken({ req: req as any, raw: false, secureCookie: false });
    const g = (jwt as any) || {};
    const refreshToken = g.google_refresh_token as string | undefined;
    const cachedAccess = g.google_access_token as string | undefined;
    const exp = typeof g.google_expires_at === "number" ? g.google_expires_at : 0;

    if (cachedAccess && exp && Date.now() < exp - 60_000) {
      accessToken = cachedAccess;
    } else if (refreshToken) {
      const body = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID || "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      });

      const r = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const j = (await r.json().catch(() => ({}))) as any;
      if (r.ok && typeof j?.access_token === "string" && j.access_token.trim()) {
        accessToken = j.access_token;
      }
    }
  }

  if (!accessToken) throw new Error("No Gmail access token (connect Google first).");

  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials({ access_token: accessToken });
  return google.gmail({ version: "v1", auth: oauth2 });
}

type InboxSettings = {
  enableAutoDraft: boolean;
  enableAutoSend: boolean;
  autoSendAllowedCategories: string[];
  autoSendMinConfidence: number; // 0-100
  neverAutoSendCategories: string[];
  businessHoursOnly: boolean;
  dailySendCap: number;
  requireApprovalForFirstN: number;
  automationPaused?: boolean; // optional (fixes TS2339)
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
    automationPaused: raw.automationPaused ?? false,
  };
}

type Snippet = { id?: string; title: string; body: string; keywords?: string[] };

function normalizeSnippets(raw: unknown): Snippet[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const row = (item || {}) as Record<string, unknown>;
      const title = safeStr(row.title || row.name || "", "").trim();
      const body = safeStr(row.body || row.content || "", "").trim();
      const keywords = Array.isArray(row.keywords)
        ? row.keywords.map((k) => safeStr(k, "").trim()).filter(Boolean)
        : [];
      if (!title || !body) return null;
      return { id: safeStr(row.id, ""), title, body, keywords };
    })
    .filter(Boolean) as Snippet[];
}

function pickSnippets(snippets: Snippet[], text: string) {
  const hay = text.toLowerCase();
  return snippets.filter((s) => (s.keywords || []).some((k) => hay.includes(String(k).toLowerCase())));
}

type Classification = {
  category: string;
  priority: "low" | "normal" | "high" | "urgent";
  risk: "safe" | "needs_review" | "blocked";
  confidence: number; // 0-1
  reasons: string[];
};

function classifyDeterministic(subject: string, snippet: string): Classification {
  const t = `${subject} ${snippet}`.toLowerCase();
  const reasons: string[] = [];

  const has = (re: RegExp, reason: string) => {
    const ok = re.test(t);
    if (ok) reasons.push(reason);
    return ok;
  };

  const isComplaint = has(/complaint|unhappy|bad service|refund|chargeback|fraud|scam|lawsuit/, "Complaint/dispute language");
  const isLegal = has(/lawyer|legal|court|claim|liability|contract breach/, "Legal-sensitive language");
  const isMedical = has(/medical|doctor|injury|pain|emergency|diagnosis/, "Medical-sensitive language");

  const urgent = has(/urgent|asap|immediately|today|emergency/, "Urgency cues");
  const high = has(/tomorrow|soon|priority/, "High urgency cues");

  let category = "other";
  if (has(/reschedul|postpone|move appointment|change time/, "Reschedule request")) category = "reschedule";
  else if (has(/cancel|cancellation/, "Cancellation request")) category = "cancellation";
  else if (has(/price|pricing|cost|quote|estimate|rate|fee/, "Pricing intent")) category = "pricing";
  else if (has(/booking|book|appointment|availability|consult/, "Booking intent")) category = "booking_request";
  else if (has(/hours|open|location|address|parking|where are you/, "FAQ inquiry")) category = "faq";
  else if (has(/invoice|receipt|billing|account|login|password/, "Admin inquiry")) category = "admin";
  else if (has(/unsubscribe|promotion|win money|crypto|lottery/, "Spam-like content")) category = "spam";
  else if (isComplaint) category = "complaint";

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

function buildLogIdempotencyKey(threadId: string | null, msgId: string, settingsVersion: string) {
  return `${threadId || "no-thread"}:${msgId}:${settingsVersion}`;
}

async function markRead(gmailClient: gmail_v1.Gmail, id: string) {
  try {
    await withTimeout(
      gmailClient.users.messages.modify({
        userId: "me",
        id,
        requestBody: { removeLabelIds: ["UNREAD"] },
      }),
      GMAIL_TIMEOUT_MS,
      "gmail.messages.modify"
    );
  } catch {
    // non-fatal
  }
}

async function syncExistingDrafts(gmailClient: gmail_v1.Gmail, orgId: string) {
  let imported = 0;
  let pageToken: string | undefined;

  for (let p = 0; p < MAX_PAGES; p++) {
    const listRes = await withTimeout(
      gmailClient.users.drafts.list({ userId: "me", maxResults: MAX_RESULTS_PER_PAGE, pageToken }),
      GMAIL_TIMEOUT_MS,
      "gmail.drafts.list"
    );
    const drafts = listRes.data.drafts || [];
    if (!drafts.length) break;

    for (const d of drafts) {
      if (!d.id) continue;

      const full = await withTimeout(
        gmailClient.users.drafts.get({ userId: "me", id: d.id, format: "full" }),
        GMAIL_TIMEOUT_MS,
        "gmail.drafts.get"
      );

      const msg = (full.data?.message ?? {}) as gmail_v1.Schema$Message;
      const msgId = safeStr(msg.id);
      if (!msgId) continue;

      const exists = await prisma.emailAILog.findFirst({
        where: { orgId, gmailMsgId: msgId },
        select: { id: true },
      });
      if (exists) continue;

      const headers = (msg.payload?.headers || []) as any[];
      const subject = headerValue(headers, "Subject") || "(no subject)";
      const snippet = msg.snippet || "";
      const threadId = msg.threadId || null;
      const from = headerValue(headers, "From");
      const receivedMs = parseGmailDate(msg.internalDate, headerValue(headers, "Date"));

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

    pageToken = listRes.data.nextPageToken || undefined;
    if (!pageToken) break;
  }

  return imported;
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
) {
  let idx = 0;
  const runners: Promise<void>[] = [];

  const spawn = async () => {
    while (idx < items.length) {
      const i = idx++;
      await worker(items[i]);
    }
  };

  for (let k = 0; k < Math.min(limit, items.length); k++) runners.push(spawn());
  await Promise.all(runners);
}

/* ──────────────────────────────────────────────
   Route: POST (poll)
────────────────────────────────────────────── */
export async function POST(req: Request) {
  let orgId: string | null = null;
  let orgSettingsData: Record<string, unknown> = {};

  try {
    // 1) Auth + org
    const session = await auth();
    if (!session?.user?.email) return json({ ok: false, error: "Not authenticated" }, 401);

    const membership = await prisma.membership.findFirst({
      where: { user: { email: session.user.email } },
      select: { orgId: true },
      orderBy: { orgId: "asc" },
    });

    orgId = membership?.orgId ?? null;
    if (!orgId) return json({ ok: false, error: "No organization found for user" }, 400);

    const entitlements = await getOrgEntitlements(orgId);
    if (!entitlements.features.emailAi) return json({ ok: false, error: "Email AI disabled for this org" }, 403);

    // 2) Settings (DB)
    const settings = await prisma.emailAISettings.findUnique({ where: { orgId } });
    if (!settings?.enabled) return json({ ok: false, error: "Email AI disabled for this org" }, 400);
    const settingsVersion = settings.updatedAt ? settings.updatedAt.toISOString() : "unknown";

    const orgSettings = await prisma.orgSettings.findUnique({ where: { orgId }, select: { data: true } });
    orgSettingsData = (orgSettings?.data as Record<string, unknown>) || {};

    const gmailIntegration = readGmailIntegration(orgSettingsData);
    if (!gmailIntegration.connected) return json({ ok: false, error: "Gmail disconnected" }, 400);

    const inboxSettings = resolveInboxSettings(orgSettingsData);
    const effectiveInboxSettings = {
      ...inboxSettings,
      enableAutoDraft: inboxSettings.enableAutoDraft && entitlements.automation.enableAutoDraft,
      enableAutoSend: inboxSettings.enableAutoSend && entitlements.automation.enableAutoSend,
      autoSendMinConfidence: Math.max(inboxSettings.autoSendMinConfidence, entitlements.automation.minConfidence),
      dailySendCap: Math.min(inboxSettings.dailySendCap, entitlements.automation.dailySendCap),
      requireApprovalForFirstN: Math.max(inboxSettings.requireApprovalForFirstN, entitlements.automation.requireApprovalFirstN),
    };

    // Voice / template inputs (tolerant)
    const voice = (orgSettingsData.aiVoice as any) || {};
    const voiceTone = typeof voice.tone === "string" && voice.tone.trim() ? voice.tone.trim() : (settings.defaultTone || "friendly");
    const voiceSignature =
      typeof voice.signature === "string" ? voice.signature : (settings.signature as string | null | undefined) || null;

    const forbidden = [
      ...(Array.isArray(voice.tabooPhrases) ? voice.tabooPhrases : []),
      ...(Array.isArray(voice.forbiddenPhrases) ? voice.forbiddenPhrases : []),
    ]
      .map((x: any) => safeStr(x, "").trim())
      .filter(Boolean);

    const lengthPref = safeStr(voice.lengthPreference || voice.length || "", "").trim();
    const instructionPrompt = [
      safeStr(settings.instructionPrompt || "", "").trim(),
      forbidden.length ? `Forbidden phrases: ${forbidden.join(", ")}` : "",
      typeof voice.emojiLevel === "number" ? `Emoji level (0-2): ${voice.emojiLevel}` : "",
      lengthPref ? `Preferred reply length: ${lengthPref}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    // Snippets (fixes TS2488 by forcing arrays)
    const kbEntries = Array.isArray((orgSettingsData as any).knowledgeBase) ? ((orgSettingsData as any).knowledgeBase as any[]) : [];
    const kbSnippets = kbEntries.map((entry: any) => ({
      id: entry?.id ? `kb_${entry.id}` : `kb_${Math.random().toString(36).slice(2)}`,
      title: safeStr(entry?.title || "", ""),
      body: safeStr(entry?.content || "", ""),
      keywords: Array.isArray(entry?.tags) ? entry.tags : [],
    }));

    const emailSnippetsArr = Array.isArray((orgSettingsData as any).emailSnippets) ? ((orgSettingsData as any).emailSnippets as any[]) : [];
    const snippets = normalizeSnippets([...emailSnippetsArr, ...kbSnippets]);

    const aiEnabled = hasOpenAI();

    // 3) Gmail client (no TS2451 redeclare: name is gmailClient)
    const gmailClient = await getGmailClient(session, req);

    // 4) Options
    const url = new URL(req.url);
    const backfill = asBool(url.searchParams.get("backfill"));
    const importDraftsOnly = asBool(url.searchParams.get("importDraftsOnly"));

    // Always import drafts for visibility (safe, bounded)
    const draftsImported = await syncExistingDrafts(gmailClient, orgId);
    if (importDraftsOnly) return json({ ok: true, scanned: 0, drafted: 0, skipped: 0, draftsImported });

    // 5) Search
    const lookback = backfill ? BACKFILL_LOOKBACK_DAYS : DEFAULT_LOOKBACK_DAYS;
    const q = `in:inbox newer_than:${lookback}d -in:chats -category:promotions -category:social`;

    type Candidate = {
      id: string;
      threadId: string | null;
      subject: string;
      snippet: string;
      from: string;
      replyTo: string;
      receivedMs: number;
      label: string;
      confidence: number; // 0-1
      priority: "low" | "normal" | "high" | "urgent";
      risk: "safe" | "needs_review" | "blocked";
      reasons: string[];
      score: number;
      threadPeek?: { from: string; subject: string }[];
    };

    const candidates: Candidate[] = [];
    let pageToken: string | undefined;
    let scanned = 0;
    let drafted = 0;
    let skipped = 0;

    for (let page = 0; page < MAX_PAGES; page++) {
      const listRes = await withTimeout(
        gmailClient.users.messages.list({ userId: "me", q, maxResults: MAX_RESULTS_PER_PAGE, pageToken }),
        GMAIL_TIMEOUT_MS,
        "gmail.messages.list"
      );

      const ids = (listRes.data.messages || []).map((m: any) => safeStr(m?.id)).filter(Boolean);
      if (!ids.length) break;

      for (const id of ids) {
        // Idempotency: already logged?
        const already = await prisma.emailAILog.findFirst({ where: { orgId, gmailMsgId: id }, select: { id: true } });
        if (already) {
          skipped++;
          continue;
        }

        scanned++;

        const msgRes = await withTimeout(
          gmailClient.users.messages.get({
            userId: "me",
            id,
            format: "metadata",
            metadataHeaders: ["Subject", "From", "Reply-To", "Message-ID", "Date"],
          }),
          GMAIL_TIMEOUT_MS,
          "gmail.messages.get"
        );

        const headers: any[] = msgRes.data.payload?.headers || [];
        const subject = headerValue(headers, "Subject") || "(no subject)";
        const from = headerValue(headers, "From");
        const replyTo = headerValue(headers, "Reply-To") || from;
        const snippet = (msgRes.data.snippet || "").trim();
        const threadId = msgRes.data.threadId || null;
        const receivedMs = parseGmailDate(msgRes.data.internalDate, headerValue(headers, "Date"));

        // allow super short, but don’t waste AI effort on empty
        const effectiveSnippet = snippet.length >= MIN_SNIPPET_CHARS ? snippet : snippet;

        // Peek thread (best-effort, bounded)
        let threadPeek: Candidate["threadPeek"] = undefined;
        if (threadId) {
          try {
            const tRes = await withTimeout(
              gmailClient.users.threads.get({
                userId: "me",
                id: threadId,
                format: "metadata",
                metadataHeaders: ["From", "Subject"],
              }),
              GMAIL_TIMEOUT_MS,
              "gmail.threads.get.peek"
            );
            const ms = (tRes.data.messages || []).slice(-2);
            threadPeek = ms.map((m) => ({
              from: headerValue(m.payload?.headers as any[], "From"),
              subject: headerValue(m.payload?.headers as any[], "Subject"),
            }));
          } catch {
            // ignore
          }
        }

        const cls = classifyDeterministic(subject, effectiveSnippet);
        const ageHours = Math.max(1, (Date.now() - receivedMs) / 3_600_000);
        const score = cls.confidence * 0.7 + (1 / ageHours) * 0.3;

        candidates.push({
          id,
          threadId,
          subject,
          snippet: effectiveSnippet,
          from,
          replyTo,
          receivedMs,
          label: cls.category,
          confidence: cls.confidence,
          priority: cls.priority,
          risk: cls.risk,
          reasons: cls.reasons,
          score,
          threadPeek,
        });
      }

      pageToken = listRes.data.nextPageToken || undefined;
      if (!pageToken) break;
    }

    candidates.sort((a, b) => (b.score - a.score) || (b.receivedMs - a.receivedMs));
    const take = candidates.slice(0, Math.min(MAX_ITEMS_PER_RUN, candidates.length));

    // Caps
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);

    const [sentToday, totalSent] = await Promise.all([
      prisma.emailAILog.count({ where: { orgId, action: { in: ["auto_sent", "sent"] }, createdAt: { gte: dayStart } } }),
      prisma.emailAILog.count({ where: { orgId, action: { in: ["auto_sent", "sent"] } } }),
    ]);

    let sentCounter = sentToday;
    let totalSentCounter = totalSent;
    const orgIdValue = orgId as string;

    const withinBusinessHours = (ms: number) => {
      if (!effectiveInboxSettings.businessHoursOnly) return true;

      const hours = (settings.businessHoursJson as any) as Record<string, [number, number]> | null | undefined;
      const tz = safeStr(settings.businessHoursTz || "Pacific/Auckland", "Pacific/Auckland");
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

    // Main work
    await runWithConcurrency(take, OPENAI_CONCURRENCY, async (c) => {
      try {
        const idempotencyKey = buildLogIdempotencyKey(c.threadId, c.id, settingsVersion);
        if (c.threadId) {
          const recent = await prisma.emailAILog.findMany({
            where: { orgId: orgIdValue, gmailThreadId: c.threadId },
            orderBy: { createdAt: "desc" },
            take: 5,
            select: { rawMeta: true },
          });
          const dup = recent.some((r) => (r.rawMeta as any)?.idempotencyKey === idempotencyKey);
          if (dup) {
            skipped++;
            return;
          }
        }

        const paused = Boolean(effectiveInboxSettings.automationPaused);
        const blocked = c.risk === "blocked";
        const hasRecipient = Boolean(c.replyTo && c.replyTo.trim());

        const autoSendEligible =
          !paused &&
          effectiveInboxSettings.enableAutoSend &&
          hasRecipient &&
          !blocked &&
          c.risk === "safe" &&
          effectiveInboxSettings.autoSendAllowedCategories.includes(c.label) &&
          !effectiveInboxSettings.neverAutoSendCategories.includes(c.label) &&
          c.confidence * 100 >= effectiveInboxSettings.autoSendMinConfidence &&
          withinBusinessHours(c.receivedMs) &&
          sentCounter < effectiveInboxSettings.dailySendCap &&
          totalSentCounter >= effectiveInboxSettings.requireApprovalForFirstN;

        const shouldGenerate =
          aiEnabled && !paused && !blocked && (effectiveInboxSettings.enableAutoDraft || autoSendEligible);

        const matched = shouldGenerate ? pickSnippets(snippets, `${c.subject} ${c.snippet} ${JSON.stringify(c.threadPeek || [])}`) : [];

        let suggestedBody = "";
        let suggestedSubject = c.subject.toLowerCase().startsWith("re:") ? c.subject : `Re: ${c.subject}`;
        let aiError: string | null = null;
        let aiMeta: Record<string, unknown> | null = null;

        if (shouldGenerate) {
          try {
            const reply = await withTimeout(
              generateEmailReply({
                businessName: safeStr(settings.businessName || "your business", "your business"),
                tone: voiceTone,
                instructionPrompt,
                signature: voiceSignature,
                subject: c.subject,
                from: c.from,
                snippet: c.snippet,
                label: c.label,
                threadPeek: c.threadPeek,
                snippets: matched,
              }),
              AI_TIMEOUT_MS,
              "reply generation"
            );
            suggestedBody = reply.body;
            suggestedSubject = reply.subject;
            aiMeta = reply.meta;
          } catch (err: any) {
            aiError = err?.message || "AI reply generation failed";
          }
        } else if (!aiEnabled) {
          aiError = "AI disabled: missing OPENAI_API_KEY";
        }

        const hasForbidden =
          !!suggestedBody &&
          forbidden.some((phrase) => phrase && suggestedBody.toLowerCase().includes(String(phrase).toLowerCase()));

        const autoSendAllowed = autoSendEligible && !hasForbidden && !aiError;

        // hygiene
        await markRead(gmailClient, c.id);

        const action = blocked ? "skipped_blocked" : "queued_for_review";

        const log = await prisma.emailAILog.create({
          data: {
            orgId: orgId as string, // guaranteed in scope here
            gmailThreadId: c.threadId,
            gmailMsgId: c.id,
            direction: "inbound",
            classification: c.label,
            confidence: c.confidence,
            subject: c.subject,
            snippet: c.snippet,
            action,
            reason: blocked
              ? "blocked"
              : aiError
                ? aiError === "AI disabled: missing OPENAI_API_KEY"
                  ? "ai_disabled_missing_key"
                  : "ai_error"
                : autoSendAllowed
                  ? "auto_send_candidate"
                  : shouldGenerate
                    ? "suggested_internal"
                    : "queued",
            createdAt: new Date(Number.isFinite(c.receivedMs) ? c.receivedMs : Date.now()),
            rawMeta: {
              from: c.from,
              replyTo: c.replyTo,
              emailEpochMs: c.receivedMs,
              threadPeek: c.threadPeek,
              draftId: null,
              idempotencyKey,
              suggested: suggestedBody
                ? { subject: suggestedSubject, body: suggestedBody, model: aiMeta?.model || null, createdAt: Date.now() }
                : null,
              ai: {
                category: c.label,
                priority: c.priority,
                risk: c.risk,
                confidence: c.confidence,
                reasons: c.reasons,
                autoSendEligible: autoSendAllowed,
                blockedByForbidden: hasForbidden,
                usedSnippets: matched.map((s) => s.title),
                error: aiError,
              },
              aiError,
            } as any,
          },
        });

        if (autoSendAllowed && suggestedBody) {
          // fire-and-forget send (best-effort)
          const origin = new URL(req.url).origin;
          await fetch(`${origin}/api/email-ai/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ logId: log.id, subject: suggestedSubject, body: suggestedBody }),
          }).catch(() => {});
          sentCounter += 1;
          totalSentCounter += 1;
        }

        if (suggestedBody) drafted++;
      } catch {
        skipped++;
      }
    });

    // Sync meta
    await prisma.orgSettings.upsert({
      where: { orgId },
      update: {
        data: {
          ...orgSettingsData,
          emailAiSync: {
            ...((orgSettingsData as any).emailAiSync || {}),
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

    return json({
      ok: true,
      scanned,
      drafted,
      skipped,
      draftsImported,
      caps: { MAX_PAGES, MAX_RESULTS_PER_PAGE, MAX_ITEMS_PER_RUN, OPENAI_CONCURRENCY },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[email-ai/poll] error:", message);

    // best-effort status update
    if (orgId) {
      try {
        const existing = await prisma.orgSettings.findUnique({ where: { orgId }, select: { data: true } });
        const prev = ((existing?.data as Record<string, unknown>) || {}) as any;

        await prisma.orgSettings.upsert({
          where: { orgId },
          update: {
            data: {
              ...prev,
              emailAiSync: {
                ...(prev.emailAiSync || {}),
                lastAttemptAt: Date.now(),
                lastErrorAt: Date.now(),
                lastError: message,
              },
            } as any,
          },
          create: {
            orgId,
            data: {
              emailAiSync: {
                lastAttemptAt: Date.now(),
                lastErrorAt: Date.now(),
                lastError: message,
              },
            } as any,
          },
        });
      } catch {
        // ignore
      }
    }

    return json({ ok: false, error: message }, 500);
  }
}

/* ──────────────────────────────────────────────
   Route: GET (info)
────────────────────────────────────────────── */
export async function GET() {
  return json({
    ok: true,
    info: "POST to trigger poll. Options: ?backfill=1 (90d window) and/or ?importDraftsOnly=1 (sync only existing drafts).",
  });
}
