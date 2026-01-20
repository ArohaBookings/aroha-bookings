// app/email-ai/settings/page.tsx
"use client";

import * as React from "react";
import Button from "@/components/ui/Button";

/* ───────────────────────────────────────────────────────────────
   Types
────────────────────────────────────────────────────────────── */

type ModelChoice = "gpt-5-mini" | "gpt-5.1" | "gpt-4.1-mini" | "gpt-4.1";

type KnowledgeBase = {
  overview?: string;        // who you are, what you do
  services?: string;        // key services
  locations?: string;       // suburbs / service areas
  faqs?: string;            // common questions & answers
  alwaysMention?: string;   // things the AI should try to mention
  neverMention?: string;    // things the AI must avoid saying
};

type Settings = {
  enabled: boolean;
  signature: string | null;
  businessName: string;
  businessHoursTz: string;
  businessHoursJson?: any; // {"mon":[540,1020], ...}
  defaultTone: string;
  instructionPrompt: string;
  allowedSendersRegex: string | null;
  blockedSendersRegex: string | null;
  minConfidenceToSend: number;
  autoSendAboveConfidence?: boolean;
  model?: ModelChoice;
  autoReplyRulesJson?: any[]; // templates + rules bundle
  humanEscalationTags?: string[];  // e.g. ["urgent","quote"]
  logRetentionDays?: number;
  knowledgeBaseJson?: KnowledgeBase;
};

type InboxSettings = {
  enableAutoDraft: boolean;
  enableAutoSend: boolean;
  autoSendAllowedCategories: string[];
  autoSendMinConfidence: number;
  neverAutoSendCategories: string[];
  businessHoursOnly: boolean;
  dailySendCap: number;
  requireApprovalForFirstN: number;
  automationPaused: boolean;
};

type VoiceSettings = {
  tone: string;
  signature: string;
  emojiLevel: 0 | 1 | 2;
  forbiddenPhrases: string;
  lengthPreference: "short" | "medium" | "long";
};

type Rule = {
  id: string;
  enabled: boolean;
  name: string;
  when: {
    fromIncludes?: string;
    subjectIncludes?: string;
    bodyIncludes?: string;
    senderRegex?: string;
  };
  then: {
    action: "auto_draft" | "queue" | "skip" | "forward";
    templateKey?: string;
    forwardTo?: string;
    addTags?: string[];
  };
};

type Template = {
  key: string;          // unique key
  name: string;         // display
  subject?: string;     // optional override
  body: string;         // supports {{placeholders}}
};

type Snippet = {
  id: string;
  title: string;
  body: string;
  keywords: string[];
};

/** Internal bundle type we persist into autoReplyRulesJson */
type TemplateBundleItem =
  | (Template & { __type: "template" })
  | (Rule & { __type?: undefined });

const DEFAULT_MODEL: ModelChoice = "gpt-5-mini";

/* ───────────────────────────────────────────────────────────────
   Defaults & starter data
────────────────────────────────────────────────────────────── */

const DEFAULTS: Settings = {
  enabled: false,
  signature: "",
  businessName: "Your business",
  businessHoursTz: "Pacific/Auckland",
  businessHoursJson: {},
  defaultTone: "friendly, concise, local",
  instructionPrompt: "",
  allowedSendersRegex: null,
  blockedSendersRegex: null,
  minConfidenceToSend: 0.65,
  autoSendAboveConfidence: false,
  model: DEFAULT_MODEL,
  autoReplyRulesJson: [],
  humanEscalationTags: [],
  logRetentionDays: 30,
  knowledgeBaseJson: {
    overview: "",
    services: "",
    locations: "",
    faqs: "",
    alwaysMention: "",
    neverMention: "",
  },
};

const DEFAULT_INBOX_SETTINGS: InboxSettings = {
  enableAutoDraft: true,
  enableAutoSend: false,
  autoSendAllowedCategories: [
    "booking_request",
    "reschedule",
    "cancellation",
    "pricing",
    "faq",
    "admin",
  ],
  autoSendMinConfidence: 92,
  neverAutoSendCategories: ["complaint", "spam"],
  businessHoursOnly: true,
  dailySendCap: 40,
  requireApprovalForFirstN: 20,
  automationPaused: false,
};

const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  tone: "friendly, concise, local",
  signature: "",
  emojiLevel: 0,
  forbiddenPhrases: "",
  lengthPreference: "medium",
};

/* Starter templates (stored back into settings.autoReplyRulesJson) */
const STARTER_TEMPLATES: Template[] = [
  {
    key: "lead-intake",
    name: "Lead intake",
    subject: "Thanks for contacting {{business.name}}",
    body: `Hi {{customer.firstName || "there"}},

Thanks for reaching out to {{business.name}}. To help us get you sorted, please reply with:
• Your full name
• Address (including suburb)
• Best phone number
• A short description of the work
• Any photos or plans (if you have them)

Once we have these, we’ll get back to you with next steps or book a free quote visit.

Cheers,
{{business.name}}
{{signature}}`,
  },
  {
    key: "generic-ack",
    name: "Generic acknowledgement",
    body: `Hi {{customer.firstName || "there"}},

Thanks for your email — we’ve received it and will get back to you shortly.

{{signature}}`,
  },
];

const TONE_PRESETS = [
  {
    label: "Warm + local",
    tone: "warm, friendly, local, concise",
    instruction: "Keep replies short, warm, and very clear. Avoid jargon.",
  },
  {
    label: "Professional",
    tone: "professional, concise, confident",
    instruction: "Use a professional tone with clear next steps.",
  },
  {
    label: "Medical calm",
    tone: "calm, reassuring, professional",
    instruction: "Use calm, reassuring language. Avoid overpromising.",
  },
  {
    label: "Trades direct",
    tone: "direct, practical, no-nonsense",
    instruction: "Be direct and practical. Ask for address and job details.",
  },
  {
    label: "Legal formal",
    tone: "formal, precise, respectful",
    instruction: "Use formal language and request relevant documents.",
  },
] as const;

const INBOX_PRESETS: Array<{ label: string; settings: Partial<InboxSettings> }> = [
  {
    label: "Conservative",
    settings: {
      enableAutoDraft: true,
      enableAutoSend: false,
      autoSendMinConfidence: 96,
      businessHoursOnly: true,
      dailySendCap: 20,
      requireApprovalForFirstN: 30,
    },
  },
  {
    label: "Balanced",
    settings: {
      enableAutoDraft: true,
      enableAutoSend: true,
      autoSendMinConfidence: 92,
      businessHoursOnly: true,
      dailySendCap: 40,
      requireApprovalForFirstN: 20,
    },
  },
  {
    label: "Aggressive",
    settings: {
      enableAutoDraft: true,
      enableAutoSend: true,
      autoSendMinConfidence: 88,
      businessHoursOnly: false,
      dailySendCap: 80,
      requireApprovalForFirstN: 10,
    },
  },
];

const CATEGORY_OPTIONS = [
  { key: "booking_request", label: "Booking request" },
  { key: "reschedule", label: "Reschedule" },
  { key: "cancellation", label: "Cancellation" },
  { key: "pricing", label: "Pricing" },
  { key: "complaint", label: "Complaint" },
  { key: "faq", label: "FAQ" },
  { key: "admin", label: "Admin" },
  { key: "spam", label: "Spam" },
  { key: "other", label: "Other" },
] as const;

/* ───────────────────────────────────────────────────────────────
   Small UI helpers
────────────────────────────────────────────────────────────── */

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

function Alert({
  kind,
  children,
}: {
  kind: "info" | "warn" | "error" | "success";
  children: React.ReactNode;
}) {
  const cls =
    kind === "error"
      ? "bg-red-50 text-red-800 border-red-200"
      : kind === "warn"
      ? "bg-yellow-50 text-yellow-900 border-yellow-200"
      : kind === "success"
      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
      : "bg-blue-50 text-blue-800 border-blue-200";
  return (
    <div className={`border rounded px-3 py-2 text-sm ${cls}`}>
      {children}
    </div>
  );
}

