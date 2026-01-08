// app/api/auth/forgot-password/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import crypto from "crypto";
import { sendMail } from "@/lib/mail";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    // ---- Parse body safely ----
    let body: any = null;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid request body." },
        { status: 400 }
      );
    }

    const emailRaw = typeof body?.email === "string" ? body.email : "";
    const email = emailRaw.trim().toLowerCase();

    if (!email) {
      return NextResponse.json(
        { ok: false, error: "Email is required." },
        { status: 400 }
      );
    }

    // ---- Check if user exists (softly, no enumeration) ----
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    // Always return ok, even if no user – no user enumeration
    if (!user) {
      return NextResponse.json({ ok: true });
    }

    // ---- Create reset token ----
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

    // Clear any existing tokens for this email
    await prisma.verificationToken.deleteMany({
      where: { identifier: email },
    });

    await prisma.verificationToken.create({
      data: {
        identifier: email,
        token,
        expires,
      },
    });

    // ---- Build reset URL ----
    const origin =
      req.headers.get("origin") ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "http://localhost:3000";

    const resetUrl = `${origin.replace(/\/+$/, "")}/reset-password?token=${encodeURIComponent(
      token
    )}`;

// ---- Send reset email ----
await sendMail({
  to: email,
  subject: "Reset your Aroha Bookings password",
  html: `
    <div style="font-family:Arial, sans-serif; line-height:1.6; color:#111;">
      <p>Kia ora,</p>
      <p>You requested to reset your Aroha Bookings password.</p>

      <p>
        <a 
          href="${resetUrl}" 
          style="
            display:inline-block;
            padding:12px 18px;
            background:#000;
            color:#fff;
            text-decoration:none;
            border-radius:8px;
            font-weight:bold;
          "
        >
          Reset password
        </a>
      </p>

      <p>If the button above doesn't work, copy and paste this link:</p>
      <p style="word-break:break-all;">
        <a href="${resetUrl}">${resetUrl}</a>
      </p>

      <p>If you didn’t request this, you can safely ignore this email.</p>
    </div>
  `,
});

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("forgot-password error", err);
    return NextResponse.json(
      { ok: false, error: "Internal error." },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { ok: false, error: "POST only." },
    { status: 405 }
  );
}