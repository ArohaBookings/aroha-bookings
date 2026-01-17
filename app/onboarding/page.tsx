// app/onboarding/page.tsx
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import OnboardingClient from "@/app/onboarding/OnboardingClient";
import { resolveOnboardingState } from "@/lib/onboarding";
import { resolveBranding } from "@/lib/branding";

export const dynamic = "force-dynamic";

function slugify(input: string): string {
  const base =
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) || "org";
  return base;
}

export default async function OnboardingPage() {
  // 1) Require signed-in user
  const session = await auth().catch(() => null);
  if (!session?.user?.email) {
    redirect("/api/auth/signin");
  }
  const email = session.user.email as string;

  // 2) If user already has an org, show the guided onboarding flow
  const existing = await prisma.membership.findFirst({
    where: { user: { email } },
    include: { org: true },
  });
  if (existing?.org) {
    const orgSettings = await prisma.orgSettings.findUnique({
      where: { orgId: existing.org.id },
      select: { data: true },
    });
    const data = (orgSettings?.data as Record<string, unknown>) || {};
    const onboarding = resolveOnboardingState(data);
    const branding = resolveBranding(data);
    return (
      <OnboardingClient
        org={{ id: existing.org.id, name: existing.org.name, slug: existing.org.slug }}
        onboarding={onboarding}
        branding={branding}
      />
    );
  }

  // 3) Server action to create org + defaults
  async function createOrg(formData: FormData) {
    "use server";

    const sess = await auth().catch(() => null);
    if (!sess?.user?.email) {
      redirect("/api/auth/signin");
    }
    const authedEmail = sess.user.email as string;
    const authedName = (sess.user.name ?? "") as string;

    const name = String(formData.get("name") || "").trim();
    const tz = String(formData.get("timezone") || "Pacific/Auckland");
    const addr = String(formData.get("address") || "").trim();
    const industry = String(formData.get("industry") || "").trim();

    if (!name) {
      // Shouldn’t really happen because of `required`, but guard anyway
      redirect("/onboarding?error=missing_name");
    }

    // Ensure user row exists
    const user = await prisma.user.upsert({
      where: { email: authedEmail },
      update: {},
      create: { email: authedEmail, name: authedName || null },
    });

    // Make a unique slug
    let baseSlug = slugify(name);
    let slug = baseSlug;
    let tries = 0;
    while (tries < 5) {
      const clash = await prisma.organization.findUnique({ where: { slug } });
      if (!clash) break;
      slug = `${baseSlug}-${Math.random().toString(36).slice(2, 5)}`;
      tries++;
    }

    // Create org
    const org = await prisma.organization.create({
      data: {
        name,
        slug,
        timezone: tz,
        address: addr || null,
        // you can later use `industry` inside OrgSettings.data if you want
      } as any,
    });

    // Owner membership
    await prisma.membership.create({
      data: { userId: user.id, orgId: org.id, role: "owner" },
    });

    // 4) Best-effort sensible defaults (don’t crash if they fail)
    try {
      // Opening hours Mon–Fri 9–17 (NOTE: weekday 1–5 = Mon–Fri)
      const openMin = 9 * 60;
      const closeMin = 17 * 60;
      await prisma.openingHours.createMany({
        data: [1, 2, 3, 4, 5].map((weekday) => ({
          orgId: org.id,
          weekday,
          openMin,
          closeMin,
        })),
        skipDuplicates: true,
      });

      // Sample service
      const svc = await prisma.service.create({
        data: {
          orgId: org.id,
          name: "Standard Appointment",
          durationMin: 45,
          priceCents: 7500,
          colorHex: "#DBEAFE",
        },
      });

      // Sample staff member
      const staff = await prisma.staffMember.create({
        data: {
          orgId: org.id,
          name: authedName || "Team Member",
          email: authedEmail,
          active: true,
          colorHex: "#6366F1",
        } as any,
      });

      // Join table (if present)
      // @ts-ignore – ignore if StaffService doesn’t exist in schema yet
      await prisma.staffService?.create({
        data: { staffId: staff.id, serviceId: svc.id },
      });
    } catch {
      // Defaults are non-critical, ignore failures
    }

    // Seed onboarding state and send them into the guided flow
    await prisma.orgSettings.upsert({
      where: { orgId: org.id },
      update: {
        data: {
          onboarding: {
            step: 1,
            completed: false,
            skipped: false,
            updatedAt: new Date().toISOString(),
          },
        } as any,
      },
      create: {
        orgId: org.id,
        data: {
          onboarding: {
            step: 1,
            completed: false,
            skipped: false,
            updatedAt: new Date().toISOString(),
          },
        } as any,
      },
    });

    redirect("/onboarding?step=1");
  }

  // 5) UI
  return (
    <div className="max-w-2xl mx-auto p-8 space-y-8 text-black">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.15em] text-zinc-500">
          Aroha Bookings · Setup
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Let&apos;s set up your business
        </h1>
        <p className="text-sm text-zinc-600">
          We&apos;ll create your organization, link it to your account{" "}
          <span className="font-medium">{email}</span>, and add sensible defaults
          so your calendar is ready to use in minutes.
        </p>
        <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs text-emerald-700 border border-emerald-200">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Purchase verified – you&apos;re good to go.
        </div>
      </header>

      <section className="rounded-lg border border-zinc-200 bg-white/80 shadow-sm p-6">
        <form action={createOrg} className="grid gap-5">
          <div className="grid gap-1">
            <label className="text-xs font-medium text-zinc-700">
              Business name
            </label>
            <input
              name="name"
              className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:ring-2 focus:ring-black/10"
              placeholder="E.g. Aroha Hair Studio"
              required
            />
            <p className="text-[11px] text-zinc-500">
              This will be shown on your booking links, confirmation messages,
              and invoices.
            </p>
          </div>

          <div className="grid gap-1">
            <label className="text-xs font-medium text-zinc-700">
              Industry (optional)
            </label>
            <input
              name="industry"
              className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:ring-2 focus:ring-black/10"
              placeholder="Hair &amp; beauty, barber, clinic, trades…"
            />
          </div>

          <div className="grid gap-1">
            <label className="text-xs font-medium text-zinc-700">
              Timezone
            </label>
            <input
              name="timezone"
              defaultValue="Pacific/Auckland"
              className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:ring-2 focus:ring-black/10"
            />
            <p className="text-[11px] text-zinc-500">
              All appointments, reminders, and opening hours will use this
              timezone.
            </p>
          </div>

          <div className="grid gap-1">
            <label className="text-xs font-medium text-zinc-700">
              Business address (optional)
            </label>
            <input
              name="address"
              placeholder="Street, city, postcode"
              className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:ring-2 focus:ring-black/10"
            />
            <p className="text-[11px] text-zinc-500">
              Used on confirmations and for your own records. You can leave this
              blank and add it later.
            </p>
          </div>

          <div className="rounded-md bg-zinc-50 border border-zinc-200 px-3 py-3 text-[11px] text-zinc-600 space-y-1">
            <p className="font-medium text-zinc-700">What we&apos;ll create:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Your organization linked to {email}</li>
              <li>Opening hours: Mon–Fri, 9:00–5:00 (editable in Settings)</li>
              <li>One sample staff member and a “Standard Appointment” service</li>
            </ul>
          </div>

          <div className="pt-2 flex items-center justify-between gap-3">
            <button
              className="h-10 rounded-md bg-black px-5 text-sm font-medium text-white hover:bg-zinc-800"
              type="submit"
            >
              Create my workspace
            </button>
            <p className="text-[11px] text-zinc-500">
              You can change all of this later in{" "}
              <span className="font-medium">Settings</span>.
            </p>
          </div>
        </form>
      </section>
    </div>
  );
}