/* Simple toast */
function useToast() {
  const [msg, setMsg] = React.useState<string | null>(null);
  const [kind, setKind] = React.useState<"info" | "success" | "error">("info");
  const show = (m: string, k: "info" | "success" | "error" = "info") => {
    setKind(k);
    setMsg(m);
    setTimeout(() => setMsg(null), 2400);
  };
  const node =
    msg && (
      <div className="fixed bottom-4 right-4 z-50">
        <div
          className={cx(
            "shadow-lg rounded px-3 py-2 text-sm",
            kind === "success" && "bg-emerald-600 text-white",
            kind === "error" && "bg-red-600 text-white",
            kind === "info" && "bg-zinc-900 text-white"
          )}
        >
          {msg}
        </div>
      </div>
    );
  return { show, node };
}

/* Regex normalizer/validator: accepts "/foo/i" or "foo" or empty → null */
function normalizeRegexInput(v: string | null | undefined): string | null {
  if (!v) return null;
  const trimmed = String(v).trim();
  if (!trimmed) return null;
  const m = /^\/(.+)\/([a-z]*)$/.exec(trimmed);
  try {
    // eslint-disable-next-line no-new
    new RegExp(m ? m[1] : trimmed, m ? m[2] : "i");
    return trimmed;
  } catch {
    return "__INVALID__";
  }
}

/** Parse humanEscalationTags from comma-separated string */
function parseTags(input: string): string[] {
  return input
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

/** Serialise escalation tags back to comma string */
function tagsToString(tags: string[] | undefined | null): string {
  if (!tags || !tags.length) return "";
  return Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean))).join(", ");
}

/* ───────────────────────────────────────────────────────────────
   Main page component
────────────────────────────────────────────────────────────── */

