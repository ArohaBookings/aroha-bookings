// app/api/shopify/webhooks/route.ts
import crypto from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { sendMail } from "@/lib/mail";

export const runtime = "nodejs";

// ---- helpers ---------------------------------------------------------------

function getEnv(name: string): string | null {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v : null;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Shopify sends many topics; we only care about orders with note_attributes
type ShopifyNoteAttr = { name?: string; value?: string };
type ShopifyOrderPayload = {
  id?: number | string;
  email?: string | null;
  note_attributes?: ShopifyNoteAttr[] | undefined;
};

// ---- route -----------------------------------------------------------------

export async function POST(req: NextRequest) {
  const secret = getEnv("SHOPIFY_WEBHOOK_SECRET");
  if (!secret) {
    // Log once per invocation; reply 500 so you notice during testing
    console.error("SHOPIFY_WEBHOOK_SECRET is missing in environment.");
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  // 1) Get raw body and the HMAC header
  const rawBody = await req.text();
  const hmacHeader = req.headers.get("x-shopify-hmac-sha256") ?? "";
  if (!hmacHeader) {
    return NextResponse.json({ error: "Missing HMAC" }, { status: 401 });
  }

  // 2) Compute digest from the raw body using the app's webhook secret
  const digest = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");

  // Constant-time comparison
  if (!safeEqual(hmacHeader, digest)) {
    console.error("Invalid Shopify HMAC; rejecting webhook.");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // 3) Now it’s safe to parse JSON
  let data: ShopifyOrderPayload;
  try {
    data = JSON.parse(rawBody);
  } catch {
    console.error("Webhook body is not valid JSON.");
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const email = (data.email ?? "").trim();
  const shopifyOrderId = String(data.id ?? "");
  const note_attributes = data.note_attributes ?? [];

  const planName =
    note_attributes.find((n) => (n?.name ?? "").toLowerCase() === "plan")?.value ??
    "STARTER";
  const orgName =
    note_attributes.find((n) => (n?.name ?? "").toLowerCase() === "orgname")?.value ??
    null;

  if (!email) {
    // Don’t fail the webhook if Shopify didn’t include email; just log.
    console.warn("Shopify webhook payload missing email; acknowledging anyway.");
    return NextResponse.json({ ok: true });
  }

  // 4) Create a 7-day setup token
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await prisma.checkoutToken.create({
    data: {
      token,
      email,
      plan: planName.toUpperCase(),
      orgName,
      shopifyOrderId,
      expiresAt,
    },
  });

  // 5) Email the customer a setup link
  const baseUrl = getEnv("NEXTAUTH_URL") ?? "https://aroha-bookings.vercel.app";
  const link = `${baseUrl}/complete?token=${encodeURIComponent(token)}`;

  await sendMail({
    to: email,
    subject: "Finish setting up your Aroha Bookings account",
    html: `
      <p>Kia ora,</p>
      <p>Thanks for your purchase!</p>
      <p>Click below to finish setting up your account:</p>
      <p>
        <a href="${link}" style="background:#00bfa6;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;">
          Complete Setup
        </a>
      </p>
      <p>This link expires in 7 days.</p>
    `,
  });

  console.log(`✅ Setup token created for ${email} (order ${shopifyOrderId}).`);
  return NextResponse.json({ ok: true });
}
