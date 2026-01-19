"use client";

import React from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Toast from "@/components/ui/Toast";

type Memory = {
  preferredDays?: string[];
  preferredTimes?: string[];
  lastServiceId?: string | null;
  tonePreference?: "DEFAULT" | "FORMAL" | "CASUAL";
  notes?: string | null;
  cancellationCount?: number;
};

export default function ClientMemoryPanel({ clientId }: { clientId: string }) {
  const [memory, setMemory] = React.useState<Memory>({});
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [toast, setToast] = React.useState<{ message: string; variant: "success" | "error" } | null>(null);
  const loadAbortRef = React.useRef<AbortController | null>(null);
  const saveAbortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    if (loadAbortRef.current) loadAbortRef.current.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/org/clients/${clientId}/profile`, { cache: "no-store", signal: controller.signal });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.ok) {
          setMemory(data.profile || {});
        }
      } catch (e: any) {
        if (e?.name !== "AbortError") {
          setToast({ message: "Failed to load client memory.", variant: "error" });
        }
      } finally {
        setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [clientId]);

  async function save() {
    if (saveAbortRef.current) saveAbortRef.current.abort();
    const controller = new AbortController();
    saveAbortRef.current = controller;
    setSaving(true);
    try {
      const res = await fetch(`/api/org/clients/${clientId}/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(memory),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Save failed");
      }
      setMemory(data.profile || memory);
      setToast({ message: "Client memory saved.", variant: "success" });
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        setToast({ message: e?.message || "Failed to save.", variant: "error" });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-4 space-y-4">
      {toast && (
        <div className="fixed right-6 top-6 z-[80]">
          <Toast message={toast.message} variant={toast.variant} />
        </div>
      )}
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Client memory</p>
        <p className="text-sm text-zinc-600">
          Preferences stored here influence suggestions and slot ranking.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs uppercase tracking-widest text-zinc-500">
          Preferred days
          <Input
            placeholder="Mon, Tue"
            value={(memory.preferredDays || []).join(", ")}
            onChange={(e) =>
              setMemory((prev) => ({
                ...prev,
                preferredDays: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              }))
            }
            disabled={loading || saving}
          />
        </label>
        <label className="grid gap-1 text-xs uppercase tracking-widest text-zinc-500">
          Preferred times
          <Input
            placeholder="Morning, 3pm"
            value={(memory.preferredTimes || []).join(", ")}
            onChange={(e) =>
              setMemory((prev) => ({
                ...prev,
                preferredTimes: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              }))
            }
            disabled={loading || saving}
          />
        </label>
        <label className="grid gap-1 text-xs uppercase tracking-widest text-zinc-500">
          Tone preference
          <Select
            value={memory.tonePreference || "DEFAULT"}
            onChange={(e) => setMemory((prev) => ({ ...prev, tonePreference: e.target.value as Memory["tonePreference"] }))}
            disabled={loading || saving}
          >
            <option value="DEFAULT">Default</option>
            <option value="FORMAL">Formal</option>
            <option value="CASUAL">Casual</option>
          </Select>
        </label>
        <label className="grid gap-1 text-xs uppercase tracking-widest text-zinc-500">
          Cancellation count
          <Input
            type="number"
            min={0}
            value={memory.cancellationCount ?? 0}
            onChange={(e) => setMemory((prev) => ({ ...prev, cancellationCount: Number(e.target.value) || 0 }))}
            disabled={loading || saving}
          />
        </label>
      </div>

      <label className="grid gap-1 text-xs uppercase tracking-widest text-zinc-500">
        Notes
        <textarea
          className="min-h-[96px] rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-900"
          value={memory.notes || ""}
          onChange={(e) => setMemory((prev) => ({ ...prev, notes: e.target.value }))}
          disabled={loading || saving}
        />
      </label>

      <div className="flex items-center gap-2">
        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save memory"}
        </Button>
        {loading && <span className="text-xs text-zinc-500">Loading…</span>}
      </div>
    </Card>
  );
}
