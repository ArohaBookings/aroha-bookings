// app/register/complete/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hash } from "bcryptjs";

export const runtime = "nodejs";

/**
 * POST /register/complete
 *
 * Finalises a user's setup after purchasing via Shopify.
 * - Validates the checkout token (exists, not used, not expired)
 * - Upserts a User record for the token email
 * - Creates or links an Organization and Membership
 * - Marks the checkout token as USED
 *
 * Supports both:
 * - JSON requests (returns JSON)
 * - Form submissions (redirects to /login?setup=complete)
 */
export async function POST(req: Request) {
  try {
    // ───────────────────────────────────────────────
    // 1) Parse incoming body (JSON or FormData)
    // ───────────────────────────────────────────────
    let token = "";
    let password = "";
    let emailFromBody = "";
    let orgNameFromBody = "";

    const ct = req.headers.get("content-type") || "";

    if (ct.includes("application/json")) {
      const body = await req.json().catch(() => ({} as any));
      token = String(body.token || "");
      password = String(body.password || "");
      emailFromBody = String(body.email || "");
      orgNameFromBody = String(body.orgName || "");
    } else {
      const fd = await req.formData();
      token = String(fd.get("token") || "");
      password = String(fd.get("password") || "");
      orgNameFromBody = String(fd.get("orgName") || "");
      // Email comes from checkoutToken; we *ignore* any email field in the form
    }

    if (!token || !password) {
      return jsonOrRedirect(req, {
        status: 400,
        payload: { ok: false, error: "Missing required fields." },
      });
    }

    // ───────────────────────────────────────────────
    // 2) Validate checkout token
    // ───────────────────────────────────────────────
    const ctRow = await prisma.checkoutToken.findUnique({ where: { token } });

    if (!ctRow) {
      return jsonOrRedirect(req, {
        status: 400,
        payload: { ok: false, error: "Invalid or unknown token." },
      });
    }

    const usedAt = ctRow.usedAt ?? null;
    const expired =
      !!ctRow.expiresAt && ctRow.expiresAt.getTime() < Date.now();

    if (usedAt) {
      return jsonOrRedirect(req, {
        status: 400,
        payload: { ok: false, error: "Token already used." },
      });
    }

    if (expired) {
      return jsonOrRedirect(req, {
        status: 400,
        payload: { ok: false, error: "Token expired." },
      });
    }

    const email = (ctRow.email || emailFromBody || "").toLowerCase();

    if (!email) {
      return jsonOrRedirect(req, {
        status: 400,
        payload: {
          ok: false,
          error: "Missing email (token not linked to an order).",
        },
      });
    }

    // ───────────────────────────────────────────────
    // 3) Upsert User (store hashed password)
    // ───────────────────────────────────────────────
    const hashed = await hash(password, 10);

    // Your User model has `password String?`, so we store the hash there.
    const user = await prisma.user.upsert({
      where: { email },
      update: {
        password: hashed,
      },
      create: {
        email,
        name: email.split("@")[0],
        password: hashed,
      },
    });

    // ───────────────────────────────────────────────
    // 4) Link / create Organization + Membership
    // ───────────────────────────────────────────────
    let orgId: string | null = null;

    // Prefer existing membership if they already belong to an org
    const existingMembership = await prisma.membership.findFirst({
      where: { userId: user.id },
    });

    if (existingMembership?.orgId) {
      orgId = existingMembership.orgId;
    } else if (ctRow.orgId) {
      // If the token was already tied to an org, reuse it
      orgId = ctRow.orgId;

      // Ensure membership exists
      const maybeExisting = await prisma.membership.findFirst({
        where: { userId: user.id, orgId },
      });
      if (!maybeExisting) {
        await prisma.membership.create({
          data: {
            userId: user.id,
            orgId,
            role: "owner",
          },
        });
      }
    } else {
      // Create a brand new org for this customer
      const proposedName =
        orgNameFromBody || ctRow.orgName || "Aroha Client";

      const baseSlug =
        proposedName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "") || "org";

      // Make slug unique
      let slug = baseSlug;
      for (let i = 1; ; i++) {
        const clash = await prisma.organization.findUnique({ where: { slug } });
        if (!clash) break;
        slug = `${baseSlug}-${i}`;
      }

      const org = await prisma.organization.create({
        data: {
          name: proposedName,
          slug,
          timezone: "Pacific/Auckland",
          plan: ctRow.plan ?? "STARTER", // Prisma enum Plan
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

    // Safety check – orgId should never be null here, but guard anyway
    if (!orgId) {
      return jsonOrRedirect(req, {
        status: 500,
        payload: {
          ok: false,
          error: "Could not determine organization for this account.",
        },
      });
    }

    // ───────────────────────────────────────────────
    // 5) Mark token as USED + bind orgId
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
    // 6) Success → JSON or redirect
    // ───────────────────────────────────────────────
    return jsonOrRedirect(req, {
      status: 200,
      payload: {
        ok: true,
        message: "Account setup complete. You may now sign in.",
      },
    });
  } catch (err) {
    console.error("❌ complete registration error:", err);
    return jsonOrRedirect(req, {
      status: 500,
      payload: { ok: false, error: "Server error. Please try again later." },
    });
  }
}

/**
 * Helper: if request looks like a browser form submit, redirect.
 * If it looks like an API / JSON caller, return JSON.
 */
function jsonOrRedirect(
  req: Request,
  opts: { status: number; payload: any },
): NextResponse {
  const ct = req.headers.get("content-type") || "";

  const wantsJson =
    ct.includes("application/json") ||
    req.headers.get("accept")?.includes("application/json");

  if (wantsJson) {
    return NextResponse.json(opts.payload, { status: opts.status });
  }

  // For form submissions, redirect back to login with status flag
  const url = new URL("/login", req.url);
  if (opts.status === 200) {
    url.searchParams.set("setup", "complete");
  } else {
    url.searchParams.set("error", "registration_failed");
  }
  return NextResponse.redirect(url);
}
