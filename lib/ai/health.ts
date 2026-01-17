import { generateText, hasAI } from "@/lib/ai/client";

export async function explainHealthSummary(input: {
  orgName: string;
  syncErrors: number;
  cronLastRun?: string | null;
}) {
  const base = `Sync errors: ${input.syncErrors}. Cron last run: ${
    input.cronLastRun ? new Date(input.cronLastRun).toLocaleString() : "unknown"
  }.`;
  if (!hasAI()) return { text: base, ai: false };

  const prompt = [
    `Summarize system health for ${input.orgName}.`,
    `Sync errors: ${input.syncErrors}. Cron last run: ${input.cronLastRun || "unknown"}.`,
    "Return 1–2 short sentences with a suggestion if needed.",
  ].join("\n");

  const text = await generateText(prompt);
  return { text: text || base, ai: Boolean(text) };
}
