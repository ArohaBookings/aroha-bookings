import { generateText, hasAI } from "@/lib/ai/client";
import type { ClientSignals } from "@/lib/clientSignals";

export async function summarizeClientSignals(input: {
  orgName: string;
  signals: ClientSignals;
}) {
  const base = [
    `Total visits: ${input.signals.totalVisits}.`,
    `No-shows: ${input.signals.noShowCount}.`,
    `Cancellations: ${input.signals.cancellationCount}.`,
    input.signals.preferredTimeWindow
      ? `Prefers ${input.signals.preferredTimeWindow} bookings.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (!hasAI()) return { text: base, ai: false };

  const prompt = [
    `Summarize this client's booking behavior for ${input.orgName}.`,
    `Visits: ${input.signals.totalVisits}, no-shows: ${input.signals.noShowCount}, cancellations: ${input.signals.cancellationCount}.`,
    `Preferred time: ${input.signals.preferredTimeWindow || "unknown"}.`,
    "Return 1 short sentence.",
  ].join("\n");

  const text = await generateText(prompt);
  return { text: text || base, ai: Boolean(text) };
}

export async function suggestGuardrails(input: {
  orgName: string;
  signals: ClientSignals;
}) {
  const suggestions: Array<{ type: string; label: string; payload: Record<string, unknown> }> = [];
  if (input.signals.noShowCount >= 2) {
    suggestions.push({
      type: "REQUIRE_CONFIRMATION",
      label: "Require confirmation for future bookings",
      payload: { requireConfirmation: true },
    });
  }
  if (input.signals.noShowCount >= 1) {
    suggestions.push({
      type: "BUFFER_PADDING",
      label: "Add 10 min buffer to this client",
      payload: { bufferBeforeMin: 10, bufferAfterMin: 10 },
    });
  }

  if (!hasAI()) {
    return { summary: "", suggestions, ai: false };
  }

  const prompt = [
    `Suggest guardrails for a client at ${input.orgName}.`,
    `No-shows: ${input.signals.noShowCount}, visits: ${input.signals.totalVisits}.`,
    "Return 1 sentence explaining the suggestions.",
  ].join("\n");

  const text = await generateText(prompt);
  return { summary: text || "", suggestions, ai: Boolean(text) };
}
