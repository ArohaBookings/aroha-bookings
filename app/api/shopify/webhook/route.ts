// app/api/shopify/webhooks/route.ts
import crypto from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { sendMail } from "@/lib/mail";

export const runtime = "nodejs";

/* -------------------------------------------------------------------------- */
/*                                HELPERS                                     */
/* -------------------------------------------------------------------------- */

function env(name: string): string | null {
  const v = process.env[name];
  return v && v.trim().length ? v.trim() : null;
}

function safeEqual(a: string, b: string): boolean {
  const A = Buffer.from(a, "utf8");
  const B = Buffer.from(b, "utf8");
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

type ShopifyNoteAttr = { name?: string; value?: string };
type ShopifyOrderPayload = {
  id?: number | string;
  email?: string | null;
  note_attributes?: ShopifyNoteAttr[];
};

function pickNote(notes: ShopifyNoteAttr[] | undefined, key: string): string | null {
  if (!notes?.length) return null;
  const lower = key.toLowerCase();
  const hit = notes.find((n) => (n?.name ?? "").toLowerCase() === lower);
  const v = hit?.value?.trim();
  return v || null;
}

/** Normalize free-form plan → one of the 4 allowed strings */
function normalizePlan(input: string | null | undefined): "LITE" | "STARTER" | "PROFESSIONAL" | "PREMIUM" {
  const v = (input ?? "").toString().trim().toUpperCase();
  if (v === "LITE" || v === "STARTER" || v === "PROFESSIONAL" || v === "PREMIUM") return v;
  return "STARTER";
}

/* -------------------------------------------------------------------------- */
/*                                   ROUTE                                    */
/* -------------------------------------------------------------------------- */

export async function POST(req: NextRequest) {
  try {
    const secret = env("SHOPIFY_WEBHOOK_SECRET");
    if (!secret) {
      console.error("❌ SHOPIFY_WEBHOOK_SECRET missing in environment");
      // 500 so you notice during setup; (you can return 200 in prod if desired)
      return NextResponse.json({ error: "Server not configured" }, { status: 500 });
    }

    // Raw body + HMAC header
    const rawBody = await req.text();
    const hmacHeader = req.headers.get("x-shopify-hmac-sha256") ?? "";
    if (!hmacHeader) return NextResponse.json({ error: "Missing HMAC" }, { status: 401 });

    // Verify signature
    const digest = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
    if (!safeEqual(hmacHeader, digest)) {
      console.error("❌ Invalid Shopify HMAC — rejecting webhook");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // Parse JSON
    let data: ShopifyOrderPayload;
    try {
      data = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
    }

    const shopifyOrderId = String(data?.id ?? "").trim();
    const email = (data?.email ?? "").trim().toLowerCase();
    const notes = data?.note_attributes ?? [];

    const planStr = pickNote(notes, "plan") ?? "STARTER";
    const orgName = pickNote(notes, "orgName");
    const plan = normalizePlan(planStr); // "LITE" | "STARTER" | "PROFESSIONAL" | "PREMIUM"

    if (!shopifyOrderId) {
      console.warn("⚠️ Webhook missing order ID");
      return NextResponse.json({ ok: true });
    }
    if (!email) {
      console.warn(`⚠️ Order ${shopifyOrderId} missing email`);
      return NextResponse.json({ ok: true });
    }

    /* ---------------------- Idempotent token creation --------------------- */
    const existing = await prisma.checkoutToken.findFirst({
      where: { shopifyOrderId },
      orderBy: { createdAt: "desc" },
    });

    let token: string;
    let expiresAt: Date;

    if (existing) {
      token = existing.token;
      const freshExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      expiresAt = existing.expiresAt > new Date() ? existing.expiresAt : freshExpiry;

      if (existing.expiresAt <= new Date()) {
        await prisma.checkoutToken.update({
          where: { id: existing.id },
          data: { expiresAt, status: "NEW", usedAt: null },
        });
      }
    } else {
      token = crypto.randomBytes(32).toString("hex");
      expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await prisma.checkoutToken.create({
        data: {
          token,
          email,
          // Cast to any to avoid enum import/type headaches across Prisma versions.
          plan: plan as any,
          orgName,
          shopifyOrderId,
          expiresAt,
          status: "NEW",
        },
      });
    }

    /* -------------------------- Send confirmation ------------------------- */
    const baseUrl =
      env("NEXT_PUBLIC_APP_URL") ?? env("NEXTAUTH_URL") ?? "https://aroha-bookings.vercel.app";
    const link = `${baseUrl.replace(/\/+$/, "")}/complete?token=${encodeURIComponent(token)}`;

    try {
      await sendMail({
        to: email,
        subject: "Finish setting up your Aroha Bookings account",
        html: `
          <p>Kia ora,</p>
          <p>Thanks for your purchase!</p>
          <p>Click below to finish setting up your account:</p>
          <p>
            <a href="${link}" style="background:#00bfa6;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">
              Complete Setup
            </a>
          </p>
          <p>This link expires in 7 days.</p>
        `,
      });
    } catch (mailErr) {
      console.error(`✉️ Failed to send email for order ${shopifyOrderId}:`, mailErr);
      // still return 200 — don't make Shopify retry storm
    }

    console.log(`✅ Checkout token ready for ${email} (order ${shopifyOrderId})`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Shopify webhook handler error:", err);
    // Always 200 to prevent Shopify retries
    return NextResponse.json({ ok: true });
  }
}
