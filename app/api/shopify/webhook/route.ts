// app/api/shopify/webhooks/route.ts
import crypto from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Keep Node runtime (Edge doesn't have crypto.createHmac reliably)
export const runtime = "nodejs";

// MUST match your .env key exactly
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET!;
if (!SHOPIFY_WEBHOOK_SECRET) {
  console.warn("SHOPIFY_WEBHOOK_SECRET is not set");
}

export async function POST(req: Request) {
  try {
    // Read raw body before parsing
    const rawBody = await req.text();

    // Header is lowercased by Next
    const hmacHeader = req.headers.get("x-shopify-hmac-sha256") || "";
    if (!hmacHeader) {
      return NextResponse.json({ error: "Missing HMAC" }, { status: 401 });
    }

    // Compute HMAC
    const digest = crypto
      .createHmac("sha256", SHOPIFY_WEBHOOK_SECRET)
      .update(rawBody, "utf8")
      .digest("base64");

    // Timing-safe compare
    const valid =
      Buffer.byteLength(hmacHeader) === Buffer.byteLength(digest) &&
      crypto.timingSafeEqual(Buffer.from(hmacHeader), Buffer.from(digest));

    if (!valid) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // Safe to parse now
    const data = JSON.parse(rawBody);

    // Pull a few fields we care about (order/create webhook shape)
    const email: string | null = data?.email ?? null;
    const shopifyOrderId: string = String(data?.id ?? "");
    const note_attributes: Array<{ name: string; value: string }> =
      data?.note_attributes ?? [];

    const planName =
      note_attributes.find((n) => n.name === "plan")?.value ?? "STARTER";

    const orgName =
      note_attributes.find((n) => n.name === "orgName")?.value ?? null;

    // Generate one-time token (7-day expiry)
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

    // Always return 200 quickly so Shopify doesn't retry
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Shopify webhook error:", err);
    // Return 200 to avoid endless retries; log for investigation
    return NextResponse.json({ ok: true });
  }
}
