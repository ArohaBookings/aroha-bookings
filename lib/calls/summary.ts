import type { Prisma } from "@prisma/client";
import { normalizePhone } from "@/lib/retell/phone";

export type CallSummaryInput = {
  callId: string;
  callerPhone: string;
  startedAt: Date;
  endedAt: Date | null;
  outcome: string;
  appointmentId: string | null;
  transcript: string | null;
  rawJson: Prisma.JsonValue;
  appointment?: {
    startsAt?: Date | null;
    serviceName?: string | null;
    staffName?: string | null;
  } | null;
};

export type CallSummary = {
  systemSummary: string;
  category: string;
  priority: "low" | "normal" | "high" | "urgent";
  risk: "safe" | "needs_review" | "blocked";
  reasons: string[];
  steps: string[];
  fields: Record<string, string>;
};

const CATEGORY_RULES: Array<{ label: string; regex: RegExp; reason: string }> = [
  { label: "cancellation", regex: /\b(cancel|cancellation|refund)\b/i, reason: "Cancellation intent" },
  { label: "reschedule", regex: /\b(reschedule|re-schedule|move|change time|another time)\b/i, reason: "Reschedule intent" },
  { label: "pricing", regex: /\b(price|cost|quote|estimate|fee)\b/i, reason: "Pricing question" },
  { label: "complaint", regex: /\b(complaint|unhappy|angry|bad service|legal|threat)\b/i, reason: "Complaint risk" },
  { label: "booking_request", regex: /\b(book|booking|appointment|schedule|availability)\b/i, reason: "Booking intent" },
  { label: "faq", regex: /\b(hours|open|closing|location|address|parking|policy)\b/i, reason: "General enquiry" },
  { label: "spam", regex: /\b(spam|marketing|advert|promo)\b/i, reason: "Spam keywords" },
];

const URGENT_RULE = /\b(urgent|asap|emergency|immediately)\b/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

export function resolveCallerPhone(rawJson: Prisma.JsonValue, fallback: string): string {
  const cleanFallback = (fallback || "").trim();
  if (cleanFallback && cleanFallback.toLowerCase() !== "unknown" && cleanFallback.length >= 6) {
    return cleanFallback;
  }
  const raw = asRecord(rawJson);
  const call = raw ? asRecord(raw.call) : null;
  const candidates = [
    asString(raw?.caller_phone),
    asString(raw?.callerPhone),
    asString(raw?.from_number),
    asString(raw?.from),
    asString(raw?.phone),
    asString(call?.caller_phone),
    asString(call?.callerPhone),
    asString(call?.from_number),
    asString(call?.from),
  ].filter((v): v is string => Boolean(v));
  for (const cand of candidates) {
    const normalized = normalizePhone(cand);
    if (normalized) return normalized;
  }
  return cleanFallback || "unknown";
}

function collectText(input: CallSummaryInput): string {
  const parts: string[] = [];
  if (input.transcript) parts.push(input.transcript);
  const raw = asRecord(input.rawJson);
  if (raw) {
    const direct = asString(raw.summary) || asString(raw.transcript) || asString(raw.call_summary);
    if (direct) parts.push(direct);
    const analysis = asRecord(raw.analysis) || asRecord(raw.call_analysis);
    if (analysis) {
      const detail =
        asString(analysis.summary) ||
        asString(analysis.intent) ||
        asString(analysis.reason) ||
        asString(analysis.notes);
      if (detail) parts.push(detail);
    }
  }
  return parts.join(" ").trim();
}

