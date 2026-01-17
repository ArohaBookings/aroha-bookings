import { generateText, hasAI } from "@/lib/ai/client";

export async function summarizeStaffPerformance(input: {
  orgName: string;
  windowLabel: string;
  rows: Array<{
    staffName: string;
    noShowRate: number;
    avgDurationMin: number;
    revenuePerHour: number;
    syncReliability: number;
  }>;
}) {
  const base = `Performance summary for ${input.windowLabel}: ${input.rows.length} staff tracked.`;
  if (!hasAI()) return { text: base, ai: false };

  const top = input.rows.slice(0, 5).map((r) => {
    return `${r.staffName}: no-show ${(r.noShowRate * 100).toFixed(1)}%, avg ${r.avgDurationMin}m, revenue/hr ${r.revenuePerHour.toFixed(
      0
    )}, sync ${(r.syncReliability * 100).toFixed(0)}%`;
  });

  const prompt = [
    `Summarize staff performance for ${input.orgName}.`,
    `Window: ${input.windowLabel}.`,
    ...top.map((t) => `- ${t}`),
    "Return 2 short sentences. Mention any anomalies if obvious.",
  ].join("\n");

  const text = await generateText(prompt);
  return { text: text || base, ai: Boolean(text) };
}

export async function explainHeatmap(input: {
  orgName: string;
  summary: string;
}) {
  if (!hasAI()) return { text: input.summary, ai: false };
  const prompt = [
    `Explain availability heatmap insights for ${input.orgName}.`,
    `Summary: ${input.summary}`,
    "Return 1 short sentence.",
  ].join("\n");
  const text = await generateText(prompt);
  return { text: text || input.summary, ai: Boolean(text) };
}
