// lib/requireOrgOrPurchase.ts
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

export async function requireOrgOrPurchase() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    redirect("/api/auth/signin");
  }

  const email = session.user.email;

  // 1️⃣ Check if user already belongs to an organisation
  const membership = await prisma.membership.findFirst({
    where: { user: { email } },
    include: { org: true },
  });

  if (membership?.org) {
    return { org: membership.org, hasPurchase: true };
  }

  // 2️⃣ Otherwise check for a valid purchase (Shopify webhook entry)
  const purchase = await prisma.checkoutToken.findFirst({
    where: {
      email,
      redeemedAt: null, // optional: if you add this column
      expiresAt: { gt: new Date() }, // optional safety
    },
  });

  if (!purchase) {
    // User neither has org nor valid purchase — unauthorized
    redirect("/unauthorized");
  }

  // 3️⃣ They’ve bought it but haven’t finished onboarding yet
  return { org: null, hasPurchase: true };
}
