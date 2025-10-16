"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";

/** Tiny inline icons (no deps) */
const Icon = {
  dashboard: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" {...p}><path d="M3 3h8v8H3V3Zm10 0h8v5h-8V3ZM3 13h8v8H3v-8Zm10 7v-9h8v9h-8Z"/></svg>
  ),
  calendar: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" {...p}><path d="M7 2v2H5a2 2 0 0 0-2 2v2h18V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7Zm14 8H3v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V10ZM7 14h4v4H7v-4Z"/></svg>
  ),
  users: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" {...p}><path d="M16 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm-8 1a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-3.33 0-6 1.34-6 3v2h8v-2c0-1.66-2.67-3-6-3Zm8 0c-1.7 0-3.2.37-4.29.99A3.52 3.52 0 0 1 14 18v2h8v-2c0-1.84-3.13-3-6-3Z"/></svg>
  ),
  settings: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" {...p}><path d="M12 8a4 4 0 1 0 4 4 4.005 4.005 0 0 0-4-4Zm9.4 4a7.9 7.9 0 0 0-.17-1.64l2.16-1.69-2-3.46-2.62 1a8.27 8.27 0 0 0-2.84-1.65l-.44-2.78H8.51l-.44 2.78A8.27 8.27 0 0 0 5.23 6.2l-2.62-1-2 3.46 2.16 1.69A7.9 7.9 0 0 0 2.6 12a7.9 7.9 0 0 0 .17 1.64L.61 15.33l2 3.46 2.62-1a8.27 8.27 0 0 0 2.84 1.65l.44 2.78h6.98l.44-2.78a8.27 8.27 0 0 0 2.84-1.65l2.62 1 2-3.46-2.16-1.69A7.9 7.9 0 0 0 21.4 12Z"/></svg>
  ),
  logout: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" {...p}><path d="M10 17v-2h4v-2h-4V9L6 12l4 3ZM20 3H8a2 2 0 0 0-2 2v4h2V5h12v14H8v-4H6v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Z"/></svg>
  ),
} as const;

/** Nav items */
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

export default function Sidebar(): React.ReactElement {
  const pathname = usePathname() || "/";

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

      {/* (Optional) org switcher placeholder */}
      <div className="px-3 pb-2">
        <div className="rounded bg-gray-800/60 p-2 text-xs text-gray-300">
          <span className="block truncate" title="Default organisation">
            Default organisation
          </span>
        </div>
      </div>

      {/* Nav */}
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
              {/* active accent bar */}
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
