// lib/org.ts
import { prisma } from "@/lib/db";

/** Find an org by its slug (e.g. "modern-fade") */
export async function getOrgBySlug(slug: string) {
  return prisma.organization.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true },
  });
}

/** Returns true if the user is a member of the org */
export async function assertMembership(userId: string, orgId: string) {
  const m = await prisma.membership.findFirst({
    where: { userId, orgId },
    select: { id: true },
  });
  return !!m;
}
