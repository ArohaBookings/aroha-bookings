// components/Header.tsx
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export default async function Header() {
  const session = await getServerSession(authOptions);
  const userEmail = session?.user?.email ?? null;
  const userName = session?.user?.name ?? null;

  const greeting =
    userName?.trim() ||
    userEmail ||
    "there";

  // helper to render a tiny avatar with initials
  const initials =
    (userName || userEmail || "")
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
      .slice(0, 2)
      .map(s => s[0]?.toUpperCase())
      .join("") || "U";

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-zinc-200 bg-white/80 backdrop-blur">
      <div className="mx-auto h-full w-full max-w-7xl px-4 sm:px-6 lg:px-8 flex items-center justify-between">
        {/* Left: brand */}
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="font-semibold tracking-tight text-zinc-900 hover:text-zinc-700"
          >
            Aroha Bookings
          </Link>

          {/* Desktop site nav (optional public links) */}
          <nav className="hidden lg:flex items-center gap-4 text-sm text-zinc-600">
            <Link href="/#how-it-works" className="hover:text-zinc-900">How it works</Link>
            <Link href="/#features" className="hover:text-zinc-900">Features</Link>
            <Link href="/#pricing" className="hover:text-zinc-900">Pricing</Link>
          </nav>
        </div>

        {/* Right: auth controls */}
        {!userEmail ? (
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="px-3 py-1.5 rounded border border-zinc-300 text-sm hover:bg-zinc-50"
            >
              Log in
            </Link>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 text-sm text-zinc-600">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 text-white text-xs">
                {initials}
              </span>
              <span className="truncate max-w-[14rem]">Kia ora, <b className="text-zinc-800">{greeting}</b></span>
            </div>

            {/* Quick access to the app for signed-in users */}
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
    </header>
  );
}
