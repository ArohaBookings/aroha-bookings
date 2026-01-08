// app/api/auth/verify-access/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const rawEmail = url.searchParams.get("email");

    if (!rawEmail) {
      return NextResponse.redirect(new URL("/login", req.url));
    }

    // Normalise email (trim + lowercase)
    const email = rawEmail.trim().toLowerCase();
    if (!email) {
      return NextResponse.redirect(new URL("/login", req.url));
    }

    // 1) Already in an org? → send them into the app
    const membership = await prisma.membership.findFirst({
      where: { user: { email } },
    });

    if (membership) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }

    // 2) Check purchase allowlist (cast to any to avoid stale Prisma client types)
    const allow = await (prisma as any).signupAllowlist.findUnique({
      where: { email },
    });

    if (allow && !allow.used) {
      // Create org for this customer
      const org = await prisma.organization.create({
        data: {
          name: allow.note ?? "My Business",
          slug: email.replace(/[@.]/g, "-") + "-" + Date.now(),
          timezone: "Pacific/Auckland",
        },
      });

      // Mark allowlist row as used
      await (prisma as any).signupAllowlist.update({
        where: { email },
        data: { used: true, usedAt: new Date() },
      });

      // Make sure a User exists for this email
      let user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        user = await prisma.user.create({
          data: { email },
        });
      }

      // Attach user to org as owner
      await prisma.membership.create({
        data: {
          userId: user.id,
          orgId: org.id,
          role: "owner",
        },
      });

      // Send them into onboarding flow
      return NextResponse.redirect(new URL("/onboarding", req.url));
    }

    // 3) No org and no valid purchase → still unauthorized
    return NextResponse.redirect(new URL("/unauthorized", req.url));
  } catch (err) {
    console.error("verify-access error:", err);
    return NextResponse.redirect(new URL("/unauthorized", req.url));
  }
}
