"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";
import BrandLogo from "@/components/BrandLogo";
import type { BrandingConfig } from "@/lib/branding";
import type { OrgEntitlements } from "@/lib/entitlements";

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
  inbox: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M4 4h16l2 10v6H2v-6L4 4Zm2.6 2L5 12h4l2 3h2l2-3h4l-1.6-6H6.6Z" />
    </svg>
  ),
  messages: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 3v-3H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm2 5h12v2H6V9Zm0 4h8v2H6v-2Z" />
    </svg>
  ),
  chart: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M4 19h16v2H2V3h2v16Zm4-6h2v4H8v-4Zm5-6h2v10h-2V7Zm5 3h2v7h-2v-7Z" />
    </svg>
  ),
  staff: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm7 9H5v-1c0-3.31 2.69-6 6-6h2c3.31 0 6 2.69 6 6v1Z" />
    </svg>
  ),
  spark: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="m12 2 2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2L12 2Z" />
    </svg>
  ),
  settings: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M12 8a4 4 0 1 0 4 4 4.005 4.005 0 0 0-4-4Zm9.4 4a7.9 7.9 0 0 0-.17-1.64l2.16-1.69-2-3.46-2.62 1a8.27 8.27 0 0 0-2.84-1.65l-.44-2.78H8.51l-.44 2.78A8.27 8.27 0 0 0 5.23 6.2l-2.62-1-2 3.46 2.16 1.69A7.9 7.9 0 0 0 2.6 12a7.9 7.9 0 0 0 .17 1.64L.61 15.33l2 3.46 2.62-1a8.27 8.27 0 0 0 2.84 1.65l.44 2.78h6.98l.44-2.78a8.27 8.27 0 0 0 2.84-1.65l2.62 1 2-3.46-2.16-1.69A7.9 7.9 0 0 0 21.4 12Z" />
    </svg>
  ),
  billing: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3H3V7Zm0 5h18v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm4 2v2h4v-2H7Z" />
    </svg>
  ),
  admin: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M12 2 2 7v6c0 5 3.8 9.7 10 13 6.2-3.3 10-8 10-13V7l-10-5Z" />
    </svg>
  ),
  collapse: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M7 7h10v2H7V7Zm0 4h6v2H7v-2Zm0 4h10v2H7v-2Z" />
    </svg>
  ),
} as const;

type NavItem = {
  label: string;
  href: string;
  icon: (p: React.SVGProps<SVGSVGElement>) => React.ReactElement;
  badge?: string | null;
  external?: boolean;
  locked?: boolean;
};

type NavGroup = {
  title: string;
  items: NavItem[];
};

const CORE: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: Icon.dashboard },
  { label: "Calendar", href: "/calendar", icon: Icon.calendar },
  { label: "Clients", href: "/clients", icon: Icon.users },
  { label: "Inbox", href: "/email-ai", icon: Icon.inbox },
  { label: "Messages", href: "/messages", icon: Icon.messages },
  { label: "Analytics", href: "/analytics/calls", icon: Icon.chart },
];

const OPS: NavItem[] = [
  { label: "Staff", href: "/staff", icon: Icon.staff },
  { label: "Services", href: "/services", icon: Icon.spark },
  { label: "Automations", href: "/automations", icon: Icon.spark },
  { label: "Settings", href: "/settings", icon: Icon.settings },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard" || pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

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

function NavLink({
  collapsed,
  item,
  active,
  onNavigate,
}: {
  collapsed: boolean;
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  if (item.locked) {
    return (
      <Link
        href="/settings"
        onClick={onNavigate}
        title={collapsed ? `${item.label} (upgrade)` : undefined}
        className={cn(
          "group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm outline-none transition",
          "focus-visible:ring-2 focus-visible:ring-emerald-400/70",
          "text-zinc-500 hover:bg-white/5 hover:text-white"
        )}
      >
        <span
          aria-hidden
          className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r bg-transparent"
        />
        <item.icon className="h-4 w-4 shrink-0 fill-current opacity-60" aria-hidden />
        {!collapsed && (
          <>
            <span className="truncate">{item.label}</span>
            <span className="ml-auto rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-zinc-400">
              Upgrade
            </span>
          </>
        )}
      </Link>
    );
  }
  if (item.external) {
    return (
      <a
        href={item.href}
        onClick={onNavigate}
        target="_blank"
        rel="noreferrer"
        title={collapsed ? item.label : undefined}
        className={cn(
          "group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm outline-none transition",
          "focus-visible:ring-2 focus-visible:ring-emerald-400/70",
          "text-zinc-300 hover:bg-white/5 hover:text-white"
        )}
      >
        <span
          aria-hidden
          className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r bg-transparent group-hover:bg-emerald-400/40"
        />
        <item.icon className="h-4 w-4 shrink-0 fill-current opacity-90" aria-hidden />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </a>
    );
  }
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm outline-none transition",
        "focus-visible:ring-2 focus-visible:ring-emerald-400/70",
        active
          ? "bg-white/10 text-white"
          : "text-zinc-300 hover:bg-white/5 hover:text-white"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r transition",
          active ? "bg-emerald-400" : "bg-transparent group-hover:bg-emerald-400/40"
        )}
      />
      <item.icon className="h-4 w-4 shrink-0 fill-current opacity-90" aria-hidden />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {!collapsed && item.badge ? (
        <span className="ml-auto inline-flex min-w-[18px] items-center justify-center rounded-full bg-emerald-500/20 px-1.5 text-[10px] font-semibold text-emerald-200">
          {item.badge}
        </span>
      ) : null}
    </Link>
  );
}

