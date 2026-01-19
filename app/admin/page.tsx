// app/admin/page.tsx
import { prisma } from "@/lib/db";
import { requireOrgOrPurchase } from "@/lib/requireOrgOrPurchase";
import VoiceProvidersPanel from "./VoiceProvidersPanel";
import OrgBookingPanel from "./OrgBookingPanel";
import OrgMasterPanel from "./OrgMasterPanel";
import IntegrationsPanel from "./IntegrationsPanel";
import { Plan } from "@prisma/client";
import ConfirmActionButton from "@/components/ConfirmActionButton";
import { Button, Card } from "@/components/ui";

export const runtime = "nodejs";

/* 
  ────────────────────────────────────────────────
  Server actions (all protected by super admin)
  ────────────────────────────────────────────────
*/
export async function updateOrgPlan(formData: FormData) {
  "use server";

  await ensureSuperAdmin();

  const orgId = String(formData.get("orgId") || "").trim();
  const rawPlan = String(formData.get("plan") || "").trim().toUpperCase();

  if (!orgId || !rawPlan) throw new Error("Missing org or plan");

  // Must be one of your enum values
  const allowed: Plan[] = [Plan.LITE, Plan.STARTER, Plan.PROFESSIONAL, Plan.PREMIUM];
  if (!allowed.includes(rawPlan as Plan)) {
    throw new Error("Invalid plan");
  }

  const plan = rawPlan as Plan;

  await prisma.organization.update({
    where: { id: orgId },
    data: { plan },
  });
}

async function ensureSuperAdmin() {
  const gate = await requireOrgOrPurchase();
  if (!gate.isSuperAdmin) {
    throw new Error("Not allowed");
  }
  return gate;
}

export async function createOrg(formData: FormData) {
  "use server";

  await ensureSuperAdmin();

  const name = String(formData.get("name") || "").trim();
  const ownerEmail = String(formData.get("ownerEmail") || "").trim().toLowerCase();
  const timezone = String(formData.get("timezone") || "Pacific/Auckland").trim();

  if (!name || !ownerEmail) {
    throw new Error("Missing name or owner email");
  }

  // simple slug from name
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || `org-${Date.now()}`;

  // 1) find or create the owner user
  const user = await prisma.user.upsert({
    where: { email: ownerEmail },
    update: {},
    create: {
      email: ownerEmail,
      // you can set a global role here if you ever want:
      // role: "SUPERADMIN",
    },
  });

  // 2) create org (slug is required in your schema)
  const org = await prisma.organization.create({
    data: {
      name,
      slug,
      timezone,
    },
  });

  // 3) create membership (make them owner at org level)
  await prisma.membership.create({
    data: {
      userId: user.id,
      orgId: org.id,
      role: "owner", // matches your default in Membership model
    },
  });

  // 4) OPTIONAL: seed basic org settings (hours, services etc.)
  // await prisma.orgSettings.create({
  //   data: {
  //     orgId: org.id,
  //     data: {
  //       timezone,
  //       googleCalendarId: null,
  //     },
  //   },
  // });
}

export async function addUserToOrg(formData: FormData) {
  "use server";

  await ensureSuperAdmin();

  const orgId = String(formData.get("orgId") || "").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const role = String(formData.get("role") || "staff").trim(); // matches your comment in Membership

  if (!orgId || !email) {
    throw new Error("Missing org or email");
  }

  // 1) find or create user
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email },
  });

  // 2) membership (upsert to avoid duplicates)
  await prisma.membership.upsert({
    where: {
      userId_orgId: {
        userId: user.id,
        orgId,
      },
    },
    update: { role },
    create: {
      userId: user.id,
      orgId,
      role,
    },
  });
}

export async function deleteOrg(formData: FormData) {
  "use server";

  await ensureSuperAdmin();

  const orgId = String(formData.get("orgId") || "").trim();
  if (!orgId) throw new Error("Missing org id");

  // 1) delete child records that depend on org
  await prisma.membership.deleteMany({ where: { orgId } });
  await prisma.orgSettings.deleteMany({ where: { orgId } }).catch(() => {});
  await prisma.calendarConnection.deleteMany({ where: { orgId } }).catch(() => {});
  await prisma.emailAISettings.deleteMany({ where: { orgId } }).catch(() => {});
  await prisma.emailAILog.deleteMany({ where: { orgId } }).catch(() => {});

  // 2) delete org
  await prisma.organization.delete({ where: { id: orgId } });
}

export async function resetOrgData(formData: FormData) {
  "use server";

  await ensureSuperAdmin();

  const orgId = String(formData.get("orgId") || "").trim();
  if (!orgId) throw new Error("Missing org id");

  // "Reset" means: keep org + memberships, but clear operational data.

  await prisma.orgSettings
    .updateMany({
      where: { orgId },
      data: {
        data: {},
      },
    })
    .catch(() => {});

  await prisma.calendarConnection
    .deleteMany({ where: { orgId } })
    .catch(() => {});
  await prisma.emailAILog
    .deleteMany({ where: { orgId } })
    .catch(() => {});

  // Add more cleanup here if you want (appointments, customers, etc.)
}

