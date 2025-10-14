// app/api/shopify/webhooks/route.ts
import crypto from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendMail } from "@/lib/mail"; // <-- we’ll make this below

export const runtime = "nodejs";

const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET!;
if (!SHOPIFY_WEBHOOK_SECRET) {
  console.warn("⚠️ SHOPIFY_WEBHOOK_SECRET missing in .env");
}

export async function POST(req: Request) {
  try {
    // Shopify sends the raw body; we must verify it before parsing
    const rawBody = await req.text();
    const hmacHeader = req.headers.get("x-shopify-hmac-sha256") || "";

    if (!hmacHeader) {
      return NextResponse.json({ error: "Missing HMAC" }, { status: 401 });
    }

    const digest = crypto
      .createHmac("sha256", SHOPIFY_WEBHOOK_SECRET)
      .update(rawBody, "utf8")
      .digest("base64");

    const valid =
      Buffer.byteLength(hmacHeader) === Buffer.byteLength(digest) &&
      crypto.timingSafeEqual(Buffer.from(hmacHeader), Buffer.from(digest));

    if (!valid) {
      console.error("❌ Invalid HMAC");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const data = JSON.parse(rawBody);
    const email = data?.email ?? null;
    const shopifyOrderId = String(data?.id ?? "");
    const note_attributes = data?.note_attributes ?? [];

    const planName =
      note_attributes.find((n: any) => n.name === "plan")?.value ?? "STARTER";
    const orgName =
      note_attributes.find((n: any) => n.name === "orgName")?.value ?? null;

    if (!email) {
      console.error("⚠️ Missing email in webhook payload");
      return NextResponse.json({ ok: true }); // still respond 200 to stop retries
    }

    // Generate 7-day token
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

    // Email customer a setup link
    const baseUrl = process.env.NEXTAUTH_URL || "https://aroha-bookings.vercel.app";
    const link = `${baseUrl}/complete?token=${token}`;

    await sendMail({
      to: email,
      subject: "Finish setting up your Aroha Bookings account",
      html: `
        <p>Kia ora,</p>
        <p>Thanks for purchasing <strong>Aroha Calls</strong>!</p>
        <p>Click below to finish setting up your account:</p>
        <p>
          <a href="${link}" style="background:#00bfa6;color:white;padding:10px 16px;border-radius:8px;text-decoration:none;">
            Complete Setup
          </a>
        </p>
        <p>This link expires in 7 days.</p>
      `,
    });

    console.log(`✅ Token created for ${email}: ${token}`);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Shopify webhook error:", err);
    // Always 200 so Shopify doesn't retry endlessly
    return NextResponse.json({ ok: true });
  }
}
