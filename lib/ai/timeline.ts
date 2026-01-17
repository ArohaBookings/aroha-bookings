import { generateText, hasAI } from "@/lib/ai/client";
import type { TimelineEvent } from "@/lib/timeline";

export async function summarizeTimeline(input: {
  orgName: string;
  events: TimelineEvent[];
}) {
  const base = input.events
    .map((e) => `${e.type.replace("_", " ").toLowerCase()} on ${new Date(e.at).toLocaleString()}`)
    .join(". ");

  if (!hasAI()) return { text: base, ai: false };

  const prompt = [
    `Summarize this appointment timeline for ${input.orgName}.`,
    ...input.events.map((e) => `- ${e.type}: ${e.detail} @ ${e.at}`),
    "Return 2 short sentences.",
  ].join("\n");

  const text = await generateText(prompt);
  return { text: text || base, ai: Boolean(text) };
}
