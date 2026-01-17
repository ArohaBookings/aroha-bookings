"use client";

import React from "react";
import type { AutomationRule } from "@/lib/automation/rules";
import { saveAutomationSettings } from "./actions";

const RULE_TYPES = [
  { value: "NO_SHOW_COUNT", label: "No-show count" },
  { value: "REPEAT_CLIENT", label: "Repeat client" },
  { value: "LATE_APPOINTMENT", label: "Late appointment" },
] as const;

const ACTION_TYPES = [
  { value: "FLAG_CLIENT", label: "Flag client" },
  { value: "REQUIRE_CONFIRMATION", label: "Require confirmation" },
  { value: "SKIP_REMINDER", label: "Skip reminder" },
  { value: "NOTIFY_NEXT_CLIENT", label: "Notify next client" },
] as const;

function uid() {
  return `rule_${Math.random().toString(36).slice(2, 9)}`;
}

export default function AutomationClient({
  initialRules,
  planLimits,
  planFeatures,
}: {
  initialRules: AutomationRule[];
  planLimits: { bookingsPerMonth: number | null; staffCount: number | null; automations: number | null };
  planFeatures: Record<string, boolean>;
}) {
  const [rules, setRules] = React.useState<AutomationRule[]>(initialRules);
  const [saving, setSaving] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [simulateId, setSimulateId] = React.useState("");
  const [simulation, setSimulation] = React.useState<{ text: string; details: any[] } | null>(null);
  const [suggestions, setSuggestions] = React.useState<AutomationRule[] | null>(null);
  const [recovery, setRecovery] = React.useState<{
    enableMissedCalls: boolean;
    enableNoShow: boolean;
    enableAbandoned: boolean;
    autoSend: boolean;
    autoSendMinConfidence: number;
    businessHoursOnly: boolean;
    dailyCap: number;
  } | null>(null);
  const [recoveryDirty, setRecoveryDirty] = React.useState(false);
  const [recoverySaving, setRecoverySaving] = React.useState(false);
  const [recoveryItems, setRecoveryItems] = React.useState<
    Array<{ type: string; target: string; timing: string; message: string; ai: boolean }>
  >([]);
  const [recoveryBusy, setRecoveryBusy] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch("/api/org/recovery/settings", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) return;
      if (alive) setRecovery(json.settings);
    })();
    return () => {
      alive = false;
    };
  }, []);

  function updateRule(id: string, patch: Partial<AutomationRule>) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function addRule() {
    setRules((prev) => [
      ...prev,
      {
        id: uid(),
        enabled: true,
        when: { type: "NO_SHOW_COUNT", threshold: 1, windowDays: 30 },
        then: { action: "REQUIRE_CONFIRMATION" },
      },
    ]);
  }

  function removeRule(id: string) {
    setRules((prev) => prev.filter((r) => r.id !== id));
  }

  async function save() {
    setSaving(true);
    setNotice(null);
    try {
      const res = await saveAutomationSettings(rules);
      if (!res.ok) {
        setNotice("Failed to save rules.");
      } else {
        setNotice("Rules saved.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function runSimulation() {
    if (!simulateId) return;
    setSimulation(null);
    const res = await fetch("/api/org/automations/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointmentId: simulateId, rules }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setSimulation({ text: data.error || "Simulation failed.", details: [] });
      return;
    }
    setSimulation({ text: data.explanation, details: data.results || [] });
  }

  async function loadSuggestions() {
    setSuggestions(null);
    const res = await fetch("/api/org/automations/suggest");
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setNotice(data.error || "Failed to load suggestions.");
      return;
    }
    setSuggestions(data.rules || []);
    if (data.note) setNotice(data.note);
  }

  function addSuggested(rule: AutomationRule) {
    setRules((prev) => [...prev, { ...rule, id: uid() }]);
  }

  const limitReached =
    planLimits.automations !== null && rules.length >= planLimits.automations;

  return (
    <div className="space-y-6">
      {!planFeatures.automations && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-700">
          Automations are locked on your current plan. Upgrade to enable rules and no-show guardrails.
        </div>
      )}
      {limitReached && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-700">
          You have reached your automation limit ({planLimits.automations}). You can still add rules,
          but only the first {planLimits.automations} will be enforced until you upgrade.
        </div>
      )}
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">Automation rules</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Rules are suggestions only until you save. AI never enables rules automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={addRule}
            className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
          >
            Add rule
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {rules.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-200 p-4 text-sm text-zinc-500">
              No rules yet. Add a rule or load suggestions.
            </div>
          ) : (
            rules.map((rule) => (
              <div key={rule.id} className="rounded-xl border border-zinc-200 p-4">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm text-zinc-700">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(e) => updateRule(rule.id, { enabled: e.target.checked })}
                    />
                    Enabled
                  </label>
                  <button
                    type="button"
                    onClick={() => removeRule(rule.id)}
                    className="text-xs text-zinc-500 hover:underline"
                  >
                    Remove
                  </button>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_1fr]">
                  <div>
                    <p className="text-xs text-zinc-500">When</p>
                    <select
                      className="mt-1 w-full rounded-md border border-zinc-200 px-2 py-1.5 text-sm"
                      value={rule.when.type}
                      onChange={(e) =>
                        updateRule(rule.id, { when: { ...rule.when, type: e.target.value as any } })
                      }
                    >
                      {RULE_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">Threshold</p>
                    <input
                      type="number"
                      className="mt-1 w-full rounded-md border border-zinc-200 px-2 py-1.5 text-sm"
                      value={rule.when.threshold ?? 1}
                      onChange={(e) =>
                        updateRule(rule.id, {
                          when: { ...rule.when, threshold: Number(e.target.value || 1) },
                        })
                      }
                      min={1}
                    />
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">Window (days)</p>
                    <input
                      type="number"
                      className="mt-1 w-full rounded-md border border-zinc-200 px-2 py-1.5 text-sm"
                      value={rule.when.windowDays ?? 30}
                      onChange={(e) =>
                        updateRule(rule.id, {
                          when: { ...rule.when, windowDays: Number(e.target.value || 30) },
                        })
                      }
                      min={1}
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <p className="text-xs text-zinc-500">Then</p>
                  <select
                    className="mt-1 w-full rounded-md border border-zinc-200 px-2 py-1.5 text-sm"
                    value={rule.then.action}
                    onChange={(e) =>
                      updateRule(rule.id, { then: { ...rule.then, action: e.target.value as any } })
                    }
                  >
                    {ACTION_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs text-zinc-500">{notice || " "}</div>
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="rounded-md bg-black px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save rules"}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900">Missed revenue recovery</h3>
            <p className="mt-1 text-xs text-zinc-500">
              Drafts follow-ups for missed calls and no-shows. Supervised by default.
            </p>
          </div>
          <button
            type="button"
            onClick={async () => {
              if (!recovery) return;
              setRecoverySaving(true);
              try {
                const res = await fetch("/api/org/recovery/settings", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(recovery),
                });
                const json = await res.json();
                if (res.ok && json?.ok) {
                  setRecovery(json.settings);
                  setRecoveryDirty(false);
                }
              } finally {
                setRecoverySaving(false);
              }
            }}
            className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            disabled={!recovery || recoverySaving || !recoveryDirty}
          >
            {recoverySaving ? "Saving…" : "Save recovery settings"}
          </button>
        </div>

        {!recovery ? (
          <div className="mt-4 text-xs text-zinc-500">Loading recovery settings…</div>
        ) : (
          <div className="mt-4 grid gap-4">
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="flex items-center gap-2 text-xs text-zinc-700">
                <input
                  type="checkbox"
                  checked={recovery.enableMissedCalls}
                  onChange={(e) => {
                    setRecovery({ ...recovery, enableMissedCalls: e.target.checked });
                    setRecoveryDirty(true);
                  }}
                />
                Enable missed-call follow-ups
              </label>
              <label className="flex items-center gap-2 text-xs text-zinc-700">
                <input
                  type="checkbox"
                  checked={recovery.enableNoShow}
                  onChange={(e) => {
                    setRecovery({ ...recovery, enableNoShow: e.target.checked });
                    setRecoveryDirty(true);
                  }}
                />
                Enable no-show recovery
              </label>
              <label className="flex items-center gap-2 text-xs text-zinc-700">
                <input
                  type="checkbox"
                  checked={recovery.enableAbandoned}
                  onChange={(e) => {
                    setRecovery({ ...recovery, enableAbandoned: e.target.checked });
                    setRecoveryDirty(true);
                  }}
                />
                Enable abandoned booking follow-ups
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex items-center gap-2 text-xs text-zinc-700">
                <input
                  type="checkbox"
                  checked={recovery.autoSend}
                  onChange={(e) => {
                    setRecovery({ ...recovery, autoSend: e.target.checked });
                    setRecoveryDirty(true);
                  }}
                />
                Allow auto-send
              </label>
              <label className="flex items-center gap-2 text-xs text-zinc-700">
                <input
                  type="checkbox"
                  checked={recovery.businessHoursOnly}
                  onChange={(e) => {
                    setRecovery({ ...recovery, businessHoursOnly: e.target.checked });
                    setRecoveryDirty(true);
                  }}
                />
                Business hours only
              </label>
              <label className="text-xs text-zinc-700">
                Daily cap
                <input
                  type="number"
                  min={0}
                  className="mt-1 w-full rounded-md border border-zinc-200 px-2 py-1.5 text-xs"
                  value={recovery.dailyCap}
                  onChange={(e) => {
                    setRecovery({ ...recovery, dailyCap: Number(e.target.value || 0) });
                    setRecoveryDirty(true);
                  }}
                />
              </label>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  setRecoveryBusy(true);
                  try {
                    const res = await fetch("/api/org/recovery/suggest");
                    const json = await res.json();
                    if (res.ok && json?.ok) setRecoveryItems(json.items || []);
                  } finally {
                    setRecoveryBusy(false);
                  }
                }}
                className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
              >
                {recoveryBusy ? "Loading…" : "Preview follow-ups"}
              </button>
              <span className="text-xs text-zinc-500">
                {recovery.enableAbandoned ? "Abandoned flow is enabled if detected." : "Abandoned flow requires detection."}
              </span>
            </div>

            {recoveryItems.length ? (
              <div className="grid gap-2">
                {recoveryItems.map((item, idx) => (
                  <div key={`${item.type}-${idx}`} className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs">
                    <div className="font-semibold text-zinc-800">
                      {item.type.replace("_", " ")} • {item.timing}
                    </div>
                    <div className="mt-1 text-zinc-600">Target: {item.target}</div>
                    <div className="mt-2 text-zinc-700">{item.message}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-zinc-900">Simulate rule</h3>
        <p className="mt-1 text-xs text-zinc-500">Dry-run on an appointment ID (no side effects).</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={simulateId}
            onChange={(e) => setSimulateId(e.target.value)}
            placeholder="Appointment ID"
            className="min-w-[240px] rounded-md border border-zinc-200 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={runSimulation}
            className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
          >
            Simulate
          </button>
        </div>
        {simulation ? (
          <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
            <p className="text-xs text-zinc-500">Summary</p>
            <p className="mt-1">{simulation.text}</p>
            <div className="mt-3 space-y-2">
              {simulation.details.map((d: any) => (
                <div key={d.ruleId} className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs">
                  <span className="font-semibold">{d.action}</span> — {d.reason}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900">Suggested rules</h3>
            <p className="mt-1 text-xs text-zinc-500">Based on recent behavior. Not auto-applied.</p>
          </div>
          <button
            type="button"
            onClick={loadSuggestions}
            className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
          >
            Load suggestions
          </button>
        </div>
        <div className="mt-4 space-y-3">
          {suggestions?.length ? (
            suggestions.map((rule, idx) => (
              <div key={`${rule.when.type}-${idx}`} className="rounded-xl border border-zinc-200 p-4">
                <p className="text-xs text-zinc-500">Suggested rule</p>
                <p className="mt-1 text-sm text-zinc-800">
                  IF {rule.when.type.replace("_", " ")} THEN {rule.then.action.replace("_", " ")}
                </p>
                <button
                  type="button"
                  onClick={() => addSuggested(rule)}
                  className="mt-2 rounded-md border border-zinc-200 bg-white px-3 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
                >
                  Add
                </button>
              </div>
            ))
          ) : (
            <p className="text-xs text-zinc-500">No suggestions loaded yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
