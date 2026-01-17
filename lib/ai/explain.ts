import { generateText, hasAI } from "./client";

type Reason = { code: string; detail: string };

function nicheTone(niche?: string | null) {
  switch ((niche || "").toUpperCase()) {
    case "TRADES":
      return "Use practical, no-nonsense language suitable for trades.";
    case "MEDICAL":
      return "Use calm, professional language suitable for medical practices.";
    case "DENTAL":
      return "Use clear, reassuring language suitable for dental practices.";
    case "LAW":
      return "Use professional, formal language suitable for legal services.";
    case "AUTO":
      return "Use friendly, direct language suitable for automotive services.";
    case "HAIR_BEAUTY":
      return "Use warm, upbeat language suitable for hair and beauty services.";
    default:
      return "Use clear, friendly language.";
  }
}

export async function explainAvailabilityReasons(input: {
  orgName: string;
  timezone: string;
  reasons: Reason[];
  niche?: string | null;
}) {
  if (!input.reasons.length) {
    return { text: "This time looks available.", ai: false };
  }

  const base = input.reasons.map((r) => r.detail).join(" ");
  if (!hasAI()) {
    return { text: base, ai: false };
  }

  const prompt = [
    `${nicheTone(input.niche)}`,
    `Explain availability for ${input.orgName}.`,
    `Timezone: ${input.timezone}.`,
    `Reasons: ${input.reasons.map((r) => `- ${r.detail}`).join("\n")}`,
    "Return 1–2 short sentences, no bullet points.",
  ].join("\n");

  const text = await generateText(prompt);
  return { text: text || base, ai: Boolean(text) };
}

export async function explainDurationSignal(input: {
  orgName: string;
  serviceName: string;
  predictedMin: number;
  sampleSize: number;
  niche?: string | null;
}) {
  const base =
    input.sampleSize > 0
      ? `Usually takes about ${input.predictedMin} minutes based on recent bookings.`
      : `Usually takes about ${input.predictedMin} minutes.`;

  if (!hasAI()) return { text: base, ai: false };

  const prompt = [
    `${nicheTone(input.niche)}`,
    `Write a short duration hint for ${input.orgName}, service "${input.serviceName}".`,
    `Predicted duration: ${input.predictedMin} minutes from ${input.sampleSize} recent bookings.`,
    "Return 1 short sentence.",
  ].join("\n");

  const text = await generateText(prompt);
  return { text: text || base, ai: Boolean(text) };
}

export async function explainRankedSlot(input: {
  orgName: string;
  slotLabel: string;
  rationale: string[];
  niche?: string | null;
}) {
  const base = input.rationale.join(" ");
  if (!hasAI()) return { text: base, ai: false };

  const prompt = [
    `${nicheTone(input.niche)}`,
    `Explain why this slot is recommended for ${input.orgName}.`,
    `Slot: ${input.slotLabel}`,
    `Rationale: ${input.rationale.map((r) => `- ${r}`).join("\n")}`,
    "Return 1 short sentence.",
  ].join("\n");

  const text = await generateText(prompt);
  return { text: text || base, ai: Boolean(text) };
}
