// app/layout.tsx
import "./globals.css";
import React from "react";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireOrgOrPurchase } from "@/lib/requireOrgOrPurchase";

export const runtime = "nodejs";


export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Default values
  let showSidebar = false;
  let hasAccess = false;

  try {
    const session = await getServerSession(authOptions);
    if (session?.user?.email) {
      const res = await requireOrgOrPurchase();
      hasAccess = Boolean(res.org) || res.isSuperAdmin;
      showSidebar = hasAccess;
    }
  } catch {
    showSidebar = false;
  }

  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col bg-gray-50 text-zinc-900 antialiased">
        {/* Global Header */}
        <Header />

        {/* Main layout container */}
        <div className="flex-1 flex w-full">
          {/* Sidebar (desktop only) */}
          {showSidebar && (
            <aside className="hidden md:flex flex-col w-64 bg-black text-white h-full">
              <div className="flex-1 overflow-y-auto">
                <Sidebar />
              </div>
              <footer className="p-4 border-t border-zinc-800 text-xs text-zinc-400">
                © {new Date().getFullYear()} Aroha Systems
              </footer>
            </aside>
          )}

          {/* Page content area */}
          <main className="flex-1 overflow-y-auto bg-white p-6 md:rounded-tl-lg">
            <div className="max-w-7xl mx-auto">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
