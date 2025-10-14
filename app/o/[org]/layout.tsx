import React from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getOrgBySlug, assertMembership } from "@/lib/org";

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { org: string };
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/api/auth/signin");

  const org = await getOrgBySlug(params.org);
  if (!org) notFound();

  // ensure the signed-in user belongs to this org
  const isMember = await assertMembership((session as any).userId, org.id);
  if (!isMember) redirect("/onboarding"); // or show 403

  // Optional: provide org info to all child pages via context (simple prop drilling here)
  return (
    <div className="min-h-screen bg-zinc-50">
      {/* simple top bar */}
      <header className="h-12 border-b bg-white flex items-center justify-between px-4">
        <div className="font-medium">
          {org.name} <span className="text-zinc-500">({org.slug})</span>
        </div>
        <nav className="text-sm flex gap-3">
          <a className="hover:underline" href={`/o/${org.slug}/dashboard`}>Dashboard</a>
          <a className="hover:underline" href={`/o/${org.slug}/settings`}>Settings</a>
        </nav>
      </header>
      <main className="max-w-6xl mx-auto p-6">{children}</main>
    </div>
  );
}
