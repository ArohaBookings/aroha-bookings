// components/Header.tsx
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export default async function Header() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;

  return (
    <header className="h-14 border-b border-zinc-200 bg-white/80 backdrop-blur sticky top-0 z-40">
      <div className="max-w-6xl mx-auto h-full px-4 flex items-center justify-between">
        <Link href="/" className="font-semibold">Aroha Bookings</Link>

        <nav className="flex items-center gap-3">
          {/* Public links you want visible to everyone can go here */}
          {!email ? (
            <Link
              href="/auth/[...nextauth]/login"
              className="px-3 py-1.5 rounded border border-zinc-300 hover:bg-zinc-50 text-sm"
            >
              Log in
            </Link>
          ) : (
            <>
              <span className="text-sm text-zinc-600 hidden sm:inline">{email}</span>
              <Link
                href="/auth/[...nextauth]/logout"
                className="px-3 py-1.5 rounded bg-zinc-900 text-white text-sm hover:bg-zinc-800"
              >
                Log out
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
