// app/book/[orgSlug]/BookClient.tsx
"use client";

import React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Skeleton from "@/components/Skeleton";
import { Badge, Button, Card, EmptyState, Input } from "@/components/ui";
import { BOOKING_FIELDS, type BookingPageConfig } from "@/lib/booking/templates";
import BrandLogo from "@/components/BrandLogo";
import { brandPrimary, type BrandingConfig } from "@/lib/branding";

type Service = {
  id: string;
  name: string;
  durationMin: number;
  priceCents: number;
};

type Staff = {
  id: string;
  name: string;
  colorHex: string | null;
};

type Slot = {
  start: string;
  end: string;
  staffId?: string | null;
};

type OrgInfo = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  address: string;
  niche?: string | null;
  phone?: string;
  email?: string;
};

type Defaults = {
  serviceId: string;
  staffId: string;
};

type PlanLimits = {
  bookingsPerMonth: number | null;
  staffCount: number | null;
  automations: number | null;
};

type PlanFeatures = Record<string, boolean>;

const PRESETS = [
  { label: "Today", days: 1 },
  { label: "Next 7 days", days: 7 },
  { label: "Next 14 days", days: 14 },
  { label: "Next 30 days", days: 30 },
] as const;

function moneyNZ(cents: number) {
  return new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(
    (cents || 0) / 100
  );
}

function fmtDate(dateKey: string, tz: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const safe = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12));
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: tz,
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(safe);
}

function fmtTime(iso: string, tz: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function toInputDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function addDays(dateKey: string, days: number) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const base = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12));
  base.setUTCDate(base.getUTCDate() + days);
  return toInputDate(base);
}

function dateKeyInTZ(iso: string, tz: string) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function buildSearchParams(current: URLSearchParams, updates: Record<string, string | null>) {
  const next = new URLSearchParams(current.toString());
  Object.entries(updates).forEach(([key, value]) => {
    if (!value) next.delete(key);
    else next.set(key, value);
  });
  return next;
}

function newIntentId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `intent_${Math.random().toString(36).slice(2)}`;
}

