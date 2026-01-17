import { generateText, hasAI } from "./client";
import type { SimulationResult } from "@/lib/automation/rules";

export async function explainSimulation(input: {
  orgName: string;
  results: SimulationResult[];
}) {
  const base = input.results
    .map((r) => `${r.triggered ? "Triggered" : "Not triggered"}: ${r.reason}`)
    .join(" ");
  if (!hasAI()) return { text: base, ai: false };

  const prompt = [
    `Explain the following automation simulation for ${input.orgName}.`,
    input.results.map((r) => `- ${r.action}: ${r.reason}`).join("\n"),
    "Return 2 short sentences. No bullets.",
  ].join("\n");

  const text = await generateText(prompt);
  return { text: text || base, ai: Boolean(text) };
}

export async function suggestRulesCopy(input: {
  orgName: string;
  summary: string;
}) {
  const base = input.summary;
  if (!hasAI()) return { text: base, ai: false };

  const prompt = [
    `Write a short suggestion for automation rules for ${input.orgName}.`,
    `Context: ${input.summary}`,
    "Return 1 sentence.",
  ].join("\n");

  const text = await generateText(prompt);
  return { text: text || base, ai: Boolean(text) };
}