export default function EmailAISettingsPage() {
  const [tab, setTab] = React.useState<
    "general" | "rules" | "templates" | "knowledge" | "testing" | "advanced"
  >("general");

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [s, setS] = React.useState<Settings>(DEFAULTS);
  const [inboxSettings, setInboxSettings] = React.useState<InboxSettings>(
    DEFAULT_INBOX_SETTINGS
  );
  const [savingInbox, setSavingInbox] = React.useState(false);
  const [inboxDirty, setInboxDirty] = React.useState(false);
  const [inboxError, setInboxError] = React.useState<string | null>(null);
  const [voiceSettings, setVoiceSettings] = React.useState<VoiceSettings>(
    DEFAULT_VOICE_SETTINGS
  );
  const [voiceDirty, setVoiceDirty] = React.useState(false);
  const [snippets, setSnippets] = React.useState<Snippet[]>([]);
  const [snippetsDirty, setSnippetsDirty] = React.useState(false);
  const [savingSnippets, setSavingSnippets] = React.useState(false);
  const [savingVoice, setSavingVoice] = React.useState(false);

  // server flags
  const [gmailConnected, setGmailConnected] = React.useState<boolean>(true);
  const [orgId, setOrgId] = React.useState<string | null>(null);

  // in-page collections (not separate tables; we’ll store under settings JSON)
  const [templates, setTemplates] = React.useState<Template[]>(STARTER_TEMPLATES);
  const [rules, setRules] = React.useState<Rule[]>([]);

  // testing state
  const [testInput, setTestInput] = React.useState<string>("");
  const [testOut, setTestOut] = React.useState<{
    intent?: string;
    confidence?: number;
    reply?: string;
  } | null>(null);

  // regex test widgets
  const [reTest, setReTest] = React.useState({
    sample: "",
    allowOk: null as null | boolean,
    blockHit: null as null | boolean,
  });

  // privacy flags (only affect system prompt text)
  const [privacyStripPhones, setPrivacyStripPhones] = React.useState(true);
  const [privacyNoPrices, setPrivacyNoPrices] = React.useState(true);

  // human escalation tags (string input mirror)
  const [escalationTagInput, setEscalationTagInput] = React.useState("");

  const toast = useToast();

  /* Load settings on mount */
  React.useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      setError(null);
      setInboxError(null);
      try {
        await fetch("/api/email-ai/token", { cache: "no-store" }).catch(() => {});
        const res = await fetch("/api/email-ai/settings", { cache: "no-store" });
        const j = await res.json();
        if (!res.ok || !j?.ok) throw new Error(j?.error || `Load failed (${res.status})`);

        const incoming: Settings = {
          ...DEFAULTS,
          ...(j.settings ?? {}),
        };

        if (!incoming.model) incoming.model = DEFAULT_MODEL;
        if (!Array.isArray(incoming.humanEscalationTags)) incoming.humanEscalationTags = [];
        if (!incoming.knowledgeBaseJson) {
          incoming.knowledgeBaseJson = { ...DEFAULTS.knowledgeBaseJson };
        }

        // read connection flags from API
        setGmailConnected(Boolean(j.gmailConnected));
        setOrgId(typeof j.orgId === "string" ? j.orgId : null);

        const inboxRes = await fetch("/api/email-ai/inbox-settings", { cache: "no-store" });
        const inboxJson = await inboxRes.json().catch(() => ({}));
        if (inboxRes.ok && inboxJson?.settings) {
          setInboxSettings({
            ...DEFAULT_INBOX_SETTINGS,
            ...(inboxJson.settings as InboxSettings),
          });
          setInboxDirty(false);
        }

        const voiceRes = await fetch("/api/email-ai/voice-settings", { cache: "no-store" });
        const voiceJson = await voiceRes.json().catch(() => ({}));
        if (voiceRes.ok && voiceJson?.settings) {
          const taboo = Array.isArray(voiceJson.settings.tabooPhrases)
            ? voiceJson.settings.tabooPhrases
            : [];
          const forbidden = Array.isArray(voiceJson.settings.forbiddenPhrases)
            ? voiceJson.settings.forbiddenPhrases
            : [];
          setVoiceSettings({
            ...DEFAULT_VOICE_SETTINGS,
            tone: voiceJson.settings.tone || DEFAULT_VOICE_SETTINGS.tone,
            signature: voiceJson.settings.signature || "",
            emojiLevel:
              voiceJson.settings.emojiLevel === 1 || voiceJson.settings.emojiLevel === 2
                ? voiceJson.settings.emojiLevel
                : DEFAULT_VOICE_SETTINGS.emojiLevel,
            forbiddenPhrases: [...taboo, ...forbidden].join("\n"),
            lengthPreference: voiceJson.settings.lengthPreference || "medium",
          });
          setVoiceDirty(false);
        }

        const snippetsRes = await fetch("/api/email-ai/snippets", { cache: "no-store" });
        const snippetsJson = await snippetsRes.json().catch(() => ({}));
        if (snippetsRes.ok && Array.isArray(snippetsJson?.snippets)) {
          setSnippets(snippetsJson.snippets as Snippet[]);
          setSnippetsDirty(false);
        }



const embeddedRaw: any[] = Array.isArray(incoming.autoReplyRulesJson)
  ? (incoming.autoReplyRulesJson as any[])
  : [];

const tFromBundle: Template[] = embeddedRaw
  .filter((r) => r?.__type === "template")
  .map((t) => ({
    key: t.key as string,
    name: t.name as string,
    subject: t.subject as string | undefined,
    body: t.body as string,
  }));

const rOnly: Rule[] = embeddedRaw
  .filter((r) => !r?.__type)
  .map((r) => ({
    id: r.id as string,
    enabled: Boolean(r.enabled),
    name: r.name as string,
    when: (r.when as Rule["when"]) || {},
    then: (r.then as Rule["then"]) || { action: "auto_draft" },
  }));

        if (!cancel) {
          setS(incoming);
          setTemplates(tFromBundle.length ? tFromBundle : STARTER_TEMPLATES);
          setRules(rOnly);
          setEscalationTagInput(tagsToString(incoming.humanEscalationTags));
          setDirty(false);
        }
      } catch (e: any) {
        if (!cancel) setError(e?.message || "Failed to load settings");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  /* Autosave (debounced) */
  const queued = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!dirty) return;
    if (queued.current) window.clearTimeout(queued.current);
    queued.current = window.setTimeout(() => {
      void onSave("autosave");
    }, 1200);
    return () => {
      if (queued.current) window.clearTimeout(queued.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, templates, rules, dirty]);

  function patch<K extends keyof Settings>(key: K, value: Settings[K]) {
    setS((prev) => {
      const next = { ...prev, [key]: value };
      setDirty(true);
      return next;
    });
  }

  function patchInbox<K extends keyof InboxSettings>(key: K, value: InboxSettings[K]) {
    setInboxSettings((prev) => {
      const next = { ...prev, [key]: value };
      setInboxDirty(true);
      return next;
    });
  }

  function validate(): string | null {
    if (!s.businessName.trim()) return "Business name is required.";
    if (!s.defaultTone.trim()) return "Default tone is required.";
    if (isNaN(s.minConfidenceToSend) || s.minConfidenceToSend < 0 || s.minConfidenceToSend > 1)
      return "Min confidence must be between 0 and 1.";

    const normAllow = normalizeRegexInput(s.allowedSendersRegex);
    if (normAllow === "__INVALID__")
      return "Allowed-senders regex is invalid. Use e.g. ^.+@customer\\.com$ or /@customer\\.com$/i";

    const normBlock = normalizeRegexInput(s.blockedSendersRegex);
    if (normBlock === "__INVALID__")
      return "Blocked-senders regex is invalid. Use e.g. (noreply|newsletter) or /(noreply|newsletter)/i";

    if (s.enabled && !gmailConnected) {
      return "Connect Gmail before enabling Email AI.";
    }
    return null;
  }

  /** Build the bundle we persist into autoReplyRulesJson */
  function buildBundle(): TemplateBundleItem[] {
    const templateBundled: TemplateBundleItem[] = templates.map((t) => ({
      __type: "template",
      ...t,
    }));
    const rulesBundled: TemplateBundleItem[] = rules.map((r) => ({
      ...r,
    }));
    return [...templateBundled, ...rulesBundled];
  }

  async function onSave(source: "manual" | "autosave" = "manual") {
    const v = validate();
    if (v) {
      if (source === "manual") toast.show(v, "error");
      return;
    }
    setSaving(true);
    try {
      const bundle = buildBundle();

      const normAllow = normalizeRegexInput(s.allowedSendersRegex);
      const normBlock = normalizeRegexInput(s.blockedSendersRegex);

      const safeSettings: Settings = {
        ...s,
        allowedSendersRegex: normAllow && normAllow !== "__INVALID__" ? normAllow : null,
        blockedSendersRegex: normBlock && normBlock !== "__INVALID__" ? normBlock : null,
        model: s.model || DEFAULT_MODEL,
        humanEscalationTags: parseTags(escalationTagInput),
        autoReplyRulesJson: bundle,
        knowledgeBaseJson: s.knowledgeBaseJson || { ...DEFAULTS.knowledgeBaseJson },
        logRetentionDays:
          typeof s.logRetentionDays === "number" && s.logRetentionDays > 0
            ? s.logRetentionDays
            : 30,
      };

      const res = await fetch("/api/email-ai/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(safeSettings),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) {
        const msg = j?.error || (j?.issues ? "Validation failed" : `Save failed (${res.status})`);
        throw new Error(msg);
      }

      const merged: Settings = { ...safeSettings, ...(j.settings ?? {}) };
      if (!merged.model) merged.model = DEFAULT_MODEL;
      if (!Array.isArray(merged.humanEscalationTags)) merged.humanEscalationTags = [];
      if (!merged.knowledgeBaseJson) merged.knowledgeBaseJson = { ...DEFAULTS.knowledgeBaseJson };

      setS(merged);
      setGmailConnected(Boolean(j.gmailConnected));
      setDirty(false);
      if (source === "manual") toast.show("Settings saved.", "success");
    } catch (e: any) {
      toast.show(e?.message || "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  async function onSaveInbox() {
    setSavingInbox(true);
    try {
      const res = await fetch("/api/email-ai/inbox-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inboxSettings),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) {
        throw new Error(j?.error || `Save failed (${res.status})`);
      }
      setInboxSettings({ ...DEFAULT_INBOX_SETTINGS, ...(j.settings as InboxSettings) });
      setInboxDirty(false);
      toast.show("Inbox automation settings saved.", "success");
    } catch (e: any) {
      setInboxError(e?.message || "Save failed");
      toast.show(e?.message || "Save failed", "error");
    } finally {
      setSavingInbox(false);
    }
  }

  async function onSaveVoice() {
    setSavingVoice(true);
    try {
      const payload = {
        tone: voiceSettings.tone,
        signature: voiceSettings.signature,
        emojiLevel: voiceSettings.emojiLevel,
        forbiddenPhrases: voiceSettings.forbiddenPhrases
          .split("\n")
          .map((t) => t.trim())
          .filter(Boolean),
        lengthPreference: voiceSettings.lengthPreference,
      };
      const res = await fetch("/api/email-ai/voice-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Save failed");
      setVoiceSettings({
        ...DEFAULT_VOICE_SETTINGS,
        tone: j.settings?.tone || DEFAULT_VOICE_SETTINGS.tone,
        signature: j.settings?.signature || "",
        emojiLevel:
          j.settings?.emojiLevel === 1 || j.settings?.emojiLevel === 2
            ? j.settings.emojiLevel
            : DEFAULT_VOICE_SETTINGS.emojiLevel,
        forbiddenPhrases: Array.isArray(j.settings?.forbiddenPhrases)
          ? j.settings.forbiddenPhrases.join("\n")
          : "",
        lengthPreference: j.settings?.lengthPreference || "medium",
      });
      setVoiceDirty(false);
      toast.show("Brand voice saved.", "success");
    } catch (e: any) {
      toast.show(e?.message || "Save failed", "error");
    } finally {
      setSavingVoice(false);
    }
  }

  async function onSaveSnippets() {
    setSavingSnippets(true);
    try {
      const res = await fetch("/api/email-ai/snippets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snippets }),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Save failed");
      setSnippets(Array.isArray(j.snippets) ? j.snippets : snippets);
      setSnippetsDirty(false);
      toast.show("Snippets saved.", "success");
    } catch (e: any) {
      toast.show(e?.message || "Save failed", "error");
    } finally {
      setSavingSnippets(false);
    }
  }

  /* Sandbox tester */
  async function runTest() {
    try {
      const res = await fetch("/api/email-ai/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: "(Test) New enquiry",
          snippet: testInput,
          model: s.model || DEFAULT_MODEL,
          minConfidenceToSend: s.minConfidenceToSend,
          autoSendAboveConfidence: !!s.autoSendAboveConfidence,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Test failed (${res.status})`);
      setTestOut({ intent: j.intent, confidence: j.confidence, reply: j.reply });
      toast.show("Test generated (included in your plan).", "success");
    } catch (e: any) {
      toast.show(e?.message || "Test failed", "error");
    }
  }

  /* Regex test */
  function onRegexTest() {
    let allowOk: boolean | null = null;
    let blockHit: boolean | null = null;
    try {
      if (s.allowedSendersRegex) allowOk = new RegExp(s.allowedSendersRegex, "i").test(reTest.sample);
    } catch {
      allowOk = null;
    }
    try {
      if (s.blockedSendersRegex) blockHit = new RegExp(s.blockedSendersRegex, "i").test(reTest.sample);
    } catch {
      blockHit = null;
    }
    setReTest((p) => ({ ...p, allowOk, blockHit }));
  }

  /* Rules & templates CRUD (client-side only; persisted inside settings JSON) */
  function addTemplate() {
    const idx = templates.length + 1;
    const t: Template = {
      key: `custom-${idx}-${Date.now()}`,
      name: `Custom template ${idx}`,
      body: "Hi {{customer.firstName}},\n\n…",
    };
    setTemplates((arr) => [...arr, t]);
    setDirty(true);
  }

  function updateTemplate(key: string, patchT: Partial<Template>) {
    setTemplates((arr) => arr.map((t) => (t.key === key ? { ...t, ...patchT } : t)));
    setDirty(true);
  }

  function removeTemplate(key: string) {
    setTemplates((arr) => arr.filter((t) => t.key !== key));
    setDirty(true);
  }

  function addRule() {
    const r: Rule = {
      id: crypto.randomUUID(),
      enabled: true,
      name: "New rule",
      when: {},
      then: { action: "auto_draft", templateKey: templates[0]?.key },
    };
    setRules((arr) => [r, ...arr]);
    setDirty(true);
  }

  function updateRule(id: string, patchR: Partial<Rule>) {
    setRules((arr) =>
      arr.map((r) =>
        r.id === id
          ? {
              ...r,
              ...patchR,
              when: { ...r.when, ...(patchR.when || {}) },
              then: { ...r.then, ...(patchR.then || {}) },
            }
          : r
      )
    );
    setDirty(true);
  }

  function removeRule(id: string) {
    setRules((arr) => arr.filter((r) => r.id !== id));
    setDirty(true);
  }

  function ruleHasValidTemplate(r: Rule): boolean {
    if (r.then.action === "forward") return true;
    if (!r.then.templateKey) return false;
    return templates.some((t) => t.key === r.then.templateKey);
  }

  /* System prompt preview (what we actually send to the model) */
  const systemPreview = React.useMemo(() => {
    const privacyLines = [
      privacyStripPhones ? "• Remove phone numbers before analysis." : "",
      privacyNoPrices ? "• Never confirm or invent specific prices." : "",
    ]
      .filter(Boolean)
      .join("\n");

    const tagsLine =
      s.humanEscalationTags && s.humanEscalationTags.length
        ? `Escalation tags (force human review when present): ${s.humanEscalationTags.join(", ")}`
        : "";

    const modelLine = `Model: ${s.model || DEFAULT_MODEL}.`;

    const kb = s.knowledgeBaseJson || {};
    const kbLines = [
      kb.overview && `Overview: ${kb.overview}`,
      kb.services && `Services: ${kb.services}`,
      kb.locations && `Areas: ${kb.locations}`,
      kb.faqs && `FAQs / notes:\n${kb.faqs}`,
      kb.alwaysMention && `Always mention: ${kb.alwaysMention}`,
      kb.neverMention && `Never mention: ${kb.neverMention}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    return `You are an email assistant for ${s.businessName}.
${modelLine}
Tone: ${s.defaultTone}.
Owner instructions:
${(s.instructionPrompt || "").trim() || "(none provided)"}
${kbLines ? `\nBusiness knowledge:\n${kbLines}\n` : ""}
${privacyLines ? `Safety:\n${privacyLines}` : ""}
${tagsLine ? `Human escalation:\n${tagsLine}` : ""}
Include signature if set. Do not invent facts.`;
  }, [
    s.businessName,
    s.defaultTone,
    s.instructionPrompt,
    s.humanEscalationTags,
    s.model,
    s.knowledgeBaseJson,
    privacyStripPhones,
    privacyNoPrices,
  ]);

  if (loading) return <div className="p-6">Loading…</div>;

  /* ──────────────────────────────────────────────────────────── */
  return (
    <div className="p-6 max-w-6xl">
      {toast.node}

      {/* Gmail connect banner */}
      {!gmailConnected && (
        <Alert kind="warn">
          Gmail isn’t connected.{" "}
          <a className="underline" href="/email-ai/connect">
            Connect Gmail
          </a>{" "}
          to enable Email AI.
        </Alert>
      )}

      <div className="mb-4 mt-2 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Email AI — Settings</h1>
        <div className="flex items-center gap-2">
          <label
            className={cx(
              "flex items-center gap-2 mr-3",
              !gmailConnected && "opacity-60 cursor-not-allowed"
            )}
            title={!gmailConnected ? "Connect Gmail to enable" : undefined}
          >
            <input
              type="checkbox"
              checked={!!s.enabled}
              onChange={(e) => patch("enabled", e.target.checked)}
              disabled={!gmailConnected}
            />
            <span>Enable Email AI</span>
          </label>
          <Button variant="secondary" onClick={() => (window.location.href = "/email-ai")}>
            Go back
          </Button>
          <Button
            variant="secondary"
            disabled={!gmailConnected || !orgId}
            onClick={async () => {
              if (!orgId) return;
              const res = await fetch("/api/org/integrations/gmail/disconnect", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ orgId }),
              });
              const j = await res.json().catch(() => ({}));
              if (!res.ok || !j?.ok) {
                toast.show(j?.error || "Failed to disconnect Gmail.", "error");
                return;
              }
              setGmailConnected(false);
              toast.show("Gmail disconnected.", "success");
            }}
          >
            Disconnect Gmail
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setS(DEFAULTS);
              setTemplates(STARTER_TEMPLATES);
              setRules([]);
              setEscalationTagInput("");
              setDirty(true);
              toast.show("Reset to defaults. Click Save to persist.", "info");
            }}
          >
            Reset
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              navigator.clipboard
                .writeText(systemPreview)
                .then(() => toast.show("System prompt copied.", "success"))
            }
          >
            Copy system prompt
          </Button>
          <Button
            variant={dirty ? "primary" : "secondary"}
            onClick={() => onSave("manual")}
            disabled={saving || !dirty}
            title={dirty ? "Save changes" : "No changes"}
          >
            {saving ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {(dirty || inboxDirty || voiceDirty || snippetsDirty) && (
        <Alert kind="warn">
          You have unsaved changes. Email AI settings autosave; inbox automation uses the Save button.
        </Alert>
      )}

      {/* Tabs */}
      <div className="border-b mb-4 flex gap-1">
        {[
          ["general", "General"],
          ["rules", "Rules"],
          ["templates", "Templates"],
          ["knowledge", "Knowledge base"],
          ["testing", "Testing & Logs"],
          ["advanced", "Advanced"],
        ].map(([key, label]) => (
          <Button
            key={key}
            variant="ghost"
            className={cx(
              "rounded-none px-3 py-2 text-sm -mb-px border-b-2",
              tab === key
                ? "border-zinc-900 text-zinc-900"
                : "border-transparent text-zinc-500 hover:text-zinc-800"
            )}
            onClick={() => setTab(key as any)}
          >
            {label}
          </Button>
        ))}
      </div>

      {/* GENERAL */}
      {tab === "general" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="space-y-4">
            <label className="block">
              <div className="text-sm text-zinc-600">Business name</div>
              <input
                className="mt-1 w-full border rounded px-3 py-2"
                value={s.businessName}
                onChange={(e) => patch("businessName", e.target.value)}
              />
            </label>

            <label className="block">
              <div className="text-sm text-zinc-600">Signature (optional)</div>
              <textarea
                className="mt-1 w-full border rounded px-3 py-2"
                rows={4}
                value={s.signature ?? ""}
                onChange={(e) => patch("signature", e.target.value)}
                placeholder={"—\nYour Business\nAddress\nPhone / Email"}
              />
            </label>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block">
                <div className="text-sm text-zinc-600">Default tone</div>
                <input
                  className="mt-1 w-full border rounded px-3 py-2"
                  value={s.defaultTone}
                  onChange={(e) => patch("defaultTone", e.target.value)}
                  placeholder="friendly, concise, local"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {TONE_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => {
                        patch("defaultTone", p.tone);
                        patch("instructionPrompt", p.instruction);
                      }}
                      className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </label>
              <label className="block">
                <div className="text-sm text-zinc-600">Timezone</div>
                <input
                  className="mt-1 w-full border rounded px-3 py-2"
                  value={s.businessHoursTz}
                  onChange={(e) => patch("businessHoursTz", e.target.value)}
                  placeholder="Pacific/Auckland"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block">
                <div className="text-sm text-zinc-600">Model</div>
                <select
                  className="mt-1 w-full border rounded px-3 py-2 text-sm"
                  value={s.model || DEFAULT_MODEL}
                  onChange={(e) => patch("model", e.target.value as ModelChoice)}
                >
                  <option value="gpt-5-mini">GPT-5 Mini (fast, cheap)</option>
                  <option value="gpt-5.1">GPT-5.1 (smarter)</option>
                  <option value="gpt-4.1-mini">GPT-4.1 Mini</option>
                  <option value="gpt-4.1">GPT-4.1 (quality)</option>
                </select>
              </label>

              <label className="block">
                <div className="flex items-center justify-between text-sm text-zinc-600">
                  <span>Auto-send above confidence</span>
                  <span className="text-xs text-zinc-500">
                    {(s.minConfidenceToSend * 100).toFixed(0)}%+
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!!s.autoSendAboveConfidence}
                    onChange={(e) => patch("autoSendAboveConfidence", e.target.checked)}
                  />
                  <span className="text-xs text-zinc-600">
                    If confidence ≥ threshold, allow backend to auto-send.
                  </span>
                </div>
              </label>
            </div>

            {/* Confidence slider */}
            <label className="block">
              <div className="flex items-center justify-between">
                <div className="text-sm text-zinc-600">Min confidence to auto-draft</div>
                <div className="text-xs text-zinc-500">
                  {s.minConfidenceToSend.toFixed(2)} (0=cautious, 1=full auto)
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={s.minConfidenceToSend}
                onChange={(e) => patch("minConfidenceToSend", Number(e.target.value))}
                className="w-full"
              />
            </label>

            <div className="rounded border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Autonomous Inbox</div>
                  <div className="text-xs text-zinc-500">
                    Safe-by-default controls for auto-drafts and auto-send.
                  </div>
                </div>
                <Button
                  variant={inboxDirty ? "primary" : "secondary"}
                  onClick={onSaveInbox}
                  disabled={savingInbox || !inboxDirty}
                >
                  {savingInbox ? "Saving…" : "Save inbox settings"}
                </Button>
              </div>

              {inboxError && <div className="text-xs text-rose-600">{inboxError}</div>}

              <div className="flex flex-wrap gap-2">
                {INBOX_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
                    onClick={() => {
                      setInboxSettings((prev) => ({ ...prev, ...preset.settings }));
                      setInboxDirty(true);
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={inboxSettings.automationPaused}
                    onChange={(e) => patchInbox("automationPaused", e.target.checked)}
                  />
                  Pause all automations
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={inboxSettings.enableAutoDraft}
                    onChange={(e) => patchInbox("enableAutoDraft", e.target.checked)}
                  />
                  Enable auto-drafts
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={inboxSettings.enableAutoSend}
                    onChange={(e) => patchInbox("enableAutoSend", e.target.checked)}
                  />
                  Enable auto-send (safe categories only)
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label className="block text-sm">
                  <div className="text-xs text-zinc-500">Min confidence (%)</div>
                  <input
                    type="number"
                    min={50}
                    max={100}
                    value={inboxSettings.autoSendMinConfidence}
                    onChange={(e) => patchInbox("autoSendMinConfidence", Number(e.target.value))}
                    className="mt-1 w-full border rounded px-3 py-2"
                  />
                </label>
                <label className="block text-sm">
                  <div className="text-xs text-zinc-500">Daily send cap</div>
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    value={inboxSettings.dailySendCap}
                    onChange={(e) => patchInbox("dailySendCap", Number(e.target.value))}
                    className="mt-1 w-full border rounded px-3 py-2"
                  />
                </label>
                <label className="block text-sm">
                  <div className="text-xs text-zinc-500">Require approval for first N</div>
                  <input
                    type="number"
                    min={0}
                    max={500}
                    value={inboxSettings.requireApprovalForFirstN}
                    onChange={(e) => patchInbox("requireApprovalForFirstN", Number(e.target.value))}
                    className="mt-1 w-full border rounded px-3 py-2"
                  />
                </label>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={inboxSettings.businessHoursOnly}
                  onChange={(e) => patchInbox("businessHoursOnly", e.target.checked)}
                />
                Auto-send only during business hours
              </label>

              <div>
                <div className="text-xs text-zinc-500 mb-2">Auto-send allowed categories</div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {CATEGORY_OPTIONS.map((cat) => {
                    const checked = inboxSettings.autoSendAllowedCategories.includes(cat.key);
                    return (
                      <label key={cat.key} className="flex items-center gap-2 text-xs text-zinc-600">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...inboxSettings.autoSendAllowedCategories, cat.key]
                              : inboxSettings.autoSendAllowedCategories.filter((c) => c !== cat.key);
                            patchInbox("autoSendAllowedCategories", next);
                          }}
                        />
                        {cat.label}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="text-xs text-zinc-500 mb-2">Never auto-send categories</div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {CATEGORY_OPTIONS.map((cat) => {
                    const checked = inboxSettings.neverAutoSendCategories.includes(cat.key);
                    return (
                      <label key={`never-${cat.key}`} className="flex items-center gap-2 text-xs text-zinc-600">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...inboxSettings.neverAutoSendCategories, cat.key]
                              : inboxSettings.neverAutoSendCategories.filter((c) => c !== cat.key);
                            patchInbox("neverAutoSendCategories", next);
                          }}
                        />
                        {cat.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="rounded border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Brand voice</div>
                  <div className="text-xs text-zinc-500">
                    Applies to all AI-written drafts and automations.
                  </div>
                </div>
                <Button
                  variant={voiceDirty ? "primary" : "secondary"}
                  onClick={onSaveVoice}
                  disabled={savingVoice || !voiceDirty}
                >
                  {savingVoice ? "Saving…" : "Save brand voice"}
                </Button>
              </div>

              <label className="block text-sm">
                <div className="text-xs text-zinc-500">Tone</div>
                <input
                  className="mt-1 w-full border rounded px-3 py-2"
                  value={voiceSettings.tone}
                  onChange={(e) => {
                    setVoiceSettings((prev) => ({ ...prev, tone: e.target.value }));
                    setVoiceDirty(true);
                  }}
                />
              </label>

              <label className="block text-sm">
                <div className="text-xs text-zinc-500">Signature block</div>
                <textarea
                  className="mt-1 w-full border rounded px-3 py-2 min-h-[80px]"
                  value={voiceSettings.signature}
                  onChange={(e) => {
                    setVoiceSettings((prev) => ({ ...prev, signature: e.target.value }));
                    setVoiceDirty(true);
                  }}
                />
              </label>

              <label className="block text-sm">
                <div className="text-xs text-zinc-500">Forbidden phrases (one per line)</div>
                <textarea
                  className="mt-1 w-full border rounded px-3 py-2 min-h-[80px]"
                  value={voiceSettings.forbiddenPhrases}
                  onChange={(e) => {
                    setVoiceSettings((prev) => ({ ...prev, forbiddenPhrases: e.target.value }));
                    setVoiceDirty(true);
                  }}
                />
              </label>

              <label className="block text-sm">
                <div className="text-xs text-zinc-500">Emoji level</div>
                <select
                  className="mt-1 w-full border rounded px-3 py-2"
                  value={voiceSettings.emojiLevel}
                  onChange={(e) => {
                    setVoiceSettings((prev) => ({
                      ...prev,
                      emojiLevel: Number(e.target.value) as VoiceSettings["emojiLevel"],
                    }));
                    setVoiceDirty(true);
                  }}
                >
                  <option value={0}>None</option>
                  <option value={1}>Light</option>
                  <option value={2}>Playful</option>
                </select>
              </label>

              <label className="block text-sm">
                <div className="text-xs text-zinc-500">Reply length</div>
                <select
                  className="mt-1 w-full border rounded px-3 py-2"
                  value={voiceSettings.lengthPreference}
                  onChange={(e) => {
                    setVoiceSettings((prev) => ({
                      ...prev,
                      lengthPreference: e.target.value as VoiceSettings["lengthPreference"],
                    }));
                    setVoiceDirty(true);
                  }}
                >
                  <option value="short">Short</option>
                  <option value="medium">Medium</option>
                  <option value="long">Long</option>
                </select>
              </label>
            </div>

            <div className="rounded border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Smart snippets</div>
                  <div className="text-xs text-zinc-500">
                    Approved responses the AI can use verbatim when keywords match.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant={snippetsDirty ? "primary" : "secondary"}
                    onClick={onSaveSnippets}
                    disabled={savingSnippets || !snippetsDirty}
                  >
                    {savingSnippets ? "Saving…" : "Save snippets"}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSnippets((prev) => [
                        ...prev,
                        {
                          id: `snippet_${Math.random().toString(36).slice(2, 8)}`,
                          title: "New snippet",
                          body: "",
                          keywords: [],
                        },
                      ]);
                      setSnippetsDirty(true);
                    }}
                  >
                    Add snippet
                  </Button>
                </div>
              </div>

              {snippets.length === 0 ? (
                <div className="text-xs text-zinc-500">No snippets yet.</div>
              ) : (
                <div className="space-y-3">
                  {snippets.map((snippet, idx) => (
                    <div key={snippet.id} className="rounded-lg border border-zinc-200 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold text-zinc-600">Snippet {idx + 1}</div>
                        <button
                          className="text-xs text-rose-600"
                          onClick={() => {
                            setSnippets((prev) => prev.filter((s) => s.id !== snippet.id));
                            setSnippetsDirty(true);
                          }}
                        >
                          Remove
                        </button>
                      </div>
                      <input
                        className="w-full rounded border px-3 py-2 text-sm"
                        value={snippet.title}
                        onChange={(e) => {
                          const next = [...snippets];
                          next[idx] = { ...snippet, title: e.target.value };
                          setSnippets(next);
                          setSnippetsDirty(true);
                        }}
                        placeholder="Snippet title"
                      />
                      <input
                        className="w-full rounded border px-3 py-2 text-sm"
                        value={snippet.keywords.join(", ")}
                        onChange={(e) => {
                          const keywords = e.target.value
                            .split(",")
                            .map((k) => k.trim())
                            .filter(Boolean);
                          const next = [...snippets];
                          next[idx] = { ...snippet, keywords };
                          setSnippets(next);
                          setSnippetsDirty(true);
                        }}
                        placeholder="Keywords (comma-separated)"
                      />
                      <textarea
                        className="w-full rounded border px-3 py-2 text-sm min-h-[80px]"
                        value={snippet.body}
                        onChange={(e) => {
                          const next = [...snippets];
                          next[idx] = { ...snippet, body: e.target.value };
                          setSnippets(next);
                          setSnippetsDirty(true);
                        }}
                        placeholder="Snippet content"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Privacy toggles */}
            <div className="rounded border p-3 space-y-2">
              <div className="text-sm font-medium">Privacy & Safety</div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={privacyStripPhones}
                  onChange={(e) => setPrivacyStripPhones(e.target.checked)}
                />
                Strip phone numbers before analysis
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={privacyNoPrices}
                  onChange={(e) => setPrivacyNoPrices(e.target.checked)}
                />
                Never confirm pricing in AI replies
              </label>
              <div className="text-xs text-zinc-500">
                These safeguards are baked into the prompt, not hard-coded into the backend.
              </div>
            </div>

            {/* Allow/Block + tester */}
            <div className="rounded border p-3 space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="block">
                  <div className="text-sm text-zinc-600">Allowed senders (regex)</div>
                  <div className="flex items-center gap-2">
                    <input
                      className="mt-1 w-full border rounded px-3 py-2"
                      value={s.allowedSendersRegex ?? ""}
                      onChange={(e) => patch("allowedSendersRegex", e.target.value)}
                      onBlur={(e) =>
                        patch(
                          "allowedSendersRegex",
                          e.target.value.trim() ? e.target.value : null
                        )
                      }
                      placeholder="^.+@customer\\.com$"
                    />
                    <RegexBadge value={s.allowedSendersRegex} />
                  </div>
                </label>
                <label className="block">
                  <div className="text-sm text-zinc-600">Blocked senders (regex)</div>
                  <div className="flex items-center gap-2">
                    <input
                      className="mt-1 w-full border rounded px-3 py-2"
                      value={s.blockedSendersRegex ?? ""}
                      onChange={(e) => patch("blockedSendersRegex", e.target.value)}
                      onBlur={(e) =>
                        patch(
                          "blockedSendersRegex",
                          e.target.value.trim() ? e.target.value : null
                        )
                      }
                      placeholder="(noreply|newsletter)"
                    />
                    <RegexBadge value={s.blockedSendersRegex} />
                  </div>
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
                <label className="block md:col-span-2">
                  <div className="text-sm text-zinc-600">Test a sample sender value</div>
                  <input
                    className="mt-1 w-full border rounded px-3 py-2"
                    value={reTest.sample}
                    onChange={(e) =>
                      setReTest({ ...reTest, sample: e.target.value })
                    }
                    placeholder="e.g., john@customer.com"
                  />
                </label>
                <button
                  onClick={onRegexTest}
                  className="rounded bg-zinc-900 text-white px-3 py-2 text-sm"
                >
                  Test regex
                </button>
              </div>

              <div className="text-xs text-zinc-600">
                {reTest.allowOk !== null && (
                  <span
                    className={cx(
                      "mr-3",
                      reTest.allowOk ? "text-emerald-600" : "text-zinc-500"
                    )}
                  >
                    Allow check: {reTest.allowOk ? "✓ match" : "no match"}
                  </span>
                )}
                {reTest.blockHit !== null && (
                  <span
                    className={cx(
                      reTest.blockHit ? "text-red-600" : "text-zinc-500"
                    )}
                  >
                    Block check: {reTest.blockHit ? "✗ blocked" : "not blocked"}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Prompt & system preview */}
          <div className="space-y-4">
            <label className="block">
              <div className="flex items-center justify-between">
                <div className="text-sm text-zinc-600">Owner instruction prompt</div>
              </div>
              <textarea
                className="mt-1 w-full border rounded px-3 py-2 font-mono text-sm"
                rows={12}
                value={s.instructionPrompt}
                onChange={(e) => patch("instructionPrompt", e.target.value)}
                placeholder="Tell the AI exactly how to reply to enquiries, jobs, etc."
              />
            </label>

            <div className="space-y-2">
              <div className="text-sm text-zinc-600">
                System prompt preview (what we send the model)
              </div>
              <pre className="whitespace-pre-wrap text-xs border rounded p-3 bg-zinc-50 h-64 overflow-auto">
{systemPreview}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* RULES */}
      {tab === "rules" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm text-zinc-600">
              Create conditions and actions. Example: “If subject includes ‘quote’ → Auto-draft with ‘Lead intake’ template”.
            </div>
            <button
              onClick={addRule}
              className="rounded bg-zinc-900 text-white px-3 py-1.5 text-sm"
            >
              Add rule
            </button>
          </div>

          {!rules.length && (
            <Alert kind="info">
              No rules yet. New emails will use confidence threshold + the general prompt.
            </Alert>
          )}

          <div className="space-y-2">
            {rules.map((r) => {
              const hasValidTemplate = ruleHasValidTemplate(r);
              return (
                <div key={r.id} className="border rounded p-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <input
                      className="border rounded px-2 py-1 text-sm flex-1"
                      value={r.name}
                      onChange={(e) => updateRule(r.id, { name: e.target.value })}
                    />
                    <label className="text-sm flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        onChange={(e) =>
                          updateRule(r.id, { enabled: e.target.checked })
                        }
                      />
                      Enabled
                    </label>
                    <button
                      onClick={() => removeRule(r.id)}
                      className="text-sm text-red-600"
                    >
                      Delete
                    </button>
                  </div>

                  <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <label className="block">
                      <div className="text-xs text-zinc-600">From includes</div>
                      <input
                        className="mt-1 w-full border rounded px-2 py-1"
                        value={r.when.fromIncludes || ""}
                        onChange={(e) =>
                          updateRule(r.id, {
                            when: { ...r.when, fromIncludes: e.target.value },
                          })
                        }
                      />
                    </label>
                    <label className="block">
                      <div className="text-xs text-zinc-600">Subject includes</div>
                      <input
                        className="mt-1 w-full border rounded px-2 py-1"
                        value={r.when.subjectIncludes || ""}
                        onChange={(e) =>
                          updateRule(r.id, {
                            when: { ...r.when, subjectIncludes: e.target.value },
                          })
                        }
                      />
                    </label>
                    <label className="block">
                      <div className="text-xs text-zinc-600">Body includes</div>
                      <input
                        className="mt-1 w-full border rounded px-2 py-1"
                        value={r.when.bodyIncludes || ""}
                        onChange={(e) =>
                          updateRule(r.id, {
                            when: { ...r.when, bodyIncludes: e.target.value },
                          })
                        }
                      />
                    </label>
                  </div>

                  <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <label className="block">
                      <div className="text-xs text-zinc-600">Sender regex (optional)</div>
                      <input
                        className="mt-1 w-full border rounded px-2 py-1"
                        value={r.when.senderRegex || ""}
                        onChange={(e) =>
                          updateRule(r.id, {
                            when: { ...r.when, senderRegex: e.target.value },
                          })
                        }
                        placeholder="^.+@customer\\.com$"
                      />
                    </label>
                    <label className="block">
                      <div className="text-xs text-zinc-600">Action</div>
                      <select
                        className="mt-1 w-full border rounded px-2 py-1"
                        value={r.then.action}
                        onChange={(e) =>
                          updateRule(r.id, {
                            then: {
                              ...r.then,
                              action: e.target.value as Rule["then"]["action"],
                            },
                          })
                        }
                      >
                        <option value="auto_draft">Auto-draft</option>
                        <option value="queue">Queue for review</option>
                        <option value="skip">Skip</option>
                        <option value="forward">Forward to address</option>
                      </select>
                    </label>
                    <label className="block">
                      <div className="text-xs text-zinc-600">Template / Forward to</div>
                      {r.then.action === "forward" ? (
                        <input
                          className="mt-1 w-full border rounded px-2 py-1"
                          value={r.then.forwardTo || ""}
                          onChange={(e) =>
                            updateRule(r.id, {
                              then: { ...r.then, forwardTo: e.target.value },
                            })
                          }
                          placeholder="ops@yourcompany.com"
                        />
                      ) : (
                        <select
                          className={cx(
                            "mt-1 w-full border rounded px-2 py-1",
                            !hasValidTemplate && "border-red-300 bg-red-50"
                          )}
                          value={r.then.templateKey || ""}
                          onChange={(e) =>
                            updateRule(r.id, {
                              then: { ...r.then, templateKey: e.target.value },
                            })
                          }
                        >
                          <option value="">Select template…</option>
                          {templates.map((t) => (
                            <option key={t.key} value={t.key}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </label>
                  </div>

                  {!hasValidTemplate && r.then.action !== "forward" && (
                    <div className="text-xs text-red-600 mt-1">
                      This rule has no valid template selected. It will be skipped until you choose one.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TEMPLATES */}
      {tab === "templates" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm text-zinc-600">
              Create quick-reply building blocks with placeholders.
            </div>
            <button
              onClick={addTemplate}
              className="rounded bg-zinc-900 text-white px-3 py-1.5 text-sm"
            >
              New template
            </button>
          </div>

          <div className="space-y-3">
            {templates.map((t) => (
              <div key={t.key} className="border rounded p-3">
                <div className="flex items-center gap-2">
                  <input
                    className="border rounded px-2 py-1 text-sm w-56"
                    value={t.name}
                    onChange={(e) => updateTemplate(t.key, { name: e.target.value })}
                  />
                  <input
                    className="border rounded px-2 py-1 text-sm flex-1"
                    placeholder="Subject (optional)"
                    value={t.subject ?? ""}
                    onChange={(e) => updateTemplate(t.key, { subject: e.target.value })}
                  />
                  <button
                    className="text-sm text-red-600 ml-auto"
                    onClick={() => removeTemplate(t.key)}
                  >
                    Delete
                  </button>
                </div>
                <textarea
                  className="mt-2 w-full border rounded px-3 py-2 font-mono text-sm"
                  rows={6}
                  value={t.body}
                  onChange={(e) => updateTemplate(t.key, { body: e.target.value })}
                />
                <div className="text-xs text-zinc-500 mt-1">
                  Placeholders: {"{{business.name}}"}, {"{{customer.firstName}}"},{" "}
                  {"{{signature}}"} …
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KNOWLEDGE BASE */}
      {tab === "knowledge" && (
        <div className="space-y-4">
          <Alert kind="info">
            This is the knowledge base the AI will rely on instead of scraping a website URL.
            Keep it short but specific to your business.
          </Alert>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <label className="block">
                <div className="text-sm text-zinc-600">Business overview</div>
                <textarea
                  className="mt-1 w-full border rounded px-3 py-2 text-sm min-h-[100px]"
                  value={s.knowledgeBaseJson?.overview || ""}
                  onChange={(e) =>
                    patch("knowledgeBaseJson", {
                      ...(s.knowledgeBaseJson || {}),
                      overview: e.target.value,
                    })
                  }
                  placeholder="Who you are, what you do, typical customers..."
                />
              </label>
              <label className="block">
                <div className="text-sm text-zinc-600">Services</div>
                <textarea
                  className="mt-1 w-full border rounded px-3 py-2 text-sm min-h-[100px]"
                  value={s.knowledgeBaseJson?.services || ""}
                  onChange={(e) =>
                    patch("knowledgeBaseJson", {
                      ...(s.knowledgeBaseJson || {}),
                      services: e.target.value,
                    })
                  }
                  placeholder="- Electrical repairs\n- Switchboard upgrades\n- Heat pump installs..."
                />
              </label>
              <label className="block">
                <div className="text-sm text-zinc-600">Service areas / locations</div>
                <textarea
                  className="mt-1 w-full border rounded px-3 py-2 text-sm min-h-[80px]"
                  value={s.knowledgeBaseJson?.locations || ""}
                  onChange={(e) =>
                    patch("knowledgeBaseJson", {
                      ...(s.knowledgeBaseJson || {}),
                      locations: e.target.value,
                    })
                  }
                  placeholder="e.g. Christchurch, Rolleston, Rangiora — residential only"
                />
              </label>
            </div>
            <div className="space-y-3">
              <label className="block">
                <div className="text-sm text-zinc-600">Common FAQs & answers</div>
                <textarea
                  className="mt-1 w-full border rounded px-3 py-2 text-sm min-h-[130px]"
                  value={s.knowledgeBaseJson?.faqs || ""}
                  onChange={(e) =>
                    patch("knowledgeBaseJson", {
                      ...(s.knowledgeBaseJson || {}),
                      faqs: e.target.value,
                    })
                  }
                  placeholder={`Q: Do you do emergency callouts?\nA: Yes, extra charges may apply.\n\nQ: How soon can you come out?\nA: Usually within 2–3 business days depending on workload.`}
                />
              </label>
              <label className="block">
                <div className="text-sm text-zinc-600">Always mention (when relevant)</div>
                <textarea
                  className="mt-1 w-full border rounded px-3 py-2 text-sm min-h-[70px]"
                  value={s.knowledgeBaseJson?.alwaysMention || ""}
                  onChange={(e) =>
                    patch("knowledgeBaseJson", {
                      ...(s.knowledgeBaseJson || {}),
                      alwaysMention: e.target.value,
                    })
                  }
                  placeholder="e.g. 'We are fully registered and insured', 'All work covered by a 12-month guarantee'..."
                />
              </label>
              <label className="block">
                <div className="text-sm text-zinc-600">Never say / avoid</div>
                <textarea
                  className="mt-1 w-full border rounded px-3 py-2 text-sm min-h-[70px]"
                  value={s.knowledgeBaseJson?.neverMention || ""}
                  onChange={(e) =>
                    patch("knowledgeBaseJson", {
                      ...(s.knowledgeBaseJson || {}),
                      neverMention: e.target.value,
                    })
                  }
                  placeholder="e.g. exact pricing, promising same-day service, mentioning subcontractors, etc."
                />
              </label>
            </div>
          </div>
        </div>
      )}

      {/* TESTING */}
      {tab === "testing" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="space-y-2">
            <div className="text-sm text-zinc-600">
              Paste any email content to test (included in your plan)
            </div>
            <textarea
              className="w-full border rounded px-3 py-2 min-h-[240px]"
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
              placeholder="Hi team, can I get a quote for..."
            />
            <button
              onClick={runTest}
              className="rounded bg-zinc-900 text-white px-3 py-1.5 text-sm"
            >
              Run test
            </button>
            <div className="text-xs text-zinc-500">
              Uses your current model, rules, knowledge base & prompt. It won’t send any real
              emails.
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-sm text-zinc-600">Result</div>
            {!testOut ? (
              <Alert kind="info">No test run yet.</Alert>
            ) : (
              <div className="border rounded p-3 space-y-2">
                <div className="text-sm">
                  Intent: <b>{testOut.intent || "unknown"}</b>
                </div>
                {typeof testOut.confidence === "number" && (
                  <div className="text-sm">
                    Confidence: {(testOut.confidence * 100).toFixed(0)}%
                  </div>
                )}
                <div className="text-sm">Reply draft:</div>
                <pre className="whitespace-pre-wrap text-xs bg-zinc-50 p-3 rounded border">
                  {testOut.reply}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ADVANCED */}
      {tab === "advanced" && (
        <div className="space-y-4">
          <Alert kind="info">
            Power user options. If you’re not sure, leave these as-is.
          </Alert>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Business hours picker (simple) */}
            <div className="border rounded p-3">
              <div className="text-sm font-medium mb-2">Business hours (basic)</div>
              {["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => {
                const val =
                  (s.businessHoursJson?.[d] as [number, number] | undefined) || [
                    540, 1020,
                  ]; // 9:00–17:00
                const toHHMM = (m: number) =>
                  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(
                    m % 60
                  ).padStart(2, "0")}`;
                const parse = (hhmm: string) => {
                  const [hh, mm] = hhmm.split(":").map((n) => Number(n) || 0);
                  return (
                    Math.max(0, Math.min(23, hh)) * 60 +
                    Math.max(0, Math.min(59, mm))
                  );
                };
                return (
                  <div
                    key={d}
                    className="grid grid-cols-5 gap-2 items-center mb-2"
                  >
                    <div className="text-xs uppercase text-zinc-600 col-span-1">
                      {d}
                    </div>
                    <input
                      className="border rounded px-2 py-1 text-sm col-span-2"
                      defaultValue={toHHMM(val[0])}
                      onBlur={(e) => {
                        const next = { ...(s.businessHoursJson || {}) };
                        next[d] = [parse(e.target.value), val[1]];
                        patch("businessHoursJson", next);
                      }}
                    />
                    <input
                      className="border rounded px-2 py-1 text-sm col-span-2"
                      defaultValue={toHHMM(val[1])}
                      onBlur={(e) => {
                        const next = { ...(s.businessHoursJson || {}) };
                        next[d] = [val[0], parse(e.target.value)];
                        patch("businessHoursJson", next);
                      }}
                    />
                  </div>
                );
              })}
              <div className="text-xs text-zinc-500 mt-2">
                Used for after-hours auto-replies if you add a rule.
              </div>
            </div>

            {/* Escalation tags + Import / Export + log retention */}
            <div className="border rounded p-3 space-y-3">
              <div>
                <div className="text-sm font-medium mb-1">
                  Human escalation tags
                </div>
                <input
                  className="w-full border rounded px-2 py-1 text-sm"
                  value={escalationTagInput}
                  onChange={(e) => {
                    setEscalationTagInput(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="urgent, complaint, refund, quote"
                />
                <div className="text-xs text-zinc-500 mt-1">
                  If any of these words appear in an email, your backend can force human review
                  instead of sending automatically.
                </div>
              </div>

              <div>
                <div className="text-sm font-medium mb-1">Backup & Transfer</div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      const bundle = {
                        ...s,
                        humanEscalationTags: parseTags(escalationTagInput),
                        autoReplyRulesJson: buildBundle(),
                      };
                      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
                        type: "application/json",
                      });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "email-ai-settings.json";
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="rounded bg-zinc-900 text-white px-3 py-1.5 text-sm"
                  >
                    Export JSON
                  </button>
                  <label className="text-sm">
                    <span className="rounded bg-zinc-100 px-3 py-1.5 cursor-pointer hover:bg-zinc-200 inline-block">
                      Import JSON…
                    </span>
                    <input
                      type="file"
                      accept="application/json"
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        try {
                          const txt = await f.text();
                          const obj = JSON.parse(txt);

                          const imported: Settings = {
                            ...s,
                            ...obj,
                          };



                            const embedded: any[] = Array.isArray(obj.autoReplyRulesJson)
                            ? (obj.autoReplyRulesJson as any[])
                            : [];

                            const tFrom: Template[] = embedded
                            .filter((x) => x?.__type === "template")
                            .map((t) => ({
                            key: t.key as string,
                            name: t.name as string,
                            subject: t.subject as string | undefined,
                            body: t.body as string,
                            }));

                            const rFrom: Rule[] = embedded
                            .filter((x) => !x?.__type)
                            .map((r) => ({
                            id: r.id as string,
                            enabled: Boolean(r.enabled),
                            name: r.name as string,
                            when: (r.when as Rule["when"]) || {},
                            then: (r.then as Rule["then"]) || { action: "auto_draft" },
                            }));

                          imported.autoReplyRulesJson = embedded;
                          if (!Array.isArray(imported.humanEscalationTags)) {
                            imported.humanEscalationTags = [];
                          }
                          if (!imported.knowledgeBaseJson) {
                            imported.knowledgeBaseJson = { ...DEFAULTS.knowledgeBaseJson };
                          }

                          setS(imported);
                          setTemplates(tFrom.length ? tFrom : STARTER_TEMPLATES);
                          setRules(rFrom);
                          setEscalationTagInput(
                            tagsToString(imported.humanEscalationTags)
                          );
                          setDirty(true);
                          toast.show("Imported. Review and save.", "success");
                        } catch {
                          toast.show("Invalid JSON", "error");
                        } finally {
                          e.target.value = "";
                        }
                      }}
                    />
                  </label>
                </div>
                <div className="text-xs text-zinc-500 mt-2">
                  This includes templates, rules, general settings, knowledge base, and escalation tags.
                </div>
              </div>

              <div>
                <div className="text-sm font-medium mb-1">Log retention (days)</div>
                <input
                  type="number"
                  className="w-24 border rounded px-2 py-1 text-sm"
                  value={s.logRetentionDays ?? 30}
                  onChange={(e) =>
                    patch("logRetentionDays", Number(e.target.value || 30))
                  }
                  min={1}
                  max={365}
                />
                <div className="text-xs text-zinc-500 mt-1">
                  How long your backend should keep AI email logs (if implemented).
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* Tiny badge showing regex compile status */
function RegexBadge({ value }: { value: string | null }) {
  const norm = normalizeRegexInput(value);
  if (!value || value.trim() === "") {
    return (
      <span className="text-[10px] px-2 py-1 rounded border bg-zinc-50 text-zinc-500 border-zinc-200">
        empty
      </span>
    );
  }
  if (norm === "__INVALID__") {
    return (
      <span className="text-[10px] px-2 py-1 rounded border bg-red-50 text-red-700 border-red-200">
        invalid
      </span>
    );
  }
  return (
    <span className="text-[10px] px-2 py-1 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">
      ok
    </span>
  );
}
