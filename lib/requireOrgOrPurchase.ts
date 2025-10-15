// lib/requireOrgOrPurchase.ts
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client"; // ✅ Single correct import for both enums + types

export type RequireResult = {
  isSuperAdmin: boolean;
  org: { id: string; name: string; slug: string } | null;
  membershipId: string | null;
  purchaseToken: string | null;
};

/** SUPERADMIN list from env. Example: SUPERADMINS="you@domain.com,support@arohacalls.com" */
function isSuperAdmin(email?: string | null): boolean {
  if (!email) return false;
  const list = (process.env.SUPERADMINS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

/** Normalize a name to a slug; adds a numeric suffix if needed */
function toSlug(base: string): string {
  const s = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 60);
  return s || "org";
}

/**
 * Ensure a superadmin has at least one Owner membership.
 * - Creates (or reuses) a single “HQ” organization.
 * - Ensures the user exists and is Owner in that org.
 * - Idempotent & safe under concurrency via upserts/transactions.
 */
async function ensureSuperadminOrg(email: string) {
  const defaultName = process.env.SUPERADMIN_ORG_NAME?.trim() || "Aroha HQ";
  const defaultSlugBase = process.env.SUPERADMIN_ORG_SLUG?.trim() || "aroha-hq";
  const slugCandidate = toSlug(defaultSlugBase);

  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // 1) Ensure org exists (try exact slug first; if taken, generate a suffix)
    let org = await tx.organization.findUnique({ where: { slug: slugCandidate } });

    if (!org) {
      let attempt = 0;
      let slug = slugCandidate;

      while (attempt < 5) {
        try {
          org = await tx.organization.create({
            data: {
              name: defaultName,
              slug,
              // ✅ Reference enum safely through Prisma namespace
              plan: (Prisma as any)?.Plan?.PREMIUM ?? "PREMIUM",
              smsActive: false,
              dashboardConfig: {},
            },
          });
          break;
        } catch (e) {
          attempt += 1;
          slug = `${slugCandidate}-${attempt}`;
          if (attempt >= 5) throw e;
        }
      }
    }

    // 2) Ensure user exists
    const user = await tx.user.upsert({
      where: { email },
      update: {},
      create: { email, name: "Superadmin" },
    });

    // 3) Ensure membership as owner
    let membership = await tx.membership.findFirst({
      where: { userId: user.id, orgId: org!.id },
    });

    if (!membership) {
      membership = await tx.membership.create({
        data: { userId: user.id, orgId: org!.id, role: "owner" },
      });
    } else if (membership.role !== "owner") {
      membership = await tx.membership.update({
        where: { id: membership.id },
        data: { role: "owner" },
      });
    }

    return { org: org!, membership };
  });

  return result;
}

/**
 * Ensures the current signed-in user either:
 *  - belongs to an org (returns it), OR
 *  - has a valid purchase token (so UI can send them to /register?token=...), OR
 *  - is a SUPERADMIN (auto-ensure an Owner org and return it).
 *
 * Otherwise redirects to /unauthorized.
 */
export async function requireOrgOrPurchase(): Promise<RequireResult> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? null;
  if (!email) redirect("/login");

  // ── SUPERADMIN BYPASS ─────────────────────────────────────────
  if (isSuperAdmin(email)) {
    const existing = await prisma.membership.findFirst({
      where: { user: { email } },
      include: { org: true },
    });

    const ensured =
      existing?.org
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

  // ── NORMAL FLOW: has an org already? ─────────────────────────
  const membership = await prisma.membership.findFirst({
    where: { user: { email } },
    include: { org: true },
  });

  if (membership?.org) {
    return {
      isSuperAdmin: false,
      org: { id: membership.org.id, name: membership.org.name, slug: membership.org.slug },
      membershipId: membership.id,
      purchaseToken: null,
    };
  }

  // ── Otherwise: look for an active purchase token ─────────────
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

  redirect("/unauthorized");
}
