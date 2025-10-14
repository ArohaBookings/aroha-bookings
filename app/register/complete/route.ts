import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hash } from "bcryptjs";

export const runtime = "nodejs";

/**
 * POST /register/complete
 * This route finalizes a user's registration after they purchase via Shopify.
 * It validates the token, creates or links a User + Organization, and marks the token as used.
 */
export async function POST(req: Request) {
  try {
    // ───────────────────────────────────────────────
    // Parse incoming request (handles both JSON + form)
    // ───────────────────────────────────────────────
    let token = "";
    let password = "";
    let emailFromBody = "";
    let orgNameFromBody = "";

    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const body = await req.json();
      token = String(body.token || "");
      password = String(body.password || "");
      emailFromBody = String(body.email || "");
      orgNameFromBody = String(body.orgName || "");
    } else {
      const fd = await req.formData();
      token = String(fd.get("token") || "");
      password = String(fd.get("password") || "");
      orgNameFromBody = String(fd.get("orgName") || "");
      // Email will come from the checkout token record instead
    }

    if (!token || !password) {
      return NextResponse.json(
        { ok: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    // ───────────────────────────────────────────────
    // Validate checkout token
    // ───────────────────────────────────────────────
    const ctRow = await prisma.checkoutToken.findUnique({ where: { token } });
    if (!ctRow)
      return NextResponse.json(
        { ok: false, error: "Invalid or unknown token" },
        { status: 400 }
      );

    const usedAt = ctRow.usedAt ?? null;
    const expired =
      !!ctRow.expiresAt && ctRow.expiresAt.getTime() < Date.now();

    if (usedAt)
      return NextResponse.json(
        { ok: false, error: "Token already used" },
        { status: 400 }
      );
    if (expired)
      return NextResponse.json(
        { ok: false, error: "Token expired" },
        { status: 400 }
      );

    const email = (ctRow.email || emailFromBody || "").toLowerCase();
    if (!email)
      return NextResponse.json(
        { ok: false, error: "Missing email (token not linked to an order)" },
        { status: 400 }
      );

    // ───────────────────────────────────────────────
    // Upsert user
    // ───────────────────────────────────────────────
    // Your Prisma schema doesn't have passwordHash, so we skip storing the hash.
    // You can later extend your User model with `passwordHash String?` if you add credential login.
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        name: email.split("@")[0],
      },
    });

    // ───────────────────────────────────────────────
    // Link or create Organization
    // ───────────────────────────────────────────────
    const existingMembership = await prisma.membership.findFirst({
      where: { userId: user.id },
    });

    let orgId: string;
    if (existingMembership?.orgId) {
      // User already belongs to an org
      orgId = existingMembership.orgId;
    } else {
      // Create new organization for this user
      const proposedName =
        orgNameFromBody || ctRow.orgName || "Aroha Client";

      const baseSlug =
        proposedName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "") || "org";

      // Make sure slug is unique
      let slug = baseSlug;
      for (let i = 1; ; i++) {
        const clash = await prisma.organization.findUnique({
          where: { slug },
        });
        if (!clash) break;
        slug = `${baseSlug}-${i}`;
      }

      const org = await prisma.organization.create({
        data: {
          name: proposedName,
          slug,
          timezone: "Pacific/Auckland",
          plan: ctRow.plan ?? "STARTER", // defaults to STARTER if not set
        },
      });
      orgId = org.id;

      await prisma.membership.create({
        data: {
          userId: user.id,
          orgId,
          role: "owner",
        },
      });
    }

    // ───────────────────────────────────────────────
    // Mark token as used
    // ───────────────────────────────────────────────
    await prisma.checkoutToken.update({
      where: { token },
      data: {
        usedAt: new Date(),
        status: "USED",
        orgId,
      },
    });

    // ───────────────────────────────────────────────
    // Return success
    // ───────────────────────────────────────────────
    return NextResponse.json({
      ok: true,
      message: "Account setup complete. You may now sign in.",
    });
  } catch (err) {
    console.error("❌ complete registration error:", err);
    return NextResponse.json(
      { ok: false, error: "Server error" },
      { status: 500 }
    );
  }
}
