// app/api/auth/reset-password/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    // --- Parse body safely ---
    let body: any = null;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid request body." },
        { status: 400 }
      );
    }

    const token = typeof body?.token === "string" ? body.token.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    // --- Validate input ---
    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Missing or invalid reset token." },
        { status: 400 }
      );
    }

    if (!password || password.length < 8) {
      return NextResponse.json(
        { ok: false, error: "Password must be at least 8 characters." },
        { status: 400 }
      );
    }

    // --- Look up token ---
    const vt = await prisma.verificationToken.findUnique({
      where: { token },
    });

    if (!vt) {
      return NextResponse.json(
        { ok: false, error: "This reset link is invalid." },
        { status: 400 }
      );
    }

    // --- Expiry check ---
    if (vt.expires < new Date()) {
      // Clean up expired token
      await prisma.verificationToken.deleteMany({ where: { token } });
      return NextResponse.json(
        { ok: false, error: "This reset link has expired." },
        { status: 400 }
      );
    }

    const email = vt.identifier;

    // --- Check user exists ---
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (!user) {
      // Clean token anyway to avoid leaking existence
      await prisma.verificationToken.deleteMany({ where: { identifier: email } });
      return NextResponse.json(
        { ok: false, error: "Account not found." },
        { status: 400 }
      );
    }

    // --- Hash password securely ---
    const hash = await bcrypt.hash(password, 12); // 12 is stronger without slowing too much

    await prisma.user.update({
      where: { id: user.id },
      data: { password: hash },
    });

    // --- Invalidate ALL tokens for this email ---
    await prisma.verificationToken.deleteMany({
      where: { identifier: email },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("reset-password error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal error. Try again later." },
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
