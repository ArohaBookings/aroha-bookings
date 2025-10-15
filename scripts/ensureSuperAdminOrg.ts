// scripts/ensureSuperAdminOrg.ts
import { PrismaClient, Prisma } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();

/** tiny slugger */
function toSlug(base: string) {
  return (base || "org")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 60);
}

async function main() {
  const superAdmins =
    (process.env.SUPERADMINS || "")
      .split(",")
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);

  // allow overriding with CLI:  npx tsx scripts/ensureSuperAdminOrg.ts you@domain.com
  const cliEmail = process.argv[2]?.trim().toLowerCase();
  const emails = cliEmail ? [cliEmail] : superAdmins;

  if (!emails.length) {
    throw new Error(
      "No SUPERADMINS configured. Add SUPERADMINS to your .env (comma-separated) or pass an email: npx tsx scripts/ensureSuperAdminOrg.ts you@domain.com"
    );
  }

  const defaultOrgName = process.env.SUPERADMIN_ORG_NAME?.trim() || "Aroha HQ";
  const defaultOrgSlugBase =
    process.env.SUPERADMIN_ORG_SLUG?.trim() || "aroha-hq";
  const defaultOrgSlug = toSlug(defaultOrgSlugBase);

  for (const email of emails) {
    console.log(`\n➡ Ensuring superadmin org for: ${email}`);

    // Ensure org exists (handle slug collisions with numeric suffix)
    let org = await prisma.organization.findUnique({
      where: { slug: defaultOrgSlug },
    });

    if (!org) {
      let attempt = 0;
      let slug = defaultOrgSlug;
      while (attempt < 5) {
        try {
          org = await prisma.organization.create({
            data: {
              name: defaultOrgName,
              slug,
              plan: (Prisma as any).Plan?.PREMIUM ?? ("PREMIUM" as any),
              smsActive: false,
              dashboardConfig: {}, // Json column
            },
          });
          break;
        } catch (e: any) {
          // retry with suffix if slug is taken
          attempt += 1;
          slug = `${defaultOrgSlug}-${attempt}`;
          if (attempt >= 5) throw e;
        }
      }
    }

    // Ensure user exists
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name: "Superadmin" },
    });

    // Ensure owner membership
    let membership = await prisma.membership.findFirst({
      where: { userId: user.id, orgId: org!.id },
    });

    if (!membership) {
      membership = await prisma.membership.create({
        data: { userId: user.id, orgId: org!.id, role: "owner" },
      });
      console.log(`✅ Added owner membership for ${email} in ${org!.slug}`);
    } else if (membership.role !== "owner") {
      await prisma.membership.update({
        where: { id: membership.id },
        data: { role: "owner" },
      });
      console.log(`✅ Upgraded ${email} to owner in ${org!.slug}`);
    } else {
      console.log(`✅ ${email} already owner in ${org!.slug}`);
    }

    console.log(`🏁 Org: ${org!.name} (${org!.slug})`);
  }
}

main()
  .catch((e) => {
    console.error("Script error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
