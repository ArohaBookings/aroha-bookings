// components/Header.tsx
export const dynamic = "force-dynamic";
export const revalidate = 0;

import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { unstable_noStore as noStore } from "next/cache";

export default async function Header() {
  // Never cache this — always reflect current auth state
  noStore();

  let email = "";
  let name = "";
  try {
    const session = await getServerSession(authOptions);
    email = session?.user?.email ?? "";
    name = session?.user?.name ?? "";
  } catch {
    // swallow session errors so header still renders
  }

  const display = (name || email || "there").trim();

  // defensive/Unicode-friendly initials (max 2)
  const initials =
    (name || email)
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s?.[0]?.toUpperCase() ?? "")
      .join("") || "U";

  const isAuthed = Boolean(email);

  return (
    <header
      className="sticky top-0 z-40 h-14 border-b border-zinc-200 bg-white/80 backdrop-blur"
      role="banner"
    >
      <div className="mx-auto flex h-full w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand + public nav */}
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="font-semibold tracking-tight text-zinc-900 hover:text-zinc-700"
            aria-label="Aroha Bookings — Home"
          >
            Aroha Bookings
          </Link>

          {/* Public links (hidden on small screens) */}
          <nav
            className="hidden lg:flex items-center gap-4 text-sm text-zinc-600"
            aria-label="Primary"
          >
            <Link href="/#how-it-works" className="hover:text-zinc-900">
              How it works
            </Link>
            <Link href="/#features" className="hover:text-zinc-900">
              Features
            </Link>
            <Link href="/#pricing" className="hover:text-zinc-900">
              Pricing
            </Link>
          </nav>
        </div>

        {/* Right side: auth controls */}
        {!isAuthed ? (
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="px-3 py-1.5 rounded border border-zinc-300 text-sm hover:bg-zinc-50"
              aria-label="Log in"
            >
              Log in
            </Link>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            {/* Compact user pill (truncate long names/emails) */}
            <div
              className="hidden sm:flex max-w-[18rem] items-center gap-2 text-sm text-zinc-600"
              title={email}
            >
              <span
                aria-hidden
                className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 text-white text-xs"
              >
                {initials}
              </span>
              <span className="truncate">
                Kia ora,{" "}
                <b className="text-zinc-800 truncate align-middle">{display}</b>
              </span>
            </div>

            {/* Quick app access */}
            <Link
              href="/dashboard"
              className="hidden sm:inline-flex px-3 py-1.5 rounded border border-zinc-300 text-sm hover:bg-zinc-50"
            >
              Dashboard
            </Link>

            <Link
              href="/logout"
              className="px-3 py-1.5 rounded bg-zinc-900 text-white text-sm hover:bg-zinc-800"
            >
              Log out
            </Link>
          </div>
        )}
      </div>

      {/* Mobile utility row (only when authed) */}
      {isAuthed && (
        <div className="lg:hidden border-t border-zinc-200 bg-white">
          <nav
            className="mx-auto flex max-w-7xl items-center gap-2 overflow-x-auto px-4 py-2 text-sm"
            aria-label="App"
          >
            <Link href="/dashboard" className="px-2 py-1 rounded hover:bg-zinc-50">
              Dashboard
            </Link>
            <Link href="/calendar" className="px-2 py-1 rounded hover:bg-zinc-50">
              Calendar
            </Link>
            <Link href="/clients" className="px-2 py-1 rounded hover:bg-zinc-50">
              Clients
            </Link>
            <Link href="/settings" className="px-2 py-1 rounded hover:bg-zinc-50">
              Settings
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}