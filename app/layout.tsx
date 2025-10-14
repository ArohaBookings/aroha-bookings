// app/layout.tsx
import "./globals.css";
import React from "react";
import Header from "@/components/Header";          // ← login/logout on every page
import Sidebar from "@/components/Sidebar";        // ← your existing sidebar
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireOrgOrPurchase } from "@/lib/requireOrgOrPurchase";

export const runtime = "nodejs";

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // default: no sidebar for anonymous / non-customers
  let showSidebar = false;

  // check session, then purchase/org — but never throw from layout
  try {
    const session = await getServerSession(authOptions);
    if (session?.user?.email) {
      const { hasPurchase, org } = await requireOrgOrPurchase();
      showSidebar = Boolean(hasPurchase && org);
    }
  } catch {
    // swallow any redirect/throw from helper; page components handle auth gating
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
