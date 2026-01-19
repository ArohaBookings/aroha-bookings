// FILE MAP: app layout at app/layout.tsx; Retell webhook at app/api/webhooks/voice/[provider]/[orgId]/route.ts.
import { inferIntentRange } from "@/lib/booking/intent";

export type IntentAction = {
  id: string;
  label: string;
  reason: string;
  type: "suggest_holds" | "send_booking_link" | "request_details";
  safe: boolean;
  confidence: number;
  payload?: Record<string, unknown>;
  rules?: string[];
  fields?: Record<string, string>;
};

export type IntentContext = {
  source: "call" | "email" | "message" | "booking";
  text: string;
  category?: string | null;
  risk?: string | null;
  orgSlug?: string | null;
  serviceId?: string | null;
  staffId?: string | null;
  memory?: {
    preferredDays?: string[];
    preferredTimes?: string[];
    tonePreference?: string;
    notes?: string | null;
  } | null;
};

const BOOKING_CATEGORIES = new Set(["booking_request", "reschedule", "cancellation"]);

function needsDetails(text: string) {
  const lower = text.toLowerCase();
  const hasDate =
    /(today|tomorrow|next week|this week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(
      lower
    );
  const hasTime = /(\d{1,2})(?::(\d{2}))?\s?(am|pm)?/i.test(lower);
  return !hasDate && !hasTime;
}

function estimateConfidence(category: string, text: string, actionType: IntentAction["type"]): number {
  const hasTimeOrDate = !needsDetails(text);
  if (actionType === "suggest_holds") {
    if (category === "booking_request" || category === "reschedule") {
      return hasTimeOrDate ? 92 : 78;
    }
    return hasTimeOrDate ? 85 : 70;
  }
  if (actionType === "send_booking_link") {
    return hasTimeOrDate ? 80 : 72;
  }
  if (actionType === "request_details") {
    return 64;
  }
  return 70;
}

export function buildIntentActions(context: IntentContext): IntentAction[] {
  const text = context.text || "";
  const category = (context.category || "other").toString();
  const risk = (context.risk || "safe").toString();

  if (risk === "blocked") {
    return [
      {
        id: "blocked_review",
        label: "Manual review required",
        reason: "Risk flagged as blocked.",
        type: "request_details",
        safe: false,
        confidence: 0,
        rules: ["risk:blocked"],
        fields: {},
      },
    ];
  }

  const actions: IntentAction[] = [];
  const intent = inferIntentRange(text || "next 7 days");
  const hasTimeOrDate = !needsDetails(text);
  const fields: Record<string, string> = {
    window: intent.label,
  };
  if (intent.preferredTime) {
    fields.preferredTime = `${intent.preferredTime.hour}:${String(intent.preferredTime.minute).padStart(2, "0")}`;
  }
  if (context.memory?.preferredDays?.length) fields.preferredDays = context.memory.preferredDays.join(", ");
  if (context.memory?.preferredTimes?.length) fields.preferredTimes = context.memory.preferredTimes.join(", ");
  if (context.memory?.tonePreference) fields.tone = context.memory.tonePreference;
  const baseRules = [`source:${context.source}`, `category:${category}`, `risk:${risk}`];

  if (BOOKING_CATEGORIES.has(category)) {
    const prefDays = context.memory?.preferredDays?.length
      ? ` Prefers ${context.memory.preferredDays.join(", ")}.`
      : "";
    const prefTimes = context.memory?.preferredTimes?.length
      ? ` Prefers ${context.memory.preferredTimes.join(", ")}.`
      : "";
    actions.push({
      id: "suggest_holds",
      label: "Suggest top booking slots",
      reason: `Suggested because the message mentions ${category.replace("_", " ")}.${prefDays}${prefTimes}`,
      type: "suggest_holds",
      safe: risk === "safe",
      confidence: estimateConfidence(category, text, "suggest_holds"),
      payload: {
        label: intent.label,
        preferredTime: intent.preferredTime || null,
      },
      rules: [...baseRules, "rule:booking_category", hasTimeOrDate ? "rule:has_time_or_date" : "rule:missing_time"],
      fields,
    });
  }

  if (context.orgSlug) {
    actions.push({
      id: "send_booking_link",
      label: "Send booking link",
      reason: "Lets the client confirm in one click.",
      type: "send_booking_link",
      safe: true,
      confidence: estimateConfidence(category, text, "send_booking_link"),
      payload: { url: `/book/${context.orgSlug}` },
      rules: [...baseRules, "rule:org_slug_present"],
      fields,
    });
  }

  if (needsDetails(text)) {
    actions.push({
      id: "request_details",
      label: "Request missing details",
      reason: "No clear date/time detected.",
      type: "request_details",
      safe: true,
      confidence: estimateConfidence(category, text, "request_details"),
      payload: {
        prompt:
          "Could you share your preferred date/time and the service you want? That helps us lock in a slot quickly.",
      },
      rules: [...baseRules, "rule:missing_date_or_time"],
      fields,
    });
  }

  return actions;
}
