// app/layout.tsx
import "./globals.css";
import React from "react";
import Header from "@/components/Header";          // ← login/logout on every page
import Sidebar from "@/components/Sidebar";        // ← your existing sidebar
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireOrgOrPurchase } from "@/lib/requireOrgOrPurchase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // default: no sidebar for anonymous / non-customers
  let showSidebar = false;

// ✅ layout.tsx — restrict sidebar to paying / active-org users only
try {
  const session = await getServerSession(authOptions);
  if (session?.user?.email) {
    const res = await requireOrgOrPurchase();

    // show sidebar ONLY if user has a valid, active org (means they've paid + finished setup)
    const hasPaidAndSetup =
      Boolean(res.org) || res.isSuperAdmin; // superadmins always see it

    showSidebar = hasPaidAndSetup;
  }
} catch {
  showSidebar = false;
}

  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-zinc-900 antialiased">
        {/* Global header is always visible */}
        <Header />

        <div className="max-w-6xl mx-auto px-4 py-6 flex gap-6">
          {/* Sidebar only when eligible */}
          {showSidebar ? (
            <aside className="w-64 shrink-0 hidden md:block">
              <Sidebar />
            </aside>
          ) : null}

          {/* Main content */}
          <main className="flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
