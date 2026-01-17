// app/o/[org]/dashboard/page.tsx
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const dynamicParams = true;

import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import Card from "@/components/ui/Card";
import { redirect, notFound } from "next/navigation";




const TZ = "Pacific/Auckland";
const NZ = "en-NZ";
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
function startOfWeek(d: Date) { const x = new Date(d); const day = (x.getDay()+6)%7; x.setDate(x.getDate()-day); x.setHours(0,0,0,0); return x; }
function endOfWeek(d: Date) { const e = startOfWeek(d); e.setDate(e.getDate()+7); e.setHours(23,59,59,999); return e; }
const minutesBetween = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime()-a.getTime())/60000));
const fmtDateTime = (d: Date) => d.toLocaleString(NZ, { timeZone: TZ, hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
const fmtTime = (d: Date) => d.toLocaleTimeString(NZ, { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const moneyNZ = (cents: number) => new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format((cents||0)/100);

type ApptLite = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  customerName: string;
  staff: { id: string; name: string | null } | null;
  service: { name: string | null; priceCents: number | null } | null;
};

export default async function TenantDashboard({ params }: { params: { org: string } }) {
  const session = await auth();
  if (!session?.user?.email) redirect("/api/auth/signin?callbackUrl=/onboarding");

  // Authorize: user must belong to this org (slug from the URL)
  const membership = await prisma.membership.findFirst({
    where: { user: { email: session.user.email }, org: { slug: params.org } },
    include: { org: true },
  });
  if (!membership?.org) return notFound();

  const orgId = membership.org.id;

  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const weekStart = startOfWeek(now);
  const weekEnd = endOfWeek(now);

  const [todayCount, uniqueTodayPhones, uniqueAllPhones, weekAppts, recentRaw, staffList] =
    await Promise.all([
      prisma.appointment.count({ where: { orgId, startsAt: { gte: todayStart, lte: todayEnd } } }),
      prisma.appointment.findMany({
        where: { orgId, startsAt: { gte: todayStart, lte: todayEnd } },
        select: { customerPhone: true },
        distinct: ["customerPhone"],
      }),
      prisma.appointment.findMany({
        where: { orgId },
        select: { customerPhone: true },
        distinct: ["customerPhone"],
      }),
      prisma.appointment.findMany({
        where: { orgId, startsAt: { gte: weekStart, lte: weekEnd } },
        include: { staff: { select: { id: true, name: true } }, service: { select: { name: true, priceCents: true } } },
        orderBy: { startsAt: "asc" },
      }) as Promise<ApptLite[]>,
      prisma.appointment.findMany({
        where: { orgId },
        orderBy: { startsAt: "desc" },
        take: 10,
        include: { staff: { select: { id: true, name: true } }, service: { select: { name: true, priceCents: true } } },
      }) as Promise<ApptLite[]>,
      prisma.staffMember.findMany({ where: { orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);

  const recentRows = recentRaw.map(r => ({
    time: fmtDateTime(r.startsAt),
    client: r.customerName,
    service: r.service?.name ?? "—",
    staff: r.staff?.name ?? "—",
  }));

  const todaySchedule = weekAppts
    .filter(a => a.startsAt >= todayStart && a.startsAt <= todayEnd)
    .sort((a,b) => a.startsAt.getTime() - b.startsAt.getTime())
    .slice(0, 8)
    .map(a => ({
      id: a.id,
      time: `${fmtTime(a.startsAt)} – ${fmtTime(a.endsAt)}`,
      label: `${a.customerName} • ${a.service?.name ?? "Service"}`,
      staff: a.staff?.name ?? "—",
    }));

  const estWeekCents = weekAppts.reduce((sum, a) => sum + (a.service?.priceCents ?? 0), 0);
  const weekDurationsMin = weekAppts.map(a => Math.max(5, minutesBetween(a.startsAt, a.endsAt)));
  const avgDur = weekDurationsMin.length ? `${Math.round(weekDurationsMin.reduce((s,n)=>s+n,0)/weekDurationsMin.length)}m` : "—";

  const svcCount = new Map<string, { name: string; count: number; revenueCents: number }>();
  for (const a of weekAppts) {
    const key = a.service?.name ?? "Unknown";
    const curr = svcCount.get(key) ?? { name: key, count: 0, revenueCents: 0 };
    svcCount.set(key, { name: curr.name, count: curr.count + 1, revenueCents: curr.revenueCents + (a.service?.priceCents ?? 0) });
  }
  const topServices = [...svcCount.values()].sort((a,b)=>b.count-a.count).slice(0,5);

const weeklyOpenMinutesPerDay: number[] = [8, 8, 8, 8, 8, 0, 0].map((h: number) => h * 60);
const capacityMin: number = weeklyOpenMinutesPerDay.reduce((a: number, b: number) => a + b, 0);

const staffUtil: { staff: string; pct: number }[] = staffList
  .map((s: { id: string; name: string | null }): { staff: string; pct: number } => {
    const apptsFor: ApptLite[] = weekAppts.filter((a: ApptLite) => a.staff?.id === s.id);
    const bookedMin: number = apptsFor.reduce(
      (m: number, a: ApptLite) => m + Math.max(5, minutesBetween(a.startsAt, a.endsAt)),
      0
    );
    const pct: number = capacityMin ? Math.min(100, Math.round((bookedMin / capacityMin) * 100)) : 0;
    return { staff: s.name ?? "—", pct };
  })
  .sort((a: { staff: string; pct: number }, b: { staff: string; pct: number }) => b.pct - a.pct);

  const uniqueClientsToday = uniqueTodayPhones.length;
  const uniqueClientsAllTime = uniqueAllPhones.length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{membership.org.name} — Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-600">Times shown in {TZ}.</p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Today's bookings" value={String(todayCount)} />
        <Stat label="Unique clients today" value={String(uniqueClientsToday)} />
        <Stat label="All-time clients" value={String(uniqueClientsAllTime)} />
        <Stat label="Avg booking length (wk)" value={avgDur} />
      </div>

      <SectionCard title="Estimated revenue (this week)">
        <div className="text-3xl font-semibold">{moneyNZ(estWeekCents)}</div>
      </SectionCard>

      <SectionCard title="Top services">
        <ul className="divide-y divide-zinc-200">
          {topServices.map((row,i)=>(
            <li key={i} className="px-5 py-3 flex items-center justify-between">
              <div className="font-medium">{row.name}</div>
              <div className="text-sm text-zinc-700">{row.count} • {moneyNZ(row.revenueCents)}</div>
            </li>
          ))}
          {topServices.length===0 && <li className="px-5 py-6 text-zinc-500">No data yet.</li>}
        </ul>
      </SectionCard>

      <SectionCard title="Today’s appointments">
        <ul className="divide-y divide-zinc-200">
          {todaySchedule.map(row=>(
            <li key={row.id} className="px-5 py-3 flex items-center justify-between">
              <div>
                <div className="font-medium">{row.label}</div>
                <div className="text-xs text-zinc-500">{row.staff}</div>
              </div>
              <div className="text-sm text-zinc-800">{row.time}</div>
            </li>
          ))}
          {todaySchedule.length===0 && <li className="px-5 py-6 text-zinc-500">No appointments today.</li>}
        </ul>
      </SectionCard>

      <SectionCard title="Staff utilisation (week)">
        <div className="p-5 space-y-3">
          {staffUtil.map((s: { staff: string; pct: number }, i: number) => (
            <div key={i}>
              <div className="flex items-center justify-between text-sm">
                <div className="font-medium">{s.staff}</div>
                <div className="text-zinc-600">{s.pct}%</div>
              </div>
              <div className="mt-1 h-2 w-full bg-zinc-200 rounded">
                <div className="h-2 rounded bg-indigo-500" style={{ width: `${s.pct}%` }} />
              </div>
            </div>
          ))}
          {staffUtil.length===0 && <div className="text-sm text-zinc-500">Add staff to see utilisation.</div>}
        </div>
      </SectionCard>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card padded={false} className="overflow-hidden">
      <header className="px-5 py-3 border-b border-zinc-200 font-semibold">{title}</header>
      <div className="p-5">{children}</div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card padded={false} className="p-5">
      <div className="text-sm text-zinc-600">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </Card>
  );
}