function formatDuration(startedAt: Date, endedAt: Date | null): string {
  if (!endedAt) return "unknown duration";
  const seconds = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins <= 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

function detectCategory(text: string): { category: string; reason: string } {
  for (const rule of CATEGORY_RULES) {
    if (rule.regex.test(text)) return { category: rule.label, reason: rule.reason };
  }
  return { category: "other", reason: "No clear intent keywords" };
}

function detectRisk(category: string, text: string): "safe" | "needs_review" | "blocked" {
  if (category === "spam") return "blocked";
  if (category === "complaint") return "needs_review";
  if (/\b(legal|threat|chargeback)\b/i.test(text)) return "needs_review";
  return "safe";
}

function detectPriority(category: string, text: string): "low" | "normal" | "high" | "urgent" {
  if (URGENT_RULE.test(text)) return "urgent";
  if (category === "complaint" || category === "cancellation") return "high";
  return "normal";
}

function extractFields(input: CallSummaryInput): Record<string, string> {
  const fields: Record<string, string> = {};
  const raw = asRecord(input.rawJson);
  const appointment = input.appointment;

  if (appointment?.serviceName) fields.service = appointment.serviceName;
  if (appointment?.staffName) fields.staff = appointment.staffName;
  if (appointment?.startsAt) fields.date = appointment.startsAt.toISOString();

  const candidates = [
    "service",
    "service_name",
    "staff",
    "staff_name",
    "date",
    "time",
    "appointment_time",
    "appointment_date",
  ];
  if (raw) {
    for (const key of candidates) {
      const val = asString(raw[key]);
      if (val && !fields[key]) fields[key] = val;
    }
    const nested = asRecord(raw.extracted) || asRecord(raw.fields) || asRecord(raw.booking);
    if (nested) {
      for (const key of candidates) {
        const val = asString(nested[key]);
        if (val && !fields[key]) fields[key] = val;
      }
    }
  }
  return fields;
}

function buildSteps(input: CallSummaryInput, category: string): string[] {
  const steps: string[] = ["Greeting"];
  const raw = asRecord(input.rawJson);
  const rawSteps = raw?.steps;
  if (Array.isArray(rawSteps)) {
    const fromRaw = rawSteps
      .map((s) => {
        if (typeof s === "string") return s;
        const obj = asRecord(s);
        return asString(obj?.label) || asString(obj?.step) || asString(obj?.name);
      })
      .filter((s): s is string => Boolean(s));
    if (fromRaw.length) return ["Greeting", ...fromRaw];
  }

  const labels: Record<string, string> = {
    booking_request: "Intent: book",
    reschedule: "Intent: reschedule",
    cancellation: "Intent: cancel",
    pricing: "Intent: pricing",
    complaint: "Intent: complaint",
    faq: "Intent: enquiry",
    spam: "Intent: spam",
    other: "Intent: general",
  };
  steps.push(labels[category] || "Intent: general");
  if (input.appointmentId) steps.push("Action: booking created");
  if (input.outcome) steps.push(`Outcome: ${input.outcome.replace(/_/g, " ").toLowerCase()}`);
  return steps;
}

export function buildDeterministicCallSummary(input: CallSummaryInput): CallSummary {
  const text = collectText(input);
  const categoryInfo = detectCategory(text);
  const risk = detectRisk(categoryInfo.category, text);
  const priority = detectPriority(categoryInfo.category, text);
  const duration = formatDuration(input.startedAt, input.endedAt);
  const appointmentHint = input.appointmentId
    ? "A booking was created."
    : "No booking was created.";
  const outcomeLabel = input.outcome ? input.outcome.replace(/_/g, " ").toLowerCase() : "unknown outcome";
  const systemSummary = [
    `Caller ${input.callerPhone || "unknown"} contacted the business about ${categoryInfo.category.replace("_", " ")}.`,
    `Outcome: ${outcomeLabel}. ${appointmentHint}`,
    `Total call duration was ${duration}.`,
  ].join(" ");

  const reasons = [categoryInfo.reason];
  if (risk !== "safe") reasons.push(risk === "blocked" ? "Blocked category" : "Needs review");
  if (priority === "urgent") reasons.push("Urgent language detected");

  return {
    systemSummary,
    category: categoryInfo.category,
    priority,
    risk,
    reasons: reasons.slice(0, 3),
    steps: buildSteps(input, categoryInfo.category),
    fields: extractFields(input),
  };
}
