import OpenAI from "openai";

const apiKey = (process.env.OPENAI_API_KEY || "").trim();
const openai = apiKey ? new OpenAI({ apiKey }) : null;

export function hasAI() {
  return Boolean(openai);
}

export async function generateText(prompt: string) {
  if (!openai) return null;
  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.4,
    messages: [
      {
        role: "system",
        content:
          "You are a concise assistant that explains scheduling logic in plain language. Avoid hallucinations.",
      },
      { role: "user", content: prompt },
    ],
  });
  return resp.choices[0]?.message?.content?.trim() || null;
}
