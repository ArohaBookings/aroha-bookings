// lib/sms.ts
import twilio from "twilio";

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const DEFAULT_FROM = process.env.TWILIO_FROM_NUMBER;

// When not live, we just log messages
const isLive = !!(ACCOUNT_SID && AUTH_TOKEN && DEFAULT_FROM);

export async function sendSMS(to: string, body: string, from?: string) {
  if (!isLive) {
    console.log("📱 [SMS Stub]", { to, body, from: from || "default" });
    return { ok: true, simulated: true };
  }

  try {
    const client = twilio(ACCOUNT_SID!, AUTH_TOKEN!);
    const res = await client.messages.create({
      to,
      from: from || DEFAULT_FROM!,
      body,
    });
    console.log("✅ SMS sent:", res.sid);
    return { ok: true };
  } catch (err) {
    console.error("❌ SMS failed:", err);
    return { ok: false, error: (err as Error).message };
  }
}
