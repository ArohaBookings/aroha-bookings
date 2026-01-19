// FILE MAP: app layout at app/layout.tsx; Retell webhook at app/api/webhooks/voice/[provider]/[orgId]/route.ts.
// app/layout.tsx
import "./globals.css";
import React from "react";
import AppShell from "@/components/AppShell";
import Header from "@/components/Header";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireOrgOrPurchase } from "@/lib/requireOrgOrPurchase";
import Providers from "./providers";
import { prisma } from "@/lib/db";
import { resolveBranding, type BrandingConfig } from "@/lib/branding";
import { getOrgEntitlements, type OrgEntitlements } from "@/lib/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Optional but nice: metadata (won’t break anything) */
export const metadata = {
  title: "Aroha Bookings",
  description: "AI receptionist + booking system",
  viewport: "width=device-width, initial-scale=1, viewport-fit=cover",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // --- Your existing access logic (kept) ---
  let showShell = false;
  let org: { id: string; name: string; slug: string } | null = null;
  let isSuperAdmin = false;
  let user: { name?: string | null; email?: string | null } | null = null;
  let branding: BrandingConfig | null = null;
  let managePlanUrl: string | null = null;
  let entitlements: OrgEntitlements | null = null;

  try {
    const session = await getServerSession(authOptions);
    if (session?.user?.email) {
      const res = await requireOrgOrPurchase({ allowWithoutOrg: true });
      org = res.org;
      isSuperAdmin = res.isSuperAdmin;
      user = { name: session.user.name, email: session.user.email };
      showShell = true;
      if (org?.id) {
        const orgSettings = await prisma.orgSettings.findUnique({
          where: { orgId: org.id },
          select: { data: true },
        });
        const data = (orgSettings?.data as Record<string, unknown>) || {};
        branding = resolveBranding(data);
        const billing = (data.billing as Record<string, unknown>) || {};
        managePlanUrl =
          typeof billing.managePlanUrl === "string" && billing.managePlanUrl.trim()
            ? billing.managePlanUrl.trim()
            : null;
        entitlements = await getOrgEntitlements(org.id);
      }
    }
  } catch {
    showShell = false;
  }

  return (
    <html lang="en" className="h-full bg-gray-50">
      <body className="min-h-screen flex flex-col bg-gray-50 text-zinc-900 antialiased">
        {/* Client providers so useSession() works anywhere */}
        <Providers>
          {showShell ? (
            <AppShell
              user={user}
              org={org}
              isSuperAdmin={isSuperAdmin}
              branding={branding}
              managePlanUrl={managePlanUrl}
              entitlements={entitlements}
            >
              {children}
            </AppShell>
          ) : (
            <>
              <Header />
              <main id="content" role="main" className="flex-1 bg-white">
                <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
                  {children}
                </div>
              </main>
            </>
          )}

          {/* Global toasts/portals hook (no-op if you don’t have one yet) */}
          <div id="portal-root" />
        </Providers>
      </body>
    </html>
  );
}
