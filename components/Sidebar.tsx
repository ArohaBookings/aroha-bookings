// components/sidebar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";
import { useSession } from "next-auth/react";

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
  phone: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M6.6 2h2.9l1.2 5-2.2 1.3a14.6 14.6 0 0 0 7.2 7.2l1.3-2.2 5 1.2v2.9c0 1.1-.9 2-2 2A18.3 18.3 0 0 1 2 4c0-1.1.9-2 2-2h2.6Z" />
    </svg>
  ),
  chart: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M4 19h16v2H2V3h2v16Zm4-6h2v4H8v-4Zm5-6h2v10h-2V7Zm5 3h2v7h-2v-7Z" />
    </svg>
  ),
  chevron: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="m8.6 9.2 3.4 3.4 3.4-3.4 1.4 1.4-4.8 4.8L7.2 10.6l1.4-1.4Z" />
    </svg>
  ),
  search: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M10 2a8 8 0 1 0 5.29 14.03l4.34 4.34 1.41-1.41-4.34-4.34A8 8 0 0 0 10 2Zm0 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12Z" />
    </svg>
  ),
  collapse: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M7 7h10v2H7V7Zm0 4h6v2H7v-2Zm0 4h10v2H7v-2Z" />
    </svg>
  ),
} as const;

/* ────────────────────────────────────────────────
   Base nav
──────────────────────────────────────────────── */
type NavItem = {
  label: string;
  href: string;
  icon: (p: React.SVGProps<SVGSVGElement>) => React.ReactElement;
  keywords?: string[];
};

const MAIN: readonly NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: Icon.dashboard, keywords: ["home", "overview"] },
  { label: "Calendar", href: "/calendar", icon: Icon.calendar, keywords: ["appointments", "schedule"] },
  { label: "Calls", href: "/calls", icon: Icon.phone, keywords: ["retell", "voice", "phone"] },
  { label: "Call analytics", href: "/analytics/calls", icon: Icon.chart, keywords: ["insights", "metrics"] },
  { label: "Clients", href: "/clients", icon: Icon.users, keywords: ["customers"] },
  { label: "Settings", href: "/settings", icon: Icon.settings, keywords: ["org", "account"] },
] as const;

const EMAIL_AI: readonly (NavItem & { badgeKey?: "review" })[] = [
  { href: "/email-ai", label: "Connect", icon: Icon.mail, keywords: ["gmail", "oauth"] },
  { href: "/email-ai/settings", label: "Settings", icon: Icon.settings, keywords: ["rules", "tone"] },
  { href: "/email-ai/review", label: "Review queue", icon: Icon.review, badgeKey: "review", keywords: ["approve", "pending"] },
  { href: "/email-ai/logs", label: "Logs", icon: Icon.log, keywords: ["history", "audit"] },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard" || pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/* ────────────────────────────────────────────────
   Persisted UI state
──────────────────────────────────────────────── */
function usePersistedBool(key: string, initial: boolean) {
  const [val, setVal] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return initial;
    const raw = window.localStorage.getItem(key);
    return raw === null ? initial : raw === "1";
  });
  React.useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(key, val ? "1" : "0");
  }, [key, val]);
  return [val, setVal] as const;
}

/* ────────────────────────────────────────────────
   Hook: poll review-queue count
──────────────────────────────────────────────── */
function useReviewQueueCount() {
  const [count, setCount] = React.useState<number | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    const readCountFromJson = (j: unknown): number | null => {
      if (!j || typeof j !== "object") return null;
      const record = j as Record<string, unknown>;
      if (typeof record.reviewQueueCount === "number") return record.reviewQueueCount;
      if (typeof record.reviewQueue === "number") return record.reviewQueue;
      if (typeof record.queuedForReview === "number") return record.queuedForReview;
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
        // silent
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

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-auto inline-flex min-w-[18px] items-center justify-center rounded-full bg-teal-500/20 px-1.5 text-[10px] font-semibold text-teal-200">
      {children}
    </span>
  );
}

