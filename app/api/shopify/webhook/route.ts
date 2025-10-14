import crypto from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const SHOPIFY_SECRET = process.env.SHOPIFY_SECRET_KEY!;

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const hmac = req.headers.get("x-shopify-hmac-sha256");
    const computed = crypto
      .createHmac("sha256", SHOPIFY_SECRET)
      .update(rawBody, "utf8")
      .digest("base64");

    if (computed !== hmac) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const data = JSON.parse(rawBody);
    const { email, id: shopifyOrderId, note_attributes } = data;

    // find selected plan
    const planName =
      note_attributes?.find((n: any) => n.name === "plan")?.value ??
      "STARTER";

    // create secure token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await prisma.checkoutToken.create({
      data: {
        token,
        email,
        plan: planName.toUpperCase(),
        orgName:
          note_attributes?.find((n: any) => n.name === "orgName")?.value ?? null,
        shopifyOrderId: String(shopifyOrderId),
        expiresAt,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Shopify webhook error:", err);
    return NextResponse.json({ error: "Webhook failed" }, { status: 500 });
  }
}
