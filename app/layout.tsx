// app/layout.tsx
import "./globals.css";
import React from "react";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireOrgOrPurchase } from "@/lib/requireOrgOrPurchase";
import Providers from "./providers";

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
    <html lang="en" className="h-full bg-gray-50">
      <body className="min-h-screen flex flex-col bg-gray-50 text-zinc-900 antialiased">
        {/* Client providers so useSession() works anywhere */}
        <Providers>
          {/* Global Header (unchanged) */}
          <Header />

          {/* Main shell */}
          <div className="flex-1 flex w-full">
            {/* Sidebar (desktop only) */}
            {showSidebar && (
              <aside
                className="hidden md:flex flex-col w-64 bg-black text-white h-full"
                aria-label="Main navigation"
              >
                <div className="flex-1 overflow-y-auto">
                  <Sidebar />
                </div>
                <footer className="p-4 border-t border-zinc-800 text-xs text-zinc-400">
                  © {new Date().getFullYear()} Aroha Systems
                </footer>
              </aside>
            )}

            {/* Content area */}
            <main
              id="content"
              role="main"
              className="flex-1 overflow-y-auto bg-white p-6 md:rounded-tl-lg"
            >
              {/* Keep your max width wrapper */}
              <div className="max-w-7xl mx-auto">{children}</div>
            </main>
          </div>

          {/* Global toasts/portals hook (no-op if you don’t have one yet) */}
          <div id="portal-root" />
        </Providers>
      </body>
    </html>
  );
}