function NavLink({
  collapsed,
  href,
  label,
  icon: IconEl,
  active,
  badge,
}: {
  collapsed: boolean;
  href: string;
  label: string;
  icon: NavItem["icon"];
  active: boolean;
  badge?: string | null;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm outline-none transition",
        "focus-visible:ring-2 focus-visible:ring-teal-400/70",
        active
          ? "bg-white/5 text-white"
          : "text-zinc-300 hover:bg-white/5 hover:text-white"
      )}
    >
      {/* Active rail */}
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r transition",
          active ? "bg-teal-400" : "bg-transparent group-hover:bg-teal-400/40"
        )}
      />
      <IconEl className="h-4 w-4 shrink-0 fill-current opacity-90" aria-hidden />
      {!collapsed && <span className="truncate">{label}</span>}
      {!collapsed && badge ? <Badge>{badge}</Badge> : null}
    </Link>
  );
}

export default function Sidebar(): React.ReactElement {
  const pathname = usePathname() || "/";
  const { data } = useSession();

  // Persisted UI
  const [collapsed, setCollapsed] = usePersistedBool("__ar_sidebar_collapsed", false);
  const [emailOpen, setEmailOpen] = usePersistedBool("__ar_email_ai_open", true);

  // Search filter (fast nav)
  const [q, setQ] = React.useState("");
  const query = q.trim().toLowerCase();

  // Badge
  const reviewCount = useReviewQueueCount();
  const hasReviewItems = typeof reviewCount === "number" && reviewCount > 0;
  const reviewBadge =
    hasReviewItems && reviewCount > 99 ? "99+" : hasReviewItems ? String(reviewCount) : null;

  // Superadmin gate (prefer role, fallback to email)
  const userRole = (data?.user as { role?: string } | null)?.role; // if you pass role into session
  const email = data?.user?.email?.toLowerCase();
  const isSuperAdmin = userRole === "SUPERADMIN" || email === "leoanthonybons@gmail.com";

  const filterItems = React.useCallback(
    (items: readonly NavItem[]) => {
      if (!query) return items;
      return items.filter((it) => {
        const hay = [it.label, it.href, ...(it.keywords ?? [])].join(" ").toLowerCase();
        return hay.includes(query);
      });
    },
    [query]
  );

  const mainFiltered = filterItems(MAIN);
  const emailFiltered = filterItems(EMAIL_AI);

  return (
    <aside
      className={cn(
        "sticky top-0 h-screen border-r border-white/10 bg-zinc-950 text-white",
        collapsed ? "w-[72px]" : "w-64"
      )}
      aria-label="Sidebar navigation"
    >
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className={cn("flex items-center gap-2 px-3 py-3", collapsed ? "justify-center" : "")}>
          <Link
            href="/"
            aria-label="Aroha Bookings home"
            className={cn(
              "flex items-center gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-teal-400/70",
              collapsed ? "justify-center" : ""
            )}
          >
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-teal-500 text-zinc-950 font-black shadow-sm shadow-teal-500/20">
              A
            </span>
            {!collapsed && (
              <div className="leading-tight">
                <div className="text-sm font-semibold tracking-tight">Aroha Bookings</div>
                <div className="text-[11px] text-zinc-400">Premium scheduling</div>
              </div>
            )}
          </Link>

          {!collapsed && <div className="ml-auto" />}

          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className={cn(
              "rounded-lg p-2 text-zinc-300 hover:bg-white/5 hover:text-white outline-none",
              "focus-visible:ring-2 focus-visible:ring-teal-400/70",
              collapsed ? "absolute right-2 top-3" : ""
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand" : "Collapse"}
          >
            <Icon.collapse className="h-4 w-4 fill-current" aria-hidden />
          </button>
        </div>

        {/* Search */}
        <div className={cn("px-3 pb-2", collapsed ? "hidden" : "")}>
          <div className="relative">
            <Icon.search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 fill-current text-zinc-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search…"
              className={cn(
                "w-full rounded-xl border border-white/10 bg-white/5 pl-9 pr-3 py-2 text-sm",
                "text-white placeholder:text-zinc-500 outline-none",
                "focus:border-teal-400/40 focus:ring-2 focus:ring-teal-400/20"
              )}
            />
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 pb-2">
          {!collapsed && (
            <div className="px-2 pb-2 pt-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Core
            </div>
          )}

          <div className="space-y-1">
            {mainFiltered.map((item) => (
              <NavLink
                key={item.href}
                collapsed={collapsed}
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={isActive(pathname, item.href)}
              />
            ))}
          </div>

          {/* Email AI section */}
          <div className={cn("mt-4", hasReviewItems ? "rounded-xl bg-white/3" : "")}>
            <div className={cn("px-1.5 pt-3", collapsed ? "pt-2" : "")}>
              <button
                type="button"
                onClick={() => setEmailOpen((v) => !v)}
                className={cn(
                  "w-full rounded-lg px-2.5 py-2 text-left outline-none transition",
                  "hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-teal-400/70"
                )}
                aria-expanded={emailOpen}
                aria-controls="email-ai-group"
                title={collapsed ? "Email AI" : undefined}
              >
                <div className="flex items-center gap-3">
                  <Icon.mail className="h-4 w-4 fill-current text-zinc-300" aria-hidden />
                  {!collapsed && (
                    <>
                      <span className="text-[12px] font-semibold uppercase tracking-wide text-zinc-400">
                        Email AI
                      </span>
                      {reviewBadge ? (
                        <span className="ml-1 rounded-full bg-teal-500/20 px-1.5 text-[10px] font-semibold text-teal-200">
                          {reviewBadge}
                        </span>
                      ) : null}
                      <span className="ml-auto" />
                      <Icon.chevron
                        className={cn("h-4 w-4 fill-current text-zinc-500 transition-transform", emailOpen ? "rotate-180" : "")}
                        aria-hidden
                      />
                    </>
                  )}
                </div>
              </button>
            </div>

            <div
              id="email-ai-group"
              className={cn(
                "px-1.5 pb-2 transition-[max-height,opacity] overflow-hidden",
                emailOpen ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
              )}
            >
<div className={cn("space-y-1", collapsed ? "pt-1" : "pt-2")}>
  {emailFiltered.map((item) => {
    const badge = item.href === "/email-ai/review" ? reviewBadge : null;

    return (
      <NavLink
        key={item.href}
        collapsed={collapsed}
        href={item.href}
        label={item.label}
        icon={item.icon}
        active={isActive(pathname, item.href)}
        badge={badge ?? undefined}
      />
    );
  })}
</div>


              {!collapsed ? null : null}
            </div>
          </div>

          {/* Super Admin */}
          {isSuperAdmin ? (
            <div className="mt-4 px-1.5">
              <Link
                href="/admin"
                className={cn(
                  "flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-semibold outline-none transition",
                  "text-red-300 hover:bg-red-900/20 hover:text-white focus-visible:ring-2 focus-visible:ring-red-400/60"
                )}
                title={collapsed ? "Super Admin" : undefined}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
                  <path d="M12 2 2 7v6c0 5 3.8 9.7 10 13 6.2-3.3 10-8 10-13V7l-10-5Z" />
                </svg>
                {!collapsed && <span>Super Admin</span>}
              </Link>
            </div>
          ) : null}
        </nav>

        {/* Footer */}
        <div className="border-t border-white/10 p-2">
          <Link
            href="/logout"
            className={cn(
              "flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm outline-none transition",
              "text-zinc-300 hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-teal-400/70"
            )}
            title={collapsed ? "Log out" : undefined}
          >
            <Icon.logout className="h-4 w-4 shrink-0 fill-current" aria-hidden />
            {!collapsed && <span>Log out</span>}
          </Link>

          {!collapsed && (
            <Link
              href="/#support"
              className="mt-1 block rounded-lg px-2.5 py-2 text-xs text-zinc-500 hover:bg-white/5 hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-teal-400/70"
            >
              Need help? Contact support
            </Link>
          )}
        </div>
      </div>
    </aside>
  );
}
