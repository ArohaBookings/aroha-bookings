// components/sidebar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";

/* ────────────────────────────────────────────────
   Tiny inline icons (no external deps)
──────────────────────────────────────────────── */
const Icon = {
  dashboard: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M3 3h8v8H3V3Zm10 0h8v5h-8V3ZM3 13h8v8H3v-8Zm10 7v-9h8v9h-8Z" />
    </svg>
  ),
  calendar: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M7 2v2H5a2 2 0 0 0-2 2v2h18V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7Zm14 8H3v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V10ZM7 14h4v4H7v-4Z" />
    </svg>
  ),
  users: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M16 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm-8 1a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-3.33 0-6 1.34-6 3v2h8v-2c0-1.66-2.67-3-6-3Zm8 0c-1.7 0-3.2.37-4.29.99A3.52 3.52 0 0 1 14 18v2h8v-2c0-1.84-3.13-3-6-3Z" />
    </svg>
  ),
  settings: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M12 8a4 4 0 1 0 4 4 4.005 4.005 0 0 0-4-4Zm9.4 4a7.9 7.9 0 0 0-.17-1.64l2.16-1.69-2-3.46-2.62 1a8.27 8.27 0 0 0-2.84-1.65l-.44-2.78H8.51l-.44 2.78A8.27 8.27 0 0 0 5.23 6.2l-2.62-1-2 3.46 2.16 1.69A7.9 7.9 0 0 0 2.6 12a7.9 7.9 0 0 0 .17 1.64L.61 15.33l2 3.46 2.62-1a8.27 8.27 0 0 0 2.84 1.65l.44 2.78h6.98l.44-2.78a8.27 8.27 0 0 0 2.84-1.65l2.62 1 2-3.46-2.16-1.69A7.9 7.9 0 0 0 21.4 12Z" />
    </svg>
  ),
  logout: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M10 17v-2h4v-2h-4V9L6 12l4 3ZM20 3H8a2 2 0 0 0-2 2v4h2V5h12v14H8v-4H6v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Z" />
    </svg>
  ),
  mail: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M2 6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v.4l-10 6-10-6V6Zm0 3.25V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9.25l-9.4 5.64a2 2 0 0 1-2.2 0L2 9.25Z" />
    </svg>
  ),
  magic: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="m3 17 9-9 4 4-9 9H3v-4Zm13-9 2-2 3 3-2 2-3-3Z" />
    </svg>
  ),
  review: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M4 4h16v12H6l-2 2V4Zm3 4h10v2H7V8Zm0 4h7v2H7v-2Z" />
    </svg>
  ),
  log: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M5 3h10a4 4 0 0 1 4 4v10h-2V7a2 2 0 0 0-2-2H7v14h12v2H7a2 2 0 0 1-2-2V3Z" />
    </svg>
  ),
  chevron: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="m8.6 9.2 3.4 3.4 3.4-3.4 1.4 1.4-4.8 4.8L7.2 10.6l1.4-1.4Z" />
    </svg>
  ),
} as const;

/* ────────────────────────────────────────────────
   Base nav
──────────────────────────────────────────────── */
const NAV = [
  { label: "Dashboard", href: "/dashboard", icon: Icon.dashboard },
  { label: "Calendar", href: "/calendar", icon: Icon.calendar },
  { label: "Clients", href: "/clients", icon: Icon.users },
  { label: "Settings", href: "/settings", icon: Icon.settings },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard" || pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-auto inline-flex min-w-[16px] items-center justify-center rounded-full bg-teal-500/20 px-1.5 text-[10px] font-medium text-teal-300">
      {children}
    </span>
  );
}

/* ────────────────────────────────────────────────
   Collapsible section state persisted to localStorage
──────────────────────────────────────────────── */
function usePersistedToggle(key: string, initial: boolean) {
  const [open, setOpen] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return initial;
    const raw = window.localStorage.getItem(key);
    return raw === null ? initial : raw === "1";
  });
  React.useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(key, open ? "1" : "0");
    }
  }, [key, open]);
  return [open, setOpen] as const;
}

