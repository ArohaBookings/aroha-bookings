// FILE MAP: app layout at app/layout.tsx; Retell webhook at app/api/webhooks/voice/[provider]/[orgId]/route.ts.
"use client";

import React from "react";
import { buildIntentActions, type IntentAction } from "@/lib/intent/engine";
import { Button, Card, Badge } from "@/components/ui";
import Toast from "@/components/ui/Toast";

type Slot = { start: string; end: string; staffId?: string | null; explanation?: string | null };

function useToast() {
  const [toast, setToast] = React.useState<{ message: string; variant: "info" | "success" | "error" } | null>(
    null
  );
  const timer = React.useRef<number | null>(null);

  const show = (message: string, variant: "info" | "success" | "error" = "info") => {
    setToast({ message, variant });
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 2400);
  };

  const node = toast ? (
    <div className="fixed right-6 top-6 z-[80]">
      <Toast message={toast.message} variant={toast.variant} />
    </div>
  ) : null;

  return { show, node };
}

export default function IntentActionsPanel({
  title = "Intent → Action",
  text,
  category,
  risk,
  orgSlug,
  staffId,
  serviceId,
  memory,
}: {
  title?: string;
  text: string;
  category?: string | null;
  risk?: string | null;
  orgSlug?: string | null;
  staffId?: string | null;
  serviceId?: string | null;
  memory?: {
    preferredDays?: string[];
    preferredTimes?: string[];
    tonePreference?: string;
    notes?: string | null;
  } | null;
}) {
  const toast = useToast();
  const [actions] = React.useState<IntentAction[]>(
    buildIntentActions({
      source: "call",
      text,
      category,
      risk,
      orgSlug,
      staffId,
      serviceId,
      memory,
    })
  );
  const [slots, setSlots] = React.useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = React.useState(false);
  const [slotLabel, setSlotLabel] = React.useState<string | null>(null);
  const [whyOpenId, setWhyOpenId] = React.useState<string | null>(null);
  const suggestAbortRef = React.useRef<AbortController | null>(null);
  const holdAbortRef = React.useRef<AbortController | null>(null);

  async function suggestSlots(action: IntentAction) {
    setLoadingSlots(true);
    if (suggestAbortRef.current) suggestAbortRef.current.abort();
    const controller = new AbortController();
    suggestAbortRef.current = controller;
    try {
      const res = await fetch("/api/org/booking-holds/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          text,
          staffId: staffId || undefined,
          serviceId: serviceId || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to suggest slots");
      setSlots(data.slots || []);
      setSlotLabel(data.label || null);
      toast.show("Suggested slots ready.", "success");
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        toast.show(e?.message || "Failed to suggest slots", "error");
      }
    } finally {
      setLoadingSlots(false);
    }
  }

  async function holdSlot(slot: Slot) {
    if (holdAbortRef.current) holdAbortRef.current.abort();
    const controller = new AbortController();
    holdAbortRef.current = controller;
    try {
      const res = await fetch("/api/org/booking-holds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          start: slot.start,
          end: slot.end,
          staffId: slot.staffId || null,
          note: "Held from intent actions panel",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to hold slot");
      toast.show("Slot held for 15 minutes.", "success");
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        toast.show(e?.message || "Failed to hold slot", "error");
      }
    }
  }

  async function copyText(value: string, success: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.show(success, "success");
    } catch {
      toast.show("Copy failed", "error");
    }
  }

  return (
    <Card className="p-4 space-y-3">
      {toast.node}
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{title}</p>
        {risk && <Badge variant={risk === "safe" ? "success" : "warning"}>{risk.replace("_", " ")}</Badge>}
      </div>

      {actions.length === 0 ? (
        <p className="text-sm text-zinc-600">No actions suggested.</p>
      ) : (
        <div className="space-y-2">
          {actions.map((action) => (
            <div key={action.id} className="rounded-lg border border-zinc-200 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-zinc-900">
                    {action.label}
                    <Badge variant={action.safe ? "success" : "warning"}>
                      {action.safe ? "Safe" : "Needs review"}
                    </Badge>
                    <Badge variant="neutral">{action.confidence}%</Badge>
                  </div>
                  <div className="text-xs text-zinc-500">{action.reason}</div>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => setWhyOpenId((prev) => (prev === action.id ? null : action.id))}
                >
                  Why?
                </Button>
                {action.type === "suggest_holds" && (
                  <Button variant="secondary" onClick={() => suggestSlots(action)} disabled={loadingSlots}>
                    {loadingSlots ? "Thinking..." : "Suggest"}
                  </Button>
                )}
                {action.type === "send_booking_link" && (
                  <Button
                    variant="secondary"
                    onClick={() => copyText(String(action.payload?.url || ""), "Booking link copied.")}
                  >
                    Copy link
                  </Button>
                )}
                {action.type === "request_details" && (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      copyText(
                        String(action.payload?.prompt || ""),
                        "Request message copied."
                      )
                    }
                  >
                    Copy prompt
                  </Button>
                )}
              </div>
              {whyOpenId === action.id && (
                <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Why this suggestion</div>
                  <ul className="mt-2 list-disc space-y-1 pl-4">
                    <li>{action.reason}</li>
                    <li>Confidence {action.confidence}% based on detected intent.</li>
                    <li>{action.safe ? "Marked safe by deterministic rules." : "Flagged for review by deterministic rules."}</li>
                    {memory?.preferredDays?.length ? (
                      <li>Client prefers {memory.preferredDays.join(", ")}.</li>
                    ) : null}
                    {memory?.preferredTimes?.length ? (
                      <li>Client prefers {memory.preferredTimes.join(", ")}.</li>
                    ) : null}
                    {action.rules?.length ? (
                      <li>Rules: {action.rules.join(", ")}.</li>
                    ) : null}
                  </ul>
                  {action.fields && Object.keys(action.fields).length ? (
                    <div className="mt-3 rounded-md border border-zinc-200 bg-white px-3 py-2">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Extracted fields</div>
                      <div className="mt-2 grid gap-1 text-xs text-zinc-600">
                        {Object.entries(action.fields).map(([key, value]) => (
                          <div key={key}>
                            <span className="uppercase text-[10px] text-zinc-500">{key}</span> · {value}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {slots.length > 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
          <div className="text-[11px] uppercase tracking-[0.2em] text-emerald-700">
            Suggested slots {slotLabel ? `· ${slotLabel}` : ""}
          </div>
          <div className="mt-2 grid gap-2">
            {slots.map((slot) => (
              <div key={slot.start} className="flex items-center justify-between gap-2">
                <span>
                  {new Date(slot.start).toLocaleString()} – {new Date(slot.end).toLocaleTimeString()}
                </span>
                <Button variant="primary" onClick={() => holdSlot(slot)}>
                  Hold slot
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