export default function BookClient({
  org,
  services,
  staff,
  planLimits,
  planFeatures,
  bookingPage,
  bookingUsage,
  defaults,
  branding,
}: {
  org: OrgInfo;
  services: Service[];
  staff: Staff[];
  planLimits: PlanLimits;
  planFeatures: PlanFeatures;
  bookingPage: BookingPageConfig;
  bookingUsage: { monthCount: number };
  defaults: Defaults;
  branding: BrandingConfig;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const todayKey = dateKeyInTZ(new Date().toISOString(), org.timezone);
  const [step, setStep] = React.useState(0);
  const [serviceId, setServiceId] = React.useState(defaults.serviceId);
  const [staffId, setStaffId] = React.useState(defaults.staffId);
  const [fromDate, setFromDate] = React.useState(todayKey);
  const [toDate, setToDate] = React.useState(addDays(todayKey, 14));
  const [selectedDate, setSelectedDate] = React.useState(todayKey);
  const [slots, setSlots] = React.useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = React.useState(false);
  const [slotError, setSlotError] = React.useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = React.useState<Slot | null>(null);
  const [rankedInfo, setRankedInfo] = React.useState<
    Record<string, { score: number; explanation: string; ai: boolean }>
  >({});
  const [rankTop, setRankTop] = React.useState<string | null>(null);
  const [showWhy, setShowWhy] = React.useState(false);
  const limitReached =
    planLimits.bookingsPerMonth !== null && bookingUsage.monthCount >= planLimits.bookingsPerMonth;

  const [customerName, setCustomerName] = React.useState("");
  const [customerPhone, setCustomerPhone] = React.useState("");
  const [customerEmail, setCustomerEmail] = React.useState("");
  const [customerNotes, setCustomerNotes] = React.useState("");
  const [extraFields, setExtraFields] = React.useState<Record<string, string>>({});
  const [honeypot, setHoneypot] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [bookingIntentId] = React.useState(newIntentId());
  const [touched, setTouched] = React.useState<{ name: boolean; phone: boolean }>({
    name: false,
    phone: false,
  });
  const [durationHint, setDurationHint] = React.useState<{
    predictedMin: number;
    explanation: string;
    sampleSize: number;
    ai: boolean;
  } | null>(null);
  const bookingFlowRef = React.useRef<HTMLDivElement | null>(null);

  const service = services.find((s) => s.id === serviceId) || null;
  const selectedStaff = staff.find((s) => s.id === staffId) || null;
  const { content } = bookingPage;
  const activeFields = React.useMemo(
    () =>
      Object.entries(bookingPage.fields)
        .filter(([, enabled]) => enabled)
        .map(([key]) => key),
    [bookingPage.fields]
  );

  function buildExtraNotes() {
    if (!activeFields.length) return "";
    const lines = activeFields
      .map((key) => {
        const label = BOOKING_FIELDS[key as keyof typeof BOOKING_FIELDS]?.label || key;
        const value = (extraFields[key] || "").trim();
        return value ? `${label}: ${value}` : null;
      })
      .filter(Boolean);
    return lines.length ? `Additional details:\n${lines.join("\n")}` : "";
  }

  React.useEffect(() => {
    if (defaults.serviceId) setStep(1);
  }, [defaults.serviceId]);

  React.useEffect(() => {
    const next = buildSearchParams(searchParams, {
      serviceId: serviceId || null,
      staffId: staffId || null,
    });
    router.replace(`${pathname}?${next.toString()}`);
  }, [serviceId, staffId, router, pathname, searchParams]);

  React.useEffect(() => {
    if (!serviceId) return;
    let alive = true;
    setLoadingSlots(true);
    setSlotError(null);
    setSelectedSlot(null);
    fetch(
      `/api/public/availability?orgSlug=${encodeURIComponent(org.slug)}&from=${encodeURIComponent(
        fromDate
      )}&to=${encodeURIComponent(toDate)}&serviceId=${encodeURIComponent(serviceId)}${
        staffId ? `&staffId=${encodeURIComponent(staffId)}` : ""
      }`
    )
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!alive) return;
        if (!ok || !data.ok) {
          setSlotError(data.error || "Failed to load availability.");
          setSlots([]);
          return;
        }
        setSlots(data.slots || []);
      })
      .catch(() => {
        if (!alive) return;
        setSlotError("Failed to load availability.");
      })
      .finally(() => {
        if (alive) setLoadingSlots(false);
      });

    return () => {
      alive = false;
    };
  }, [serviceId, staffId, fromDate, toDate, org.slug]);

  React.useEffect(() => {
    if (!serviceId) {
      setRankedInfo({});
      setRankTop(null);
      return;
    }
    let alive = true;
    fetch(
      `/api/public/availability/rank?orgSlug=${encodeURIComponent(org.slug)}&from=${encodeURIComponent(
        fromDate
      )}&to=${encodeURIComponent(toDate)}&serviceId=${encodeURIComponent(serviceId)}${
        staffId ? `&staffId=${encodeURIComponent(staffId)}` : ""
      }`
    )
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!alive) return;
        if (!ok || !data.ok) {
          setRankedInfo({});
          setRankTop(null);
          return;
        }
        const map: Record<string, { score: number; explanation: string; ai: boolean }> = {};
        const ranked = Array.isArray(data.rankedSlots) ? data.rankedSlots : [];
        ranked.forEach((r: any) => {
          if (r?.start && r?.explanation) {
            map[r.start] = {
              score: Number(r.score || 0),
              explanation: String(r.explanation || ""),
              ai: Boolean(r.ai),
            };
          }
        });
        setRankedInfo(map);
        setRankTop(ranked[0]?.start ?? null);
      })
      .catch(() => {
        if (!alive) return;
        setRankedInfo({});
        setRankTop(null);
      });
    return () => {
      alive = false;
    };
  }, [serviceId, staffId, fromDate, toDate, org.slug]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.key === "ArrowRight") {
        if (step === 0 && serviceId) setStep(1);
        else if (step === 1) setStep(2);
        else if (step === 2 && selectedSlot) setStep(3);
        else if (step === 3 && customerName && customerPhone) setStep(4);
      }
      if (e.key === "ArrowLeft") {
        if (step > 0) setStep(step - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, serviceId, selectedSlot, customerName, customerPhone]);

  React.useEffect(() => {
    if (!serviceId) {
      setDurationHint(null);
      return;
    }
    const controller = new AbortController();
    fetch(
      `/api/public/availability/predict-duration?orgSlug=${encodeURIComponent(
        org.slug
      )}&serviceId=${encodeURIComponent(serviceId)}`,
      { signal: controller.signal }
    )
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok || !data.ok) {
          setDurationHint(null);
          return;
        }
        setDurationHint({
          predictedMin: Number(data.predictedMin),
          explanation: String(data.explanation || ""),
          sampleSize: Number(data.sampleSize || 0),
          ai: Boolean(data.ai),
        });
      })
      .catch(() => setDurationHint(null));
    return () => controller.abort();
  }, [serviceId, org.slug]);

  const slotsByDate = React.useMemo(() => {
    const map = new Map<string, Slot[]>();
    slots.forEach((s) => {
      const d = dateKeyInTZ(s.start, org.timezone);
      const list = map.get(d) ?? [];
      list.push(s);
      map.set(d, list);
    });
    return map;
  }, [slots]);

  const datesWithSlots = React.useMemo(() => Array.from(slotsByDate.keys()).sort(), [slotsByDate]);
  const daySlots = slotsByDate.get(selectedDate) ?? [];

  function nicheLabel() {
    switch ((org.niche || "").toUpperCase()) {
      case "TRADES":
        return "Why this slot works for your job";
      case "MEDICAL":
        return "Why this time is recommended";
      case "DENTAL":
        return "Why this time is recommended";
      case "LAW":
        return "Why this time is recommended";
      case "AUTO":
        return "Why this slot works";
      case "HAIR_BEAUTY":
        return "Why this slot is a good fit";
      default:
        return "Why this time is recommended";
    }
  }

  function goNext() {
    setStep((s) => Math.min(s + 1, 4));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  function selectPreset(days: number) {
    setFromDate(todayKey);
    setToDate(addDays(todayKey, days));
    setSelectedDate(todayKey);
  }

  async function handleSubmit() {
    if (!serviceId || !selectedSlot) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const mergedNotes = [customerNotes, buildExtraNotes()].filter(Boolean).join("\n");
      const res = await fetch("/api/public/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgSlug: org.slug,
          serviceId,
          staffId: staffId || selectedSlot.staffId || null,
          startISO: selectedSlot.start,
          bookingIntentId,
          honeypot,
          customer: {
            name: customerName,
            phone: customerPhone,
            email: customerEmail || null,
            notes: mergedNotes || null,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setSubmitError(data.error || "Could not complete booking.");
        return;
      }
      const manageToken = data.manageToken ? `&manage=${encodeURIComponent(data.manageToken)}` : "";
      router.push(
        `/book/${org.slug}/success?name=${encodeURIComponent(
          customerName
        )}&start=${encodeURIComponent(selectedSlot.start)}&staff=${encodeURIComponent(
          staffId || selectedSlot.staffId || ""
        )}${manageToken}`
      );
    } catch (err) {
      setSubmitError("Could not complete booking.");
    } finally {
      setSubmitting(false);
    }
  }
  React.useEffect(() => {
    const favicon = branding?.faviconUrl || "/branding/logo.svg";
    const link = document.querySelector<HTMLLinkElement>("link[rel='icon']") || document.createElement("link");
    link.rel = "icon";
    link.href = favicon;
    document.head.appendChild(link);
  }, [branding?.faviconUrl]);

  return (
    <main
      className="min-h-screen bg-zinc-50"
      style={{ ["--brand-primary" as any]: brandPrimary(branding) }}
    >
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <BrandLogo branding={branding} showWordmark={false} />
            <div>
              <h1 className="text-2xl font-semibold text-zinc-900">{org.name}</h1>
              <p className="text-sm text-zinc-600 mt-1">
                {org.address ? org.address : `${org.timezone} · Online booking`}
              </p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs text-zinc-500">
            {org.phone ? (
              <a className="rounded-full border border-zinc-200 px-3 py-1.5" href={`tel:${org.phone}`}>
                Call
              </a>
            ) : null}
            {org.address ? (
              <a
                className="rounded-full border border-zinc-200 px-3 py-1.5"
                href={`https://maps.google.com/?q=${encodeURIComponent(org.address)}`}
                target="_blank"
                rel="noreferrer"
              >
                Map
              </a>
            ) : null}
            <span className="hidden md:inline-flex items-center gap-2 text-xs text-zinc-500">
              Powered by <span className="font-semibold text-zinc-800">Aroha</span>
            </span>
          </div>
        </div>
      </header>

    <section className="max-w-6xl mx-auto px-6 py-10">
      <div className="mb-8 rounded-[28px] border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-amber-50 p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
          <span>{org.name}</span>
          <span className="text-emerald-400">•</span>
          <span>{bookingPage.template.replace(/_/g, " ")}</span>
        </div>
        <h2 className="mt-3 text-3xl font-semibold text-zinc-900">{content.headline}</h2>
        <p className="mt-2 max-w-2xl text-sm text-zinc-600">{content.subheadline}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {content.trustBadges.map((badge) => (
            <span
              key={badge}
              className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-medium text-emerald-700"
            >
              {badge}
            </span>
          ))}
        </div>
      </div>
      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        {[
          "Instant confirmation + reminders",
          "Google Calendar synced",
          "Zero double bookings",
        ].map((item) => (
          <div key={item} className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
            {item}
          </div>
        ))}
      </div>
      {!planFeatures.booking && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Online booking is limited on this plan. You can still request a booking, but availability
          may be restricted until the business upgrades.
        </div>
      )}

      {limitReached && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          This business is at its monthly booking limit ({planLimits.bookingsPerMonth}). You can
          still submit a booking request, but confirmation may be delayed.
        </div>
      )}

      <div ref={bookingFlowRef} className="grid lg:grid-cols-[1.1fr_0.9fr] gap-8">
        {/* LEFT: main booking flow */}
        <Card padded={false} className="rounded-3xl overflow-hidden">
          <div className="border-b border-zinc-200 bg-zinc-50 px-6 py-4">
            <div className="flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-zinc-500">
              {["Service", "Staff", "Date/Time", "Details", "Confirm"].map((label, idx) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setStep(idx)}
                  className={`rounded-full px-3 py-1 ${
                    step === idx
                      ? "bg-black text-white"
                      : "bg-white border border-zinc-200 text-zinc-600"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="p-6 space-y-6">
            {step === 0 && (
              <div className="space-y-4">
                <h2 className="text-xl font-semibold">Choose a service</h2>
                <div className="grid gap-3">
                  {services.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setServiceId(s.id);
                        setStep(1);
                      }}
                      className={`rounded-2xl border px-4 py-4 text-left transition ${
                        serviceId === s.id
                          ? "border-black bg-black text-white"
                          : "border-zinc-200 hover:border-zinc-400"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-lg font-semibold">{s.name}</div>
                          <div className="text-sm opacity-70">{s.durationMin} min</div>
                          {durationHint && serviceId === s.id ? (
                            <div className="mt-1 text-xs opacity-70">
                              Typical: ~{durationHint.predictedMin} min
                            </div>
                          ) : null}
                        </div>
                        <div className="text-sm font-semibold">{moneyNZ(s.priceCents)}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-4">
                <h2 className="text-xl font-semibold">Preferred staff (optional)</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      setStaffId("");
                      setStep(2);
                    }}
                    className={`rounded-2xl border px-4 py-4 text-left ${
                      !staffId
                        ? "border-black bg-black text-white"
                        : "border-zinc-200 hover:border-zinc-400"
                    }`}
                  >
                    <div className="text-sm uppercase tracking-[0.2em] opacity-70">Any staff</div>
                    <div className="text-lg font-semibold">Best available</div>
                  </button>

                  {staff.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setStaffId(s.id);
                        setStep(2);
                      }}
                      className={`rounded-2xl border px-4 py-4 text-left ${
                        staffId === s.id
                          ? "border-black bg-black text-white"
                          : "border-zinc-200 hover:border-zinc-400"
                      }`}
                    >
                      <div className="text-sm uppercase tracking-[0.2em] opacity-70">Staff</div>
                      <div className="text-lg font-semibold">{s.name}</div>
                    </button>
                  ))}
                </div>

                <div className="flex justify-between">
                  <Button variant="ghost" className="text-sm px-2" type="button" onClick={goBack}>
                    Back
                  </Button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-semibold">Choose a time</h2>
                  <p className="text-sm text-zinc-500 mt-1">Times shown in {org.timezone}.</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {PRESETS.map((preset) => (
                    <Button
                      key={preset.label}
                      variant="secondary"
                      type="button"
                      onClick={() => selectPreset(preset.days)}
                      className="rounded-full px-3 py-1 text-xs"
                    >
                      {preset.label}
                    </Button>
                  ))}

                  <div className="ml-auto flex items-center gap-2">
                    <Input
                      type="date"
                      value={fromDate}
                      onChange={(e) => setFromDate(e.target.value)}
                      className="h-9 text-sm"
                    />
                    <span className="text-xs text-zinc-500">to</span>
                    <Input
                      type="date"
                      value={toDate}
                      onChange={(e) => setToDate(e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                </div>

                {loadingSlots ? (
                  <div className="grid gap-3 sm:grid-cols-3">
                    {Array.from({ length: 6 }).map((_, idx) => (
                      <Skeleton key={idx} className="h-14 rounded-xl" />
                    ))}
                  </div>
                ) : slotError ? (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                    {slotError}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      {datesWithSlots.map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setSelectedDate(d)}
                          className={`rounded-full border px-3 py-1 text-xs ${
                            selectedDate === d
                              ? "border-black bg-black text-white"
                              : "border-zinc-200 text-zinc-600"
                          }`}
                        >
                          {fmtDate(d, org.timezone)}
                        </button>
                      ))}
                    </div>

                    {daySlots.length === 0 ? (
                      <EmptyState
                        title="No slots for this day"
                        body="Try another date or expand the range to see more availability."
                      />
                    ) : (
                      <div className="grid gap-3 sm:grid-cols-3">
                        {daySlots.map((slot) => (
                          <button
                            key={slot.start}
                            type="button"
                            onClick={() => setSelectedSlot(slot)}
                            className={`rounded-xl border px-4 py-3 text-left ${
                              selectedSlot?.start === slot.start
                                ? "border-black bg-black text-white"
                                : "border-zinc-200 hover:border-zinc-400"
                            }`}
                          >
                            <div className="flex items-center justify-between text-sm uppercase tracking-widest opacity-70">
                              <span>Time</span>
                              {rankTop === slot.start ? (
                                <Badge variant="success" className="px-2 py-0.5 text-[10px]">
                                  Recommended
                                </Badge>
                              ) : null}
                            </div>
                            <div className="text-lg font-semibold">
                              {fmtTime(slot.start, org.timezone)}
                            </div>
                            {slot.staffId && (
                              <div className="text-xs opacity-70">
                                {staff.find((s) => s.id === slot.staffId)?.name || "Staff"}
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                    )}

                    {selectedSlot && rankedInfo[selectedSlot.start] ? (
                      <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm">
                        <button
                          type="button"
                          onClick={() => setShowWhy((s) => !s)}
                          className="text-xs font-semibold text-zinc-700 hover:underline"
                        >
                          {showWhy ? "Hide why" : nicheLabel()}
                        </button>
                        {showWhy ? (
                          <div className="mt-2 text-sm text-zinc-600">
                            {rankedInfo[selectedSlot.start].explanation}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <Button variant="ghost" className="text-sm px-2" type="button" onClick={goBack}>
                    Back
                  </Button>
                  <Button type="button" disabled={!selectedSlot} onClick={() => selectedSlot && setStep(3)}>
                    Continue
                  </Button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <h2 className="text-xl font-semibold">Your details</h2>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Input
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                      placeholder="Full name"
                      required
                    />
                    {touched.name && !customerName ? (
                      <span className="mt-1 block text-xs text-rose-600">Name is required.</span>
                    ) : null}
                  </div>

                  <div>
                    <Input
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
                      placeholder="Phone number"
                      required
                    />
                    {touched.phone && !customerPhone ? (
                      <span className="mt-1 block text-xs text-rose-600">Phone number is required.</span>
                    ) : null}
                  </div>
                </div>

                <Input
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="Email (optional)"
                  type="email"
                />

                {activeFields.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {activeFields.map((key) => {
                      const field = BOOKING_FIELDS[key as keyof typeof BOOKING_FIELDS];
                      return (
                        <Input
                          key={key}
                          value={extraFields[key] || ""}
                          onChange={(e) =>
                            setExtraFields((prev) => ({ ...prev, [key]: e.target.value }))
                          }
                          placeholder={field?.placeholder || field?.label || key}
                        />
                      );
                    })}
                  </div>
                )}

                <textarea
                  value={customerNotes}
                  onChange={(e) => setCustomerNotes(e.target.value)}
                  placeholder="Notes for the team (optional)"
                  className="rounded-lg border border-zinc-200 px-3 py-3 text-sm min-h-[90px]"
                />

                <Input
                  value={honeypot}
                  onChange={(e) => setHoneypot(e.target.value)}
                  className="hidden"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden
                />

                <div className="flex items-center justify-between">
                  <Button variant="ghost" className="text-sm px-2" type="button" onClick={goBack}>
                    Back
                  </Button>
                  <Button type="button" disabled={!customerName || !customerPhone} onClick={() => setStep(4)}>
                    Continue
                  </Button>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-semibold">Confirm booking</h2>
                  <p className="text-sm text-zinc-500">
                    Review your booking details before confirming.
                  </p>
                </div>

                <Card className="rounded-2xl bg-zinc-50 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Service</span>
                    <span className="font-medium">{service?.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Duration</span>
                    <span className="font-medium">{service?.durationMin} min</span>
                  </div>
                  {durationHint ? (
                    <div className="text-xs text-zinc-500">
                      {durationHint.explanation || `Typical duration ~${durationHint.predictedMin} min.`}
                    </div>
                  ) : null}
                  <div className="flex justify-between">
                    <span>Staff</span>
                    <span className="font-medium">
                      {selectedStaff?.name ||
                        staff.find((s) => s.id === selectedSlot?.staffId)?.name ||
                        "Any staff"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Date</span>
                    <span className="font-medium">
                      {selectedSlot ? fmtDate(selectedSlot.start, org.timezone) : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Time</span>
                    <span className="font-medium">
                      {selectedSlot ? fmtTime(selectedSlot.start, org.timezone) : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Price</span>
                    <span className="font-medium">{service ? moneyNZ(service.priceCents) : "—"}</span>
                  </div>
                </Card>

                {submitError && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {submitError}
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <Button variant="ghost" className="text-sm px-2" type="button" onClick={goBack}>
                    Back
                  </Button>
                  <Button type="button" disabled={submitting || !selectedSlot} onClick={handleSubmit}>
                    {submitting ? "Confirming..." : "Confirm booking"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* RIGHT: booking summary + tips */}
        <aside className="space-y-6">
          <Card className="rounded-3xl p-6">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-zinc-500">
              Booking summary
            </h3>

            <div className="mt-4 space-y-3 text-sm text-zinc-600">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-zinc-400">Service</div>
                <div className="text-base font-semibold text-zinc-900">
                  {service?.name || "Select a service"}
                </div>
                {durationHint ? (
                  <div className="mt-1 text-xs text-zinc-500">
                    Typical duration: ~{durationHint.predictedMin} min
                  </div>
                ) : null}
              </div>

              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-zinc-400">Time</div>
                <div className="text-base font-semibold text-zinc-900">
                  {selectedSlot ? fmtDate(selectedSlot.start, org.timezone) : "Choose a time"}
                </div>
                <div className="text-xs text-zinc-500">
                  {selectedSlot ? fmtTime(selectedSlot.start, org.timezone) : ""}
                </div>
              </div>

              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-zinc-400">Staff</div>
                <div className="text-base font-semibold text-zinc-900">
                  {selectedStaff?.name ||
                    staff.find((s) => s.id === selectedSlot?.staffId)?.name ||
                    "Any staff"}
                </div>
              </div>
            </div>
          </Card>

          <div className="rounded-3xl border border-zinc-200 bg-zinc-50 p-6">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-zinc-500">
              Helpful tips
            </h3>
            <ul className="mt-3 text-sm text-zinc-600 space-y-2">
              {content.tips.map((tip) => (
                <li key={tip}>✓ {tip}</li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </section>
    <div className="sm:hidden fixed bottom-0 left-0 right-0 border-t border-zinc-200 bg-white/90 backdrop-blur px-4 py-3">
      <button
        type="button"
        onClick={() => bookingFlowRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
        className="w-full rounded-full px-4 py-3 text-sm font-semibold text-white"
        style={{ backgroundColor: "var(--brand-primary)" }}
      >
        Start booking
      </button>
    </div>
  </main>
);
}
