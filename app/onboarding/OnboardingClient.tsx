"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import BrandLogo from "@/components/BrandLogo";
import { BOOKING_TEMPLATE_OPTIONS, type BookingPageConfig } from "@/lib/booking/templates";
import type { OnboardingState } from "@/lib/onboarding";
import type { BrandingConfig } from "@/lib/branding";

type OrgInfo = {
  id: string;
  name: string;
  slug: string;
};

type TokenResp = {
  ok: boolean;
  connected: boolean;
  email: string | null;
  expires_at: number | null;
  reason?: string | null;
  error?: string;
};

type InboxSettings = {
  enableAutoDraft: boolean;
  enableAutoSend: boolean;
  autoSendAllowedCategories: string[];
  autoSendMinConfidence: number;
  neverAutoSendCategories: string[];
  businessHoursOnly: boolean;
  dailySendCap: number;
  requireApprovalForFirstN: number;
};

const PRESETS: Array<{
  key: string;
  label: string;
  description: string;
  settings: Partial<InboxSettings>;
}> = [
  {
    key: "conservative",
    label: "Conservative",
    description: "Drafts on, auto-send off. High confidence, strict caps.",
    settings: {
      enableAutoDraft: true,
      enableAutoSend: false,
      autoSendMinConfidence: 95,
      dailySendCap: 10,
      requireApprovalForFirstN: 50,
      businessHoursOnly: true,
    },
  },
  {
    key: "balanced",
    label: "Balanced",
    description: "Auto-send for safe categories with tight guardrails.",
    settings: {
      enableAutoDraft: true,
      enableAutoSend: true,
      autoSendMinConfidence: 92,
      dailySendCap: 25,
      requireApprovalForFirstN: 20,
      businessHoursOnly: true,
    },
  },
  {
    key: "aggressive",
    label: "Aggressive",
    description: "Higher throughput, still capped and supervised on risk.",
    settings: {
      enableAutoDraft: true,
      enableAutoSend: true,
      autoSendMinConfidence: 90,
      dailySendCap: 60,
      requireApprovalForFirstN: 5,
      businessHoursOnly: true,
    },
  },
];

const STEPS = [
  { id: 1, title: "Connect Google", subtitle: "Enable live inbox sync" },
  { id: 2, title: "Choose template", subtitle: "Pick your public booking look" },
  { id: 3, title: "Set hours + team", subtitle: "Hours, staff, services" },
  { id: 4, title: "Inbox automation", subtitle: "Set your AI safety level" },
  { id: 5, title: "Share booking link", subtitle: "Go public in minutes" },
];

function resolveStep(raw?: string | null, fallback = 1): number {
  const num = Number(raw);
  if (Number.isFinite(num) && num >= 1 && num <= 5) return num;
  return fallback;
}

