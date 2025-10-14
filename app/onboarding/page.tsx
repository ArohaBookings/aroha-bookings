// app/onboarding/page.tsx
import { redirect } from "next/navigation";
// keep these import paths exactly as you’re using them today
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40) || "org";
  return base;
}

export default async function OnboardingPage() {
  // 1) Make sure the user is signed in
  const session = await auth().catch(() => null);
  if (!session?.user?.email) {
    redirect("/api/auth/signin");
  }
  const email = session.user.email as string;

  // 2) If the user already belongs to an org, send them to settings
  const existing = await prisma.membership.findFirst({
    where: { user: { email } },
    include: { org: true },
  });
  if (existing?.org) {
    redirect("/settings");
  }

  // 3) Inline server action – re-auth **inside** to satisfy TS
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

    // ensure user row
    const user = await prisma.user.upsert({
      where: { email: authedEmail },
      update: {},
      create: { email: authedEmail, name: authedName || null },
    });

    // make a unique slug if needed
    let slug = slugify(name);
    let tries = 0;
    while (tries < 5) {
      const clash = await prisma.organization.findUnique({ where: { slug } });
      if (!clash) break;
      slug = `${slug}-${Math.random().toString(36).slice(2, 5)}`;
      tries++;
    }

    // create org
    const org = await prisma.organization.create({
      data: {
        name,
        slug,
        timezone: tz,
        // remove `address` here if your schema doesn’t have it yet
        address: addr || null,
      } as any, // tolerate address nullability differences
    });

    // owner membership
    await prisma.membership.create({
      data: { userId: user.id, orgId: org.id, role: "owner" },
    });

    // (Optional) drop in some sensible defaults so the app feels “alive”
    try {
      // opening hours Mon–Fri 9–17
      const openMin = 9 * 60;
      const closeMin = 17 * 60;
      await prisma.openingHours.createMany({
        data: [0, 1, 2, 3, 4].map((weekday) => ({
          orgId: org.id,
          weekday,
          openMin,
          closeMin,
        })),
        skipDuplicates: true,
      });

      // one sample service
      const svc = await prisma.service.create({
        data: {
          orgId: org.id,
          name: "Standard Appointment",
          durationMin: 45,
          priceCents: 7500,
          colorHex: "#DBEAFE",
        },
      });

      // one sample staff
      const staff = await prisma.staffMember.create({
        data: {
          orgId: org.id,
          name: authedName || "Team Member",
          email: authedEmail,
          active: true,
          colorHex: "#6366F1",
        } as any,
      });

      // link staff↔service (if you have StaffService model)
      // @ts-ignore – ignore if your schema doesn’t include this join yet
      await prisma.staffService?.create({
        data: { staffId: staff.id, serviceId: svc.id },
      });
    } catch {
      // defaults are best-effort; ignore failures
    }

    redirect("/settings");
  }

  // 4) UI
  return (
    <div className="max-w-2xl mx-auto p-8 space-y-6 text-black">
      <h1 className="text-2xl font-semibold">Set up your business</h1>
      <p className="text-sm">
        We’ll create your organization and link it to your account. You can change any of this later in Settings.
      </p>

      <form action={createOrg} className="grid gap-4">
        <label className="grid gap-1">
          <span className="text-xs">Business name</span>
          <input
            name="name"
            className="h-10 rounded-md border border-zinc-300 px-3 outline-none focus:ring-2 focus:ring-black/10"
            placeholder="Aroha Salon"
            required
          />
        </label>

        <label className="grid gap-1">
          <span className="text-xs">Timezone</span>
          <input
            name="timezone"
            defaultValue="Pacific/Auckland"
            className="h-10 rounded-md border border-zinc-300 px-3 outline-none focus:ring-2 focus:ring-black/10"
          />
        </label>

        <label className="grid gap-1">
          <span className="text-xs">Address</span>
          <input
            name="address"
            placeholder="Street, City, Postcode"
            className="h-10 rounded-md border border-zinc-300 px-3 outline-none focus:ring-2 focus:ring-black/10"
          />
        </label>

        <div className="pt-2">
          <button
            className="h-10 rounded-md bg-black px-4 text-white text-sm hover:bg-zinc-800"
            type="submit"
          >
            Continue
          </button>
        </div>
      </form>
    </div>
  );
}
