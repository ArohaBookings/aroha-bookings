// FILE MAP: app layout at app/layout.tsx; Retell webhook at app/api/webhooks/voice/[provider]/[orgId]/route.ts.
// lib/requireOrgOrPurchase.ts
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { authOptions } from "@/lib/auth";
import { canAccessSuperAdminByEmail, isSuperAdminEmail } from "@/lib/roles";

/* ───────────────────────────────────────────────────────────────
   Types
─────────────────────────────────────────────────────────────── */
export type RequireResult = {
  isSuperAdmin: boolean;
  org: { id: string; name: string; slug: string } | null;
  membershipId: string | null;
  purchaseToken: string | null;
};

export type RequireOpts = {
  /**
   * Allow a signed-in user to proceed even if they don’t have an org
   * or purchase token yet (e.g. for /dashboard).
   * Defaults to false (strict).
   */
  allowWithoutOrg?: boolean;

  /**
   * If user is missing an org and not superadmin:
   *  - when allowWithoutOrg=false → redirectToIfNoOrg (default: "/unauthorized")
   *  - when allowWithoutOrg=true  → do NOT redirect; caller can render “no org” UI
   */
  redirectToIfNoOrg?: string;
};

/* ───────────────────────────────────────────────────────────────
   SUPERADMIN helpers
─────────────────────────────────────────────────────────────── */

/** SUPERADMIN list from env: SUPERADMIN_EMAILS or SUPERADMINS */

function toSlug(base: string): string {
  const s = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 60);
  return s || "org";
}

/**
 * Ensure a superadmin has a stable Owner membership in a single HQ org.
 * Idempotent & concurrency-safe.
 */
async function ensureSuperadminOrg(email: string) {
  const defaultName = process.env.SUPERADMIN_ORG_NAME?.trim() || "Aroha HQ";
  const defaultSlugBase = process.env.SUPERADMIN_ORG_SLUG?.trim() || "aroha-hq";
  const slugBase = toSlug(defaultSlugBase);

  const { org, membership } = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // 1) Find or create the HQ org
    let orgRow = await tx.organization.findUnique({ where: { slug: slugBase } });
    if (!orgRow) {
      let attempt = 0;
      let slug = slugBase;
      while (attempt < 5) {
        try {
          orgRow = await tx.organization.create({
            data: {
              name: defaultName,
              slug,
              // Use enum safely; fall back to string if your schema differs
              plan: (Prisma as any)?.Plan?.PREMIUM ?? "PREMIUM",
              smsActive: false,
              dashboardConfig: {},
            },
          });
          break;
        } catch (e) {
          attempt += 1;
          slug = `${slugBase}-${attempt}`;
          if (attempt >= 5) throw e;
        }
      }
    }

    // 2) Ensure user
    const user = await tx.user.upsert({
      where: { email },
      update: { role: "SUPERADMIN" },
      create: { email, name: "Superadmin", role: "SUPERADMIN" },
    });

    // 3) Ensure Owner membership
    let m = await tx.membership.findFirst({ where: { userId: user.id, orgId: orgRow!.id } });
    if (!m) {
      m = await tx.membership.create({ data: { userId: user.id, orgId: orgRow!.id, role: "owner" } });
    } else if (m.role !== "owner") {
      m = await tx.membership.update({ where: { id: m.id }, data: { role: "owner" } });
    }

    return { org: orgRow!, membership: m };
  });

  return { org, membership };
}

/* ───────────────────────────────────────────────────────────────
   Public API
─────────────────────────────────────────────────────────────── */

/**
 * Require session + (org OR purchase token).
 * - Superadmins always allowed (and auto-ensured into HQ org).
 * - Normal users:
 *     - If `allowWithoutOrg=true`, return with `org=null` (caller can show “create org / purchase” UI)
 *     - Else, redirect to `redirectToIfNoOrg` (default /unauthorized) when missing org & token
 */
export async function requireOrgOrPurchase(opts: RequireOpts = {}): Promise<RequireResult> {
  const { allowWithoutOrg = false, redirectToIfNoOrg = "/unauthorized" } = opts;

  // 1) Must be signed in
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? null;
  if (!email) {
    console.warn("[auth] requireOrgOrPurchase: no session");
    redirect("/login");
  }

  // 2) Superadmin bypass
  if (isSuperAdminEmail(email)) {
    const existing = await prisma.membership.findFirst({
      where: { user: { email } },
      include: { org: true },
    });

    const ensured = existing?.org
      ? { org: existing.org, membership: { id: existing.id } }
      : await ensureSuperadminOrg(email);

    return {
      isSuperAdmin: true,
      org: ensured.org
        ? { id: ensured.org.id, name: ensured.org.name, slug: ensured.org.slug }
        : null,
      membershipId: ensured.membership?.id ?? null,
      purchaseToken: null,
    };
  }

  // 3) Normal user: do they have an org already?
  const membership = await prisma.membership.findFirst({
    where: { user: { email } },
    include: { org: true },
  });

  if (membership?.org) {
    return {
      isSuperAdmin: await canAccessSuperAdminByEmail(email),
      org: { id: membership.org.id, name: membership.org.name, slug: membership.org.slug },
      membershipId: membership.id,
      purchaseToken: null,
    };
  }

  // 4) No org: do they have a valid purchase token?
  const purchase = await prisma.checkoutToken.findFirst({
    where: {
      email,
      usedAt: null,
      status: "NEW",
      expiresAt: { gt: new Date() },
    },
    select: { token: true },
  });

  if (purchase) {
    return {
      isSuperAdmin: false,
      org: null,
      membershipId: null,
      purchaseToken: purchase.token,
    };
  }

  // 5) Still no org/purchase: optionally allow (for routes like /dashboard)
  if (allowWithoutOrg) {
    return {
      isSuperAdmin: await canAccessSuperAdminByEmail(email),
      org: null,
      membershipId: null,
      purchaseToken: null,
    };
  }

  // Otherwise, block
  console.warn("[auth] requireOrgOrPurchase: no org or purchase", email);
  redirect(redirectToIfNoOrg);
}

/* ───────────────────────────────────────────────────────────────
   Usage notes
─────────────────────────────────────────────────────────────── */
/**
 * Example — /app/dashboard/page.tsx:
 *
 *   const { org, isSuperAdmin } = await requireOrgOrPurchase({ allowWithoutOrg: true });
 *   // You can render the dashboard even if org === null for normal users.
 *
 * Example — /app/calendar/page.tsx (strict):
 *
 *   const { org } = await requireOrgOrPurchase();
 *   // If they don’t have org or purchase, they’ll be redirected away.
 */
