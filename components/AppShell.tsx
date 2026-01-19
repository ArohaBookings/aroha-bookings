// FILE MAP: app layout at app/layout.tsx; Retell webhook at app/api/webhooks/voice/[provider]/[orgId]/route.ts.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";
import AppSidebar from "@/components/AppSidebar";
import BrandLogo from "@/components/BrandLogo";
import { brandPrimary, type BrandingConfig } from "@/lib/branding";
import type { OrgEntitlements } from "@/lib/entitlements";

type AppShellProps = {
  children: React.ReactNode;
  user: { name?: string | null; email?: string | null } | null;
  org: { id: string; name: string; slug: string } | null;
  isSuperAdmin: boolean;
  branding?: BrandingConfig | null;
  managePlanUrl?: string | null;
  entitlements?: OrgEntitlements | null;
};

function safeInitials(input?: string | null): string {
  if (!input) return "U";
  try {
    const parts = input
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s?.[0]?.toUpperCase() ?? "");
    return parts.join("") || "U";
  } catch {
    return "U";
  }
}

function usePersistedBool(key: string, initial: boolean) {
  const [val, setVal] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return initial;
    const raw = window.localStorage.getItem(key);
    return raw === null ? initial : raw === "1";
  });
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(key);
    setVal(raw === null ? initial : raw === "1");
  }, [key, initial]);
  React.useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(key, val ? "1" : "0");
  }, [key, val]);
  return [val, setVal] as const;
}

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export default function AppShell({
  children,
  user,
  org,
  isSuperAdmin,
  branding,
  managePlanUrl,
  entitlements,
}: AppShellProps) {
  const pathname = usePathname();
  const storageKey = React.useMemo(
    () => `__ar_sidebar_collapsed_${org?.id || "org"}_${user?.email || "user"}`,
    [org?.id, user?.email]
  );
  const [collapsed, setCollapsed] = usePersistedBool(storageKey, false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    const favicon = branding?.faviconUrl || "/branding/logo.svg";
    const link = document.querySelector<HTMLLinkElement>("link[rel='icon']") || document.createElement("link");
    link.rel = "icon";
    link.href = favicon;
    document.head.appendChild(link);
  }, [branding?.faviconUrl]);

  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  React.useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const initials = safeInitials(user?.name || user?.email);
  const orgLabel = org?.name || "No org yet";

  return (
    <div
      className="min-h-screen bg-zinc-100 text-zinc-900"
      style={{ ["--brand-primary" as any]: brandPrimary(branding) }}
    >
      <div className="flex min-h-screen">
        <div className="hidden lg:flex">
          <AppSidebar
            collapsed={collapsed}
            onCollapseToggle={() => setCollapsed((v) => !v)}
            isSuperAdmin={isSuperAdmin}
            branding={branding}
            managePlanUrl={managePlanUrl}
            entitlements={entitlements}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b border-zinc-200/70 bg-white/80 backdrop-blur">
            <div className="flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setMobileOpen(true)}
                  className="lg:hidden inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-700 shadow-sm hover:bg-zinc-50"
                  aria-label="Open navigation"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden>
                    <path d="M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h16v2H4v-2Z" />
                  </svg>
                </button>

                {collapsed && (
                  <button
                    type="button"
                    onClick={() => setCollapsed(false)}
                    className="hidden lg:inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-700 shadow-sm hover:bg-zinc-50"
                    aria-label="Expand sidebar"
                    title="Expand sidebar"
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden>
                      <path d="M5 4h2v16H5V4Zm4 8 8-8v5h2V2H10v2h5l-8 8 8 8h-5v2h9v-7h-2v5l-8-8Z" />
                    </svg>
                  </button>
                )}

                <Link href="/dashboard" className="flex items-center gap-3" aria-label="Aroha Bookings">
                  <BrandLogo
                    branding={branding}
                    showWordmark={false}
                    chrome="header"
                    className="max-w-[320px]"
                  />
                </Link>
              </div>

              <div className="flex items-center gap-3">
                <Link
                  href="/settings"
                  className="hidden md:inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm hover:border-emerald-200 hover:bg-emerald-50"
                  aria-label="Organization settings"
                  title="Organization settings"
                >
                  <span className="h-2 w-2 rounded-full" aria-hidden style={{ backgroundColor: "var(--brand-primary)" }} />
                  {orgLabel}
                </Link>

                <div className="hidden sm:flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-2.5 py-1 shadow-sm">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">
                    {initials}
                  </span>
                  <div className="hidden md:block max-w-[160px] truncate text-xs text-zinc-600">
                    {user?.name || user?.email || "Account"}
                  </div>
                </div>

                <Link
                  href="/logout"
                  className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 shadow-sm hover:border-zinc-300 hover:bg-zinc-50"
                >
                  Log out
                </Link>
              </div>
            </div>
          </header>

          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto w-full max-w-6xl">{children}</div>
          </main>

          <footer className="border-t border-zinc-200/70 bg-white/70 px-4 py-4 text-xs text-zinc-500 sm:px-6 lg:px-8">
            <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3">
              <a href="/terms" className="hover:text-zinc-800">Terms</a>
              <a href="/privacy" className="hover:text-zinc-800">Privacy</a>
              <a
                href="https://instagram.com/aroha_calls"
                target="_blank"
                rel="noreferrer"
                className="hover:text-zinc-800"
              >
                Instagram
              </a>
            </div>
          </footer>
        </div>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" aria-modal="true" role="dialog">
          <div
            className="absolute inset-0 bg-zinc-950/50"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div className="relative h-full w-80 max-w-[80vw]">
            <AppSidebar
              collapsed={false}
              onCollapseToggle={() => setCollapsed((v) => !v)}
              isSuperAdmin={isSuperAdmin}
              branding={branding}
              managePlanUrl={managePlanUrl}
              entitlements={entitlements}
              onNavigate={() => setMobileOpen(false)}
              showCollapse
            />
          </div>
        </div>
      )}
    </div>
  );
}