export default function OnboardingClient({
  org,
  onboarding,
  branding,
}: {
  org: OrgInfo;
  onboarding: OnboardingState;
  branding?: BrandingConfig | null;
}) {
  const params = useSearchParams();
  const [state, setState] = useState<OnboardingState>(onboarding);
  const [activeStep, setActiveStep] = useState<number>(
    resolveStep(params?.get("step"), onboarding.step || 1)
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tokenState, setTokenState] = useState<TokenResp | null>(null);
  const [bookingConfig, setBookingConfig] = useState<BookingPageConfig | null>(null);
  const [bookingDirty, setBookingDirty] = useState(false);
  const [bookingBusy, setBookingBusy] = useState(false);

  const [automationBusy, setAutomationBusy] = useState(false);
  const [automationStatus, setAutomationStatus] = useState<string | null>(null);
  const [lastPreset, setLastPreset] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);

  useEffect(() => {
    const step = resolveStep(params?.get("step"), state.step || 1);
    setActiveStep(step);
  }, [params, state.step]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/email-ai/token", { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as TokenResp;
        if (alive) setTokenState(j);
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/org/demo", { cache: "no-store" });
        const j = await res.json();
        if (alive && res.ok) setDemoMode(Boolean(j.demoMode));
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/org/booking-page", { cache: "no-store" });
        if (!res.ok) return;
        const j = await res.json();
        if (!j?.ok) return;
        if (alive) setBookingConfig(j.config as BookingPageConfig);
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const bookingUrl = useMemo(() => {
    if (!org.slug) return "";
    if (typeof window === "undefined") {
      return `${(process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "")}/book/${org.slug}`;
    }
    return `${window.location.origin}/book/${org.slug}`;
  }, [org.slug]);

  const currentStep = state.completed ? 5 : state.step || 1;

  const updateOnboarding = async (patch: Partial<OnboardingState>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/org/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Failed to update onboarding");
      setState(j.onboarding as OnboardingState);
    } catch (e: any) {
      setError(e?.message || "Failed to update onboarding");
    } finally {
      setBusy(false);
    }
  };

  const completeStep = async (step: number) => {
    const nextStep = Math.min(step + 1, 5);
    await updateOnboarding({
      step: nextStep,
      completed: step >= 5,
      skipped: false,
    });
    setActiveStep(nextStep);
  };

  const saveBookingTemplate = async () => {
    if (!bookingConfig) return;
    setBookingBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/org/booking-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bookingConfig),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Failed to save booking page");
      setBookingConfig(j.config as BookingPageConfig);
      setBookingDirty(false);
    } catch (e: any) {
      setError(e?.message || "Failed to save booking page");
    } finally {
      setBookingBusy(false);
    }
  };

  const applyPreset = async (
    presetKey: string,
    presetLabel: string,
    patch: Partial<InboxSettings>
  ) => {
    setAutomationBusy(true);
    setAutomationStatus(null);
    setLastPreset(presetKey);
    try {
      const res = await fetch("/api/email-ai/inbox-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Failed to update inbox rules");
      setAutomationStatus(`Applied ${presetLabel} preset`);
    } catch (e: any) {
      setAutomationStatus(e?.message || "Failed to update inbox rules");
    } finally {
      setAutomationBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Aroha Bookings · Onboarding</p>
          <div className="flex items-center gap-3">
            <BrandLogo branding={branding} showWordmark={false} />
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
              Welcome, {org.name || "your team"}
            </h1>
          </div>
          <p className="text-sm text-zinc-600">
            Get live inbox automation and a beautiful public booking page in 5 quick steps.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {state.completed ? (
            <Badge variant="success">Onboarding complete</Badge>
          ) : state.skipped ? (
            <Badge variant="neutral">Skipped</Badge>
          ) : (
            <Badge variant="info">Step {currentStep} of 5</Badge>
          )}
          {!state.completed && !state.skipped && (
            <Button variant="secondary" disabled={busy} onClick={() => updateOnboarding({ skipped: true })}>
              Skip for now
            </Button>
          )}
          {state.skipped && (
            <Button variant="primary" disabled={busy} onClick={() => updateOnboarding({ skipped: false })}>
              Resume onboarding
            </Button>
          )}
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[240px,1fr]">
        <Card className="h-fit p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Your setup</div>
          <div className="mt-3 space-y-2">
            {STEPS.map((step) => {
              const isDone = state.completed || step.id < currentStep;
              const isActive = step.id === activeStep;
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => setActiveStep(step.id)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                    isActive ? "bg-emerald-50 text-emerald-900" : "text-zinc-600 hover:bg-zinc-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{step.title}</span>
                    {isDone ? (
                      <span className="text-[11px] text-emerald-600">Done</span>
                    ) : (
                      <span className="text-[11px] text-zinc-400">Step {step.id}</span>
                    )}
                  </div>
                  <div className="text-[11px] text-zinc-500">{step.subtitle}</div>
                </button>
              );
            })}
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-zinc-900">Demo mode</div>
                <div className="text-xs text-zinc-500">
                  Load sample inbox, bookings, and clients so you can explore instantly.
                </div>
              </div>
              <Button
                variant={demoMode ? "primary" : "secondary"}
                disabled={demoBusy}
                onClick={async () => {
                  setDemoBusy(true);
                  try {
                    const res = await fetch("/api/org/demo", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ demoMode: !demoMode }),
                    });
                    const j = await res.json();
                    if (res.ok) setDemoMode(Boolean(j.demoMode));
                  } finally {
                    setDemoBusy(false);
                  }
                }}
              >
                {demoMode ? "Disable demo" : "Enable demo"}
              </Button>
            </div>
          </Card>
          {activeStep === 1 && (
            <Card>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-900">Connect Google</h2>
                  <p className="text-sm text-zinc-600">
                    Live inbox sync and sending require a connected Google account.
                  </p>
                </div>
                <Badge variant={tokenState?.connected ? "success" : "warning"}>
                  {tokenState?.connected ? "Connected" : "Not connected"}
                </Badge>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button onClick={() => (window.location.href = "/settings/integrations/google")}>
                  {tokenState?.connected ? "Manage connection" : "Connect Google"}
                </Button>
                <Button variant="secondary" onClick={() => completeStep(1)}>
                  Mark step complete
                </Button>
              </div>
            </Card>
          )}

          {activeStep === 2 && (
            <Card>
              <h2 className="text-lg font-semibold text-zinc-900">Choose your booking template</h2>
              <p className="text-sm text-zinc-600">
                Pick a niche template that matches your business. You can customize copy later.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-[1fr,auto]">
                <select
                  className="h-10 rounded-md border border-zinc-300 px-3 text-sm"
                  value={bookingConfig?.template ?? "default"}
                  onChange={(e) => {
                    if (!bookingConfig) return;
                    setBookingConfig({ ...bookingConfig, template: e.target.value as BookingPageConfig["template"] });
                    setBookingDirty(true);
                  }}
                >
                  {BOOKING_TEMPLATE_OPTIONS.map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <Button variant="secondary" disabled={!bookingDirty || bookingBusy} onClick={saveBookingTemplate}>
                  {bookingBusy ? "Saving…" : "Save template"}
                </Button>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {bookingUrl ? (
                  <a className="text-sm text-emerald-700 underline" href={bookingUrl} target="_blank" rel="noreferrer">
                    Preview booking page
                  </a>
                ) : null}
                <Button variant="secondary" onClick={() => completeStep(2)}>
                  Continue
                </Button>
              </div>
            </Card>
          )}

          {activeStep === 3 && (
            <Card>
              <h2 className="text-lg font-semibold text-zinc-900">Set hours, staff, and services</h2>
              <p className="text-sm text-zinc-600">
                Define your working hours, add your team, and configure services so bookings are accurate.
              </p>
              <ul className="mt-3 space-y-2 text-sm text-zinc-700">
                <li>Update your opening hours for each weekday.</li>
                <li>Add staff members and assign services.</li>
                <li>Review booking rules like buffers and lead times.</li>
              </ul>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button onClick={() => (window.location.href = "/settings")}>
                  Open settings
                </Button>
                <Button variant="secondary" onClick={() => completeStep(3)}>
                  Mark step complete
                </Button>
              </div>
            </Card>
          )}

          {activeStep === 4 && (
            <Card>
              <h2 className="text-lg font-semibold text-zinc-900">Inbox automation level</h2>
              <p className="text-sm text-zinc-600">
                Choose how aggressive the AI should be. All modes stay within safety guardrails.
              </p>
              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                {PRESETS.map((preset) => (
                  <div key={preset.key} className="rounded-xl border border-zinc-200 bg-white p-4">
                    <div className="text-sm font-semibold text-zinc-900">{preset.label}</div>
                    <div className="mt-1 text-xs text-zinc-500">{preset.description}</div>
                    <Button
                      className="mt-3 w-full"
                      variant={lastPreset === preset.key ? "primary" : "secondary"}
                      disabled={automationBusy}
                      onClick={() => applyPreset(preset.key, preset.label, preset.settings)}
                    >
                      {automationBusy && lastPreset === preset.key ? "Applying…" : "Apply preset"}
                    </Button>
                  </div>
                ))}
              </div>
              {automationStatus && (
                <div className="mt-3 text-xs text-zinc-600">{automationStatus}</div>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={() => completeStep(4)}>
                  Continue
                </Button>
              </div>
            </Card>
          )}

          {activeStep === 5 && (
            <Card>
              <h2 className="text-lg font-semibold text-zinc-900">Share your booking link</h2>
              <p className="text-sm text-zinc-600">
                Send this link to clients or add it to your website and social profiles.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
                  {bookingUrl || "Booking link will appear once your org slug is set."}
                </div>
                <Button
                  variant="secondary"
                  disabled={!bookingUrl}
                  onClick={async () => {
                    if (!bookingUrl) return;
                    await navigator.clipboard.writeText(bookingUrl);
                  }}
                >
                  Copy link
                </Button>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button variant="primary" onClick={() => completeStep(5)}>
                  Finish onboarding
                </Button>
                <Button variant="secondary" onClick={() => (window.location.href = "/email-ai")}>
                  Go to Inbox
                </Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