export default function AppSidebar({
  collapsed,
  onCollapseToggle,
  isSuperAdmin,
  branding,
  managePlanUrl,
  entitlements,
  onNavigate,
  showCollapse = true,
}: {
  collapsed: boolean;
  onCollapseToggle: () => void;
  isSuperAdmin: boolean;
  branding?: BrandingConfig | null;
  managePlanUrl?: string | null;
  entitlements?: OrgEntitlements | null;
  onNavigate?: () => void;
  showCollapse?: boolean;
}) {
  const pathname = usePathname() || "/";
  const reviewCount = useReviewQueueCount();
  const reviewBadge =
    typeof reviewCount === "number" && reviewCount > 0
      ? reviewCount > 99
        ? "99+"
        : String(reviewCount)
      : null;

  const featureFlags = entitlements?.features;
  const groups: NavGroup[] = [
    {
      title: "Core",
      items: CORE.map((item) => {
        if (item.href === "/email-ai") {
          const locked = featureFlags ? !featureFlags.emailAi : false;
          return { ...item, badge: reviewBadge, locked };
        }
        if (item.href === "/messages") {
          const locked = featureFlags ? !featureFlags.messagesHub : false;
          return { ...item, locked };
        }
        if (item.href === "/calendar") {
          const locked = featureFlags ? !featureFlags.calendar : false;
          return { ...item, locked };
        }
        if (item.href === "/analytics/calls") {
          const locked = featureFlags ? !featureFlags.analytics : false;
          return { ...item, locked };
        }
        return item;
      }),
    },
    {
      title: "Ops",
      items: OPS.map((item) => {
        if (item.href === "/services") {
          const locked = featureFlags ? !featureFlags.booking : false;
          return { ...item, locked };
        }
        if (item.href === "/automations") {
          const locked = featureFlags ? !featureFlags.emailAi : false;
          return { ...item, locked };
        }
        return item;
      }),
    },
  ];

  const resolvedManagePlanUrl = managePlanUrl || "https://arohacalls.com";
  groups.push({
    title: "Account",
    items: [{ label: "Manage Plan", href: resolvedManagePlanUrl, icon: Icon.billing, external: true }],
  });

  if (isSuperAdmin) {
    groups.push({
      title: "Admin",
      items: [{ label: "Super Admin", href: "/admin", icon: Icon.admin }],
    });
  }

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-white/10 bg-gradient-to-b from-zinc-950 via-zinc-950 to-zinc-900 text-white",
        collapsed ? "w-[72px]" : "w-72"
      )}
      aria-label="Sidebar navigation"
    >
      <div className="flex items-center gap-3 px-4 py-4">
        <Link
          href="/dashboard"
          aria-label="Aroha Bookings home"
          className={cn(
            "flex items-center gap-3 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70",
            collapsed ? "justify-center" : ""
          )}
          title={collapsed ? "Aroha Bookings" : undefined}
        >
          <BrandLogo
            branding={branding}
            showWordmark={!collapsed}
            variant="dark"
            wordmarkClassName="text-white/90"
            titleClassName="text-white"
            subtitleClassName="text-white/60"
          />
        </Link>

        {showCollapse && (
          <button
            type="button"
            onClick={onCollapseToggle}
            className={cn(
              "ml-auto rounded-lg p-2 text-zinc-300 hover:bg-white/5 hover:text-white outline-none",
              "focus-visible:ring-2 focus-visible:ring-emerald-400/70",
              collapsed ? "absolute right-3 top-4" : ""
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand" : "Collapse"}
          >
            <Icon.collapse className="h-4 w-4 fill-current" aria-hidden />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {groups.map((group) => (
          <div key={group.title} className="mb-4">
            {!collapsed && (
              <div className="px-2 pb-2 pt-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                {group.title}
              </div>
            )}
            <div className="space-y-1">
              {group.items.map((item) => (
                <NavLink
                  key={item.href}
                  collapsed={collapsed}
                  item={item}
                  active={isActive(pathname, item.href)}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 p-3">
        <Link
          href="/logout"
          onClick={onNavigate}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm outline-none transition",
            "text-zinc-300 hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-emerald-400/70"
          )}
          title={collapsed ? "Log out" : undefined}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-current" aria-hidden>
            <path d="M10 17v-2h4v-2h-4V9L6 12l4 3ZM20 3H8a2 2 0 0 0-2 2v4h2V5h12v14H8v-4H6v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Z" />
          </svg>
          {!collapsed && <span>Log out</span>}
        </Link>
        {!collapsed && (
          <Link
            href="/#support"
            className="mt-2 block rounded-lg px-3 py-2 text-xs text-zinc-500 hover:bg-white/5 hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
            onClick={onNavigate}
          >
            Need help? Contact support
          </Link>
        )}
      </div>
    </aside>
  );
}
