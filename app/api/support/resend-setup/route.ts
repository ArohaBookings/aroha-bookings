// app/api/support/resend-setup/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Safely get a Resend client without upsetting TypeScript.
 * We use `require("resend")` at runtime instead of a typed import,
 * so TS never needs to resolve the "resend" module.
 */
function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[resend-setup] RESEND_API_KEY is missing – emails will not be sent.");
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("resend") as any;
    const ResendCtor = mod?.Resend ?? mod?.default;
    if (!ResendCtor) {
      console.warn("[resend-setup] Could not resolve Resend constructor from module.");
      return null;
    }
    return new ResendCtor(apiKey);
  } catch (err) {
    console.warn("[resend-setup] Failed to require('resend'):", err);
    return null;
  }
}

/**
 * Build + send the setup email.
 * URL will look like: https://yourapp.com/register?token=xxxx
 */
async function sendSetupEmail(email: string, token: string, req: Request) {
  const origin = new URL(req.url).origin;
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || origin).replace(/\/+$/, "");
  const setupUrl = `${baseUrl}/register?token=${encodeURIComponent(token)}`;

  const resend = getResendClient();

  // If we can't build a client, just log what we WOULD send and bail.
  if (!resend) {
    console.log(
      `[resend-setup] Would send setup link to ${email} → ${setupUrl}`,
    );
    return;
  }

  await resend.emails.send({
    from: "Aroha Bookings <no-reply@arohacalls.com>",
    to: email,
    subject: "Complete your Aroha Bookings setup",
    html: `
      <p>Kia ora,</p>
      <p>Thanks for purchasing <strong>Aroha Bookings</strong>.</p>
      <p>Click the button below to finish setting up your account and create your workspace:</p>
      <p>
        <a href="${setupUrl}"
           style="
             display:inline-block;
             padding:10px 18px;
             border-radius:6px;
             background:#4f46e5;
             color:#ffffff;
             text-decoration:none;
             font-weight:600;
           ">
          Complete my setup
        </a>
      </p>
      <p style="font-size:12px;color:#6b7280;">
        If the button doesn't work, copy and paste this link into your browser:<br />
        <span style="word-break:break-all;">${setupUrl}</span>
      </p>
      <p style="font-size:12px;color:#9ca3af;">
        If you didn’t purchase Aroha Bookings, you can ignore this email.
      </p>
    `,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const rawEmail = typeof body?.email === "string" ? body.email : "";
    const email = rawEmail.trim().toLowerCase();

    if (!email) {
      return NextResponse.json(
        { ok: false, error: "Email is required." },
        { status: 400 },
      );
    }

    // 1) Try to find newest valid NEW token
    let tokenRecord = await prisma.checkoutToken.findFirst({
      where: {
        email,
        status: "NEW",
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    // 2) If none, check if they’ve *ever* purchased
    if (!tokenRecord) {
      const anyHistoric = await prisma.checkoutToken.findFirst({
        where: { email },
        orderBy: { createdAt: "desc" },
      });

      if (!anyHistoric) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "We couldn’t find a purchase under that email. Make sure you’re using the email used at checkout.",
          },
          { status: 404 },
        );
      }

      // 3) Issue a fresh NEW token
      const sevenDaysFromNow = new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000,
      );
      const newToken = crypto.randomUUID().replace(/-/g, "");

      tokenRecord = await prisma.checkoutToken.create({
        data: {
          token: newToken,
          email,
          plan: anyHistoric.plan,
          shopifyOrderId: anyHistoric.shopifyOrderId,
          status: "NEW",
          expiresAt: sevenDaysFromNow,
          orgName: anyHistoric.orgName ?? null,
          orgId: null,
        },
      });
    }

    if (!tokenRecord?.token) {
      console.error("resend-setup: token record missing token string");
      return NextResponse.json(
        { ok: false, error: "Failed to generate setup link." },
        { status: 500 },
      );
    }

    // 4) Send the setup email (or log if client is missing)
    await sendSetupEmail(email, tokenRecord.token, req);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("resend-setup error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal error. Please try again." },
      { status: 500 },
    );
  }
}