/* ────────────────────────────────────────────────
   Hook: poll review-queue count
   Expects /api/email-ai/stats to return something like:
   { ok: true, reviewQueueCount: number }
──────────────────────────────────────────────── */
function useReviewQueueCount() {
  const [count, setCount] = React.useState<number | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    const readCountFromJson = (j: any): number | null => {
      if (!j) return null;
      if (typeof j.reviewQueueCount === "number") return j.reviewQueueCount;
      if (typeof j.reviewQueue === "number") return j.reviewQueue;
      if (typeof j.queuedForReview === "number") return j.queuedForReview;
      return null;
    };

    async function load() {
      try {
        const res = await fetch("/api/email-ai/stats", { cache: "no-store" });
        if (!res.ok) return;
        const j = await res.json();
        const n = readCountFromJson(j);
        if (!cancelled && typeof n === "number") setCount(n);
      } catch {
        // silent fail – just don't show a badge
      }
    }

    load();
    const timer = setInterval(load, 30_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return count;
}

/* ────────────────────────────────────────────────
   Sidebar
──────────────────────────────────────────────── */
export default function Sidebar(): React.ReactElement {
  const pathname = usePathname() || "/";
  const [emailOpen, setEmailOpen] = usePersistedToggle("__ar_email_ai_open", true);
  const reviewCount = useReviewQueueCount();

  const hasReviewItems = typeof reviewCount === "number" && reviewCount > 0;
  const reviewBadge =
    hasReviewItems && reviewCount > 99
      ? "99+"
      : hasReviewItems
      ? String(reviewCount)
      : null;

  return (
    <aside
      className="w-60 h-screen bg-gray-900 text-white flex flex-col sticky top-0"
      aria-label="Sidebar navigation"
    >
      {/* Brand */}
      <div className="flex items-center justify-between p-3">
        <Link
          href="/"
          className="flex items-center gap-2 font-bold tracking-tight focus:outline-none focus:ring-2 focus:ring-teal-400 rounded"
          aria-label="Aroha Bookings home"
        >
          <span className="inline-flex h-8 w-8 items-center justify-center rounded bg-teal-500 text-gray-900 font-black">
            A
          </span>
          <span className="text-sm">Aroha Bookings</span>
        </Link>
      </div>

      {/* Main nav */}
      <nav className="flex-1 px-2 py-2 space-y-1" role="navigation">
        {NAV.map((item) => {
          const active = isActive(pathname, item.href);
          const IconEl = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={[
                "group relative flex items-center gap-3 rounded px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400",
                active
                  ? "bg-gray-800 text-teal-300"
                  : "text-gray-300 hover:text-white hover:bg-gray-800",
              ].join(" ")}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r bg-teal-400"
                />
              )}
              <IconEl className="h-4 w-4 shrink-0 fill-current" aria-hidden />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}

        {/* Email AI group */}
        <div
          className={[
            "mt-4 pt-4 border-t border-white/10",
            hasReviewItems ? "bg-gray-900/40 rounded-t" : "",
          ].join(" ")}
        >
          <button
            type="button"
            onClick={() => setEmailOpen((v) => !v)}
            className="w-full flex items-center justify-between rounded px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 hover:text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-400"
            aria-expanded={emailOpen}
            aria-controls="email-ai-group"
          >
            <span className="flex items-center gap-2">
              <Icon.mail className="h-4 w-4 fill-current" aria-hidden />
              Email AI
              {reviewBadge ? (
                <span className="ml-1 rounded-full bg-teal-500/20 px-1.5 text-[10px] font-semibold text-teal-300">
                  {reviewBadge}
                </span>
              ) : null}
            </span>
            <Icon.chevron
              className={[
                "h-4 w-4 transition-transform",
                emailOpen ? "rotate-180" : "",
              ].join(" ")}
              aria-hidden
            />
          </button>

          <ul
            id="email-ai-group"
            className={[
              "mt-2 space-y-1 overflow-hidden transition-[max-height,opacity]",
              emailOpen ? "max-h-96 opacity-100" : "max-h-0 opacity-0",
            ].join(" ")}
          >
            {[
              { href: "/email-ai", label: "Connect", icon: Icon.mail },
              { href: "/email-ai/settings", label: "Settings", icon: Icon.settings },
              {
                href: "/email-ai/review",
                label: "Review queue",
                icon: Icon.review,
                badge: reviewBadge,
              },
              { href: "/email-ai/logs", label: "Logs", icon: Icon.log },
            ].map((item) => {
              const active = isActive(pathname, item.href);
              const IconEl = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={[
                      "group relative ml-6 flex items-center gap-3 rounded px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400",
                      active
                        ? "bg-gray-800 text-teal-300"
                        : "text-gray-300 hover:text-white hover:bg-gray-800",
                    ].join(" ")}
                  >
                    {active && (
                      <span
                        aria-hidden
                        className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r bg-teal-400"
                      />
                    )}
                    <IconEl className="h-4 w-4 shrink-0 fill-current" aria-hidden />
                    <span className="truncate">{item.label}</span>
                    {item.badge ? <Badge>{item.badge}</Badge> : null}
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Quick action → takes you to the dedicated Run Poll page */}
          <Link
            href="/email-ai/run-poll"
            className="mt-2 ml-6 inline-flex items-center gap-2 rounded px-2 py-1.5 text-xs text-teal-300 hover:text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-400"
            title="Open Email AI poll runner"
          >
            <Icon.magic className="h-3.5 w-3.5 fill-current" aria-hidden />
            Run poll
          </Link>
        </div>
      </nav>

      {/* Footer actions */}
      <div className="px-2 py-3 mt-auto border-t border-white/10">
        <Link
          href="/logout"
          className="flex items-center gap-3 rounded px-2 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-400"
        >
          <Icon.logout className="h-4 w-4 shrink-0 fill-current" aria-hidden />
          <span>Log out</span>
        </Link>
        <a
          href="/#support"
          className="mt-2 block rounded px-2 py-2 text-xs text-gray-400 hover:text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-400"
        >
          Need help? Contact support
        </a>
      </div>
    </aside>
  );
}
