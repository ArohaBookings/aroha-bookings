import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function resolveModel() {
  const model = (process.env.OPENAI_EMAIL_MODEL || "gpt-4o-mini").trim();
  return model || "gpt-4o-mini";
}

export async function GET() {
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  const hasKey = Boolean(apiKey);
  const model = resolveModel();

  let canCallOpenAI = false;
  if (process.env.NODE_ENV !== "production" && hasKey) {
    try {
      const client = new OpenAI({ apiKey });
      const res = await client.chat.completions.create({
        model,
        temperature: 0,
        max_tokens: 5,
        messages: [{ role: "user", content: "Reply with OK." }],
      });
      const content = (res as any)?.choices?.[0]?.message?.content?.trim() || "";
      canCallOpenAI = Boolean(content);
    } catch {
      canCallOpenAI = false;
    }
  }

  return NextResponse.json({
    ok: true,
    hasKey,
    model,
    canCallOpenAI,
  });
}
