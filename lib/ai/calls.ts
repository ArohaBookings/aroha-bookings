import { generateText, hasAI } from "@/lib/ai/client";

export async function rewriteCallSummary(input: {
  orgName: string;
  systemSummary: string;
}) {
  if (!hasAI()) return { text: input.systemSummary, ai: false };

  const prompt = [
    `Rewrite the following call summary for ${input.orgName}.`,
    "Do not add new facts. Do not change outcomes or durations.",
    "Keep it professional and concise (1-2 sentences).",
    `Summary: ${input.systemSummary}`,
  ].join("\n");

  const text = await generateText(prompt);
  return { text: text || input.systemSummary, ai: Boolean(text) };
}