/*
  ────────────────────────────────────────────────
  Page
  ────────────────────────────────────────────────
*/

export default async function AdminPage() {
  const gate = await requireOrgOrPurchase();
  if (!gate.isSuperAdmin) {
    return (
      <Card className="p-6">
        <h1 className="text-xl font-semibold">Forbidden</h1>
        <p className="mt-2 text-sm text-zinc-600">
          You do not have access to the Super Admin panel.
        </p>
      </Card>
    );
  }

  // Top-level stats
  const [orgCount, userCount, membershipCount, emailLogCount] = await Promise.all([
    prisma.organization.count(),
    prisma.user.count(),
    prisma.membership.count(),
    prisma.emailAILog.count(),
  ]);

  const orgSettings = await prisma.orgSettings.findMany({
    select: {
      orgId: true,
      data: true,
      org: { select: { name: true, slug: true } },
    },
  });

  const healthEntries = orgSettings.map((s) => {
    const data = (s.data as Record<string, unknown>) || {};
    const errors = Array.isArray(data.calendarSyncErrors) ? data.calendarSyncErrors : [];
    const cronLastRun = typeof data.cronLastRun === "string" ? data.cronLastRun : null;
    return {
      orgId: s.orgId,
      name: s.org?.name || "Unknown",
      slug: s.org?.slug || "",
      errorCount: errors.length,
      lastError: errors[0] as Record<string, unknown> | undefined,
      cronLastRun,
    };
  });

  const totalSyncErrors = healthEntries.reduce((sum, entry) => sum + entry.errorCount, 0);
  const failingOrgs = healthEntries
    .filter((entry) => entry.errorCount > 0)
    .sort((a, b) => b.errorCount - a.errorCount)
    .slice(0, 6);

  const now = Date.now();
  const staleCronCount = healthEntries.filter((entry) => {
    if (!entry.cronLastRun) return true;
    const ts = new Date(entry.cronLastRun).getTime();
    if (!Number.isFinite(ts)) return true;
    return now - ts > 24 * 60 * 60 * 1000;
  }).length;

  const latestCron = healthEntries.reduce<string | null>((latest, entry) => {
    if (!entry.cronLastRun) return latest;
    if (!latest) return entry.cronLastRun;
    return new Date(entry.cronLastRun) > new Date(latest) ? entry.cronLastRun : latest;
  }, null);

  // Recent orgs (with very basic info)
  const orgs = await prisma.organization.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      name: true,
      timezone: true,
      createdAt: true,
      memberships: {
        select: { id: true },
      },
    },
  });

  // Recent users
  const userSelect: any = {
    id: true,
    email: true,
    name: true,
    role: true,      // we want this, but TS doesn't know yet
    createdAt: true,
  };

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    select: userSelect,
  });

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Super Admin</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Internal Aroha Bookings control panel – orgs, users, plans & data.
          </p>
        </div>
      </header>

      {/* TOP STATS */}
      <section className="mb-10 grid gap-4 md:grid-cols-4">
        <StatCard label="Organisations" value={orgCount} />
        <StatCard label="Users" value={userCount} />
        <StatCard label="Memberships" value={membershipCount} />
        <StatCard label="Email AI Logs" value={emailLogCount} />
      </section>

      {/* GLOBAL HEALTH */}
      <section className="mb-10 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Global health overview</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Sync reliability, failing orgs, and cron freshness.
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm">
            <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Sync errors</div>
            <div className="mt-2 text-2xl font-semibold text-zinc-800">{totalSyncErrors}</div>
            <div className="text-xs text-zinc-500">{failingOrgs.length} orgs affected</div>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm">
            <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Cron freshness</div>
            <div className="mt-2 text-2xl font-semibold text-zinc-800">{staleCronCount}</div>
            <div className="text-xs text-zinc-500">orgs stale over 24h</div>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm">
            <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Latest cron</div>
            <div className="mt-2 text-sm text-zinc-700">
              {latestCron ? new Date(latestCron).toLocaleString() : "No cron runs yet"}
            </div>
          </div>
        </div>

        <div className="mt-6">
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Failing orgs</div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {failingOrgs.map((org) => (
              <div key={org.orgId} className="rounded-lg border border-zinc-200 bg-white p-3 text-sm">
                <div className="flex items-center justify-between">
                  <div className="font-medium text-zinc-800">{org.name}</div>
                  <div className="text-xs text-zinc-500">{org.errorCount} errors</div>
                </div>
                <div className="mt-1 text-xs text-zinc-500">{org.slug || org.orgId}</div>
                <div className="mt-2 text-xs text-zinc-600">
                  Last cron: {org.cronLastRun ? new Date(org.cronLastRun).toLocaleString() : "—"}
                </div>
              </div>
            ))}
            {failingOrgs.length === 0 && (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
                No failing orgs detected.
              </div>
            )}
          </div>
        </div>
      </section>

      <IntegrationsPanel />
      <OrgMasterPanel orgs={orgs.map((o) => ({ id: o.id, name: o.name }))} />
      <VoiceProvidersPanel orgs={orgs.map((o) => ({ id: o.id, name: o.name }))} />
      <OrgBookingPanel orgs={orgs.map((o) => ({ id: o.id, name: o.name }))} />

      {/* CREATE ORG */}
      <section className="mb-10 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Create organisation manually</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Creates an org, links an owner user by email, and adds them as owner.
        </p>

        <form action={createOrg} className="mt-4 grid gap-4 max-w-md">
          <div>
            <label className="block text-sm font-medium">Org name</label>
            <input
              name="name"
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              placeholder="JMW Electrical"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Owner email</label>
            <input
              name="ownerEmail"
              type="email"
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              placeholder="owner@example.com"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Timezone</label>
            <input
              name="timezone"
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              defaultValue="Pacific/Auckland"
            />
          </div>
          <Button type="submit" className="mt-2">
            Create org
          </Button>
        </form>
      </section>

      {/* ADD USER TO ORG */}
      <section className="mb-10 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Add user to organisation</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Attach any email to an existing org and set their membership role.
        </p>

        <form action={addUserToOrg} className="mt-4 grid gap-4 max-w-md">
          <div>
            <label className="block text-sm font-medium">Org ID</label>
            <input
              name="orgId"
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              placeholder="org_..."
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium">User email</label>
            <input
              name="email"
              type="email"
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              placeholder="user@example.com"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Role</label>
            <input
              name="role"
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              defaultValue="staff"
            />
            <p className="mt-1 text-xs text-zinc-500">
              Must match your Membership role values (owner / admin / staff).
            </p>
          </div>
          <Button type="submit" className="mt-2">
            Add user to org
          </Button>
        </form>
      </section>

      {/* RECENT ORGS */}
      <section className="mb-10 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Recent organisations</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Last 20 orgs created, with basic metadata and quick actions.
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Org ID</th>
                <th className="py-2 pr-4">Timezone</th>
                <th className="py-2 pr-4">Members</th>
                <th className="py-2 pr-4">Created</th>
                <th className="py-2 pr-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id} className="border-b border-zinc-100 last:border-0">
                  <td className="py-2 pr-4 font-medium">{o.name}</td>
                  <td className="py-2 pr-4 text-xs text-zinc-500">{o.id}</td>
                  <td className="py-2 pr-4 text-xs">{o.timezone}</td>
                  <td className="py-2 pr-4 text-xs">{o.memberships.length}</td>
                  <td className="py-2 pr-4 text-xs">
                    {o.createdAt.toISOString().slice(0, 10)}
                  </td>
                  <td className="py-2 pr-0 text-right">
                    <div className="flex justify-end gap-2">
                      <form action={resetOrgData}>
                        <input type="hidden" name="orgId" value={o.id} />
                        <ConfirmActionButton
                          label="Reset data"
                          confirmText="Reset all org data? This cannot be undone."
                          className="rounded border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
                        />
                      </form>
                      <form action={deleteOrg}>
                        <input type="hidden" name="orgId" value={o.id} />
                        <ConfirmActionButton
                          label="Delete"
                          confirmText="Delete this organisation permanently? This cannot be undone."
                          className="rounded border border-red-300 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50"
                        />
                      </form>
                    </div>
                  </td>
                </tr>
              ))}

              {orgs.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-sm text-zinc-500">
                    No organisations yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* RECENT USERS */}
      <section className="mb-10 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Recent users</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Last 20 users in the system for quick inspection.
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2 pr-4">User ID</th>
                <th className="py-2 pr-4">Created</th>
              </tr>
            </thead>
            <tbody>
            {users.map((u) => {
                const user = u as any;

                return (
                  <tr key={user.id} className="border-b border-zinc-100 last:border-0">
                    <td className="py-2 pr-4 text-xs">{user.email}</td>
                    <td className="py-2 pr-4 text-xs">{user.name || "-"}</td>
                    <td className="py-2 pr-4 text-xs">
                      {String(user.role ?? "USER")}
                    </td>
                    <td className="py-2 pr-4 text-xs text-zinc-500">{user.id}</td>
                    <td className="py-2 pr-4 text-xs">
                      {user.createdAt.toISOString().slice(0, 10)}
                    </td>
                  </tr>
                );
              })}

              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-sm text-zinc-500">
                    No users yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/*
  Small stat card component
*/
function StatCard(props: { label: string; value: number }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {props.label}
      </div>
      <div className="mt-2 text-2xl font-semibold">{props.value}</div>
    </Card>
  );
}
