// app/o/[org]/layout.tsx
import React from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getOrgBySlug, assertMembership } from "@/lib/org";

export const runtime = "nodejs";


/** SUPERADMIN helper (reads comma-separated emails from env) */
function isSuperAdmin(email?: string | null) {
  if (!email) return false;
  const list = (process.env.SUPERADMINS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

export default async function OrgLayout({
  children,
  // 🔧 In Next 15+, params is a Promise in server layouts — we must await it.
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ org: string }>;
}) {
  // Resolve the dynamic segment
  const { org: orgSlug } = await params;

  // Require a signed-in user
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? null;
  if (!email) redirect("/login"); // keep consistent with your app’s login page

  // Fetch org by slug (404 if not found)
  const org = await getOrgBySlug(orgSlug);
  if (!org) notFound();

  // Gate: allow superadmin always; else require membership
  const superadmin = isSuperAdmin(email);
  if (!superadmin) {
    const userId = (session as any).userId as string | undefined;
    if (!userId) redirect("/login");
    const isMember = await assertMembership(userId, org.id);
    if (!isMember) redirect("/unauthorized"); // or /onboarding if you prefer
  }

  return <>{children}</>;
}
