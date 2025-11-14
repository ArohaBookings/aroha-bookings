// components/Header.tsx
export const dynamic = "force-dynamic";
export const revalidate = 0;

import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { unstable_noStore as noStore } from "next/cache";
import { prisma } from "@/lib/db";

type Plan = "LITE" | "STARTER" | "PROFESSIONAL" | "PREMIUM";

function safeInitials(input: string): string {
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

export default async function Header() {
  // Always reflect *current* state, never cache
  noStore();

  let email = "";
  let name = "";
  let orgName: string | null = null;
  let plan: Plan | null = null;
  let googleCalendarId: string | null = null;
  let googleAccountEmail: string | null = null;
  let emailAIEnabled = false;

  try {
    const session = await getServerSession(authOptions);
    email = session?.user?.email ?? "";
    name = session?.user?.name ?? "";

    if (email) {
      // Load user + org + plan
      const user = await prisma.user.findUnique({
        where: { email },
        include: {
          memberships: {
            include: {
              org: {
                select: { id: true, name: true, plan: true },
              },
            },
          },
        },
      });

      const org = user?.memberships?.[0]?.org ?? null;

            if (org) {
        orgName = org.name;
        plan = (org.plan as Plan) ?? null;

        // 1) Org settings (for selected calendar id, etc.)
        const os = await prisma.orgSettings.findUnique({
          where: { orgId: org.id },
          select: { data: true },
        });
        const data = (os?.data as any) ?? {};
        googleCalendarId = (data.googleCalendarId as string) ?? null;

        // 2) Actual Google Calendar connection row
        const calendarConn = await prisma.calendarConnection.findFirst({
          where: { orgId: org.id, provider: "google" },
          select: { accountEmail: true },
        });

        // 3) Gmail connection for Email AI (optional)
        const emailSettings = await prisma.emailAISettings.findUnique({
          where: { orgId: org.id },
          select: { enabled: true, googleAccountEmail: true },
        });

        googleAccountEmail =
          (calendarConn?.accountEmail as string | null) ??
          (emailSettings?.googleAccountEmail as string | null) ??
          null;

        emailAIEnabled = !!emailSettings?.enabled;
      }
    }
  } catch {
    // Header must never break the app – fail soft
  }

  const display = (name || email || "there").trim();
  const initials = safeInitials(name || email);
  const isAuthed = Boolean(email);

  // Treat either a selected calendar OR stored Google account email as "connected"
  const isGoogleConnected = Boolean(googleCalendarId || googleAccountEmail);

  const planLabel =
    plan === "PREMIUM"
      ? "Premium"
      : plan === "PROFESSIONAL"
      ? "Professional"
      : plan === "STARTER"
      ? "Starter"
      : plan === "LITE"
      ? "Lite"
      : null;

  return (
    <header
      className="sticky top-0 z-40 h-14 border-b border-zinc-200 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60"
      role="banner"
    >
      <div className="mx-auto flex h-full w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Left side: brand + nav */}
        <div className="flex items-center gap-4 min-w-0">
          <Link
            href="/"
            className="font-semibold tracking-tight text-zinc-900 hover:text-zinc-700 whitespace-nowrap"
            aria-label="Aroha Bookings — Home"
          >
            Aroha Bookings
          </Link>

          {/* Org + plan chips */}
          {isAuthed && orgName && (
            <div className="hidden md:flex items-center gap-2 min-w-0">
              <span
                className="truncate max-w-[18rem] rounded-full bg-zinc-100 text-zinc-700 border border-zinc-200 px-2.5 py-0.5 text-xs"
                title={orgName}
              >
                {orgName}
              </span>
              {planLabel && (
                <span
                  className="rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200 px-2 py-0.5 text-[11px]"
                  title={`Plan: ${planLabel}`}
                >
                  {planLabel}
                </span>
              )}
            </div>
          )}

          {/* Public marketing links */}
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

        {/* Right side */}
        {!isAuthed ? (
          // Logged-out
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
          // Logged-in
          <div className="flex items-center gap-3 min-w-0">
            {/* Google status chip */}
            <div className="hidden md:flex items-center gap-2">
              {isGoogleConnected ? (
                <Link
                  href="/api/calendar/google/select"
                  className="inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-[11px] text-emerald-900"
                  title={`Synced to Google${
                    googleAccountEmail ? ` (${googleAccountEmail})` : ""
                  }. Click to change calendar.`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden />
                  Google sync on
                </Link>
              ) : (
                <Link
                  href="/api/calendar/google/select"
                  className="inline-flex items-center gap-2 rounded-full border border-zinc-300 bg-white px-2.5 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50"
                  title="Connect Google Calendar to sync bookings automatically"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" aria-hidden />
                  Connect Google
                </Link>
              )}
            </div>

            {/* User pill */}
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
                <b className="text-zinc-800 truncate align-middle">
                  {(display || "User").slice(0, 64)}
                </b>
              </span>
            </div>

            {/* Quick app links */}
            <div className="hidden sm:flex items-center gap-2">
              <Link
                href="/dashboard"
                className="px-3 py-1.5 rounded border border-zinc-300 text-sm hover:bg-zinc-50"
              >
                Dashboard
              </Link>
              <Link
                href="/calendar"
                className="px-3 py-1.5 rounded border border-zinc-300 text-sm hover:bg-zinc-50"
              >
                Calendar
              </Link>
              <Link
                href="/email-ai/review"
                className={[
                  "px-3 py-1.5 rounded border text-sm hover:bg-zinc-50",
                  emailAIEnabled
                    ? "border-emerald-300 text-emerald-800 bg-emerald-50/60"
                    : "border-zinc-300",
                ].join(" ")}
                title={
                  emailAIEnabled
                    ? "Email AI is enabled – open the review queue"
                    : "Email AI – Review queue"
                }
              >
                Email&nbsp;AI
              </Link>
            </div>

            {/* Logout */}
            <Link
              href="/logout"
              className="px-3 py-1.5 rounded bg-zinc-900 text-white text-sm hover:bg-zinc-800"
            >
              Log out
            </Link>
          </div>
        )}
      </div>

      {/* Mobile app bar (only when logged in) */}
      {isAuthed && (
        <div className="lg:hidden border-top border-zinc-200 bg-white border-t">
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
            <Link
              href="/email-ai/review"
              className={[
                "px-2 py-1 rounded hover:bg-zinc-50",
                emailAIEnabled ? "text-emerald-700 font-medium" : "",
              ].join(" ")}
              title="Email AI – Review queue"
            >
              Email&nbsp;AI
            </Link>

            {isGoogleConnected ? (
              <Link
                href="/api/calendar/google/select"
                className="ml-auto px-2 py-1 rounded border border-emerald-300 bg-emerald-50 text-emerald-900 whitespace-nowrap"
                title="Change Google Calendar"
              >
                Google on
              </Link>
            ) : (
              <Link
                href="/api/calendar/google/select"
                className="ml-auto px-2 py-1 rounded border border-zinc-300 whitespace-nowrap"
                title="Connect Google Calendar"
              >
                Connect Google
              </Link>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
