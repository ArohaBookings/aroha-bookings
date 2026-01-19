"use client";

import React from "react";
import { Button } from "@/components/ui";

type MessagesSettings = {
  enableAutoDraft: boolean;
  enableAutoSend: boolean;
  minConfidence: number;
  blockedCategories: string[];
  dailySendCap: number;
  businessHoursOnly: boolean;
  requireApprovalForFirstN: number;
};

type KnowledgeBaseEntry = {
  id: string;
  title: string;
  content: string;
  tags?: string[];
};

function defaultSettings(): MessagesSettings {
  return {
    enableAutoDraft: true,
    enableAutoSend: false,
    minConfidence: 92,
    blockedCategories: ["complaint", "legal", "medical_sensitive"],
    dailySendCap: 20,
    businessHoursOnly: true,
    requireApprovalForFirstN: 25,
  };
}

export default function MessagesSettingsPage() {
  const [settings, setSettings] = React.useState<MessagesSettings>(defaultSettings());
  const [knowledgeBase, setKnowledgeBase] = React.useState<KnowledgeBaseEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [entitlementError, setEntitlementError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const res = await fetch("/api/messages/settings", { cache: "no-store" });
        const j = await res.json();
        if (!cancelled && !j?.ok) {
          setEntitlementError(j?.error || "Messages Hub is not included in your plan.");
          return;
        }
        if (!cancelled && j?.ok) {
          setEntitlementError(null);
          setSettings(j.settings || defaultSettings());
          setKnowledgeBase(j.knowledgeBase || []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/messages/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings, knowledgeBase }),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Save failed");
      setSettings(j.settings || settings);
      setKnowledgeBase(j.knowledgeBase || knowledgeBase);
      setSuccess("Saved messages settings.");
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Messages settings</h1>
          <p className="text-sm text-zinc-600">
            Configure automation, safety rails, and the knowledge base for messaging channels.
          </p>
        </div>
        <Button onClick={onSave} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
      </header>

      {(error || success) && (
        <div
          className={`rounded-md border px-4 py-2 text-sm ${
            error ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          {error || success}
        </div>
      )}

      {entitlementError && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          {entitlementError}{" "}
          <a className="font-semibold underline" href="/settings">
            Upgrade to enable Messages Hub
          </a>
          .
        </div>
      )}

      {loading ? (
        <div className="text-sm text-zinc-500">Loading settings…</div>
      ) : (
        <>
          <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
            <div className="px-5 py-3 border-b border-zinc-200 font-semibold">Automation & safety</div>
            <div className="p-5 grid gap-4 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.enableAutoDraft}
                  onChange={(e) => setSettings({ ...settings, enableAutoDraft: e.target.checked })}
                />
                Enable auto-drafts
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.enableAutoSend}
                  onChange={(e) => setSettings({ ...settings, enableAutoSend: e.target.checked })}
                />
                Enable auto-send (safe only)
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-xs text-zinc-600">Min confidence</span>
                <input
                  type="number"
                  className="h-9 rounded-md border border-zinc-200 px-3 text-sm"
                  value={settings.minConfidence}
                  onChange={(e) =>
                    setSettings({ ...settings, minConfidence: Number(e.target.value || 0) })
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-xs text-zinc-600">Daily send cap</span>
                <input
                  type="number"
                  className="h-9 rounded-md border border-zinc-200 px-3 text-sm"
                  value={settings.dailySendCap}
                  onChange={(e) =>
                    setSettings({ ...settings, dailySendCap: Number(e.target.value || 0) })
                  }
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.businessHoursOnly}
                  onChange={(e) => setSettings({ ...settings, businessHoursOnly: e.target.checked })}
                />
                Business hours only
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-xs text-zinc-600">Require approval for first N</span>
                <input
                  type="number"
                  className="h-9 rounded-md border border-zinc-200 px-3 text-sm"
                  value={settings.requireApprovalForFirstN}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      requireApprovalForFirstN: Number(e.target.value || 0),
                    })
                  }
                />
              </label>
              <label className="grid gap-1 text-sm sm:col-span-2">
                <span className="text-xs text-zinc-600">Blocked categories (comma separated)</span>
                <input
                  className="h-9 rounded-md border border-zinc-200 px-3 text-sm"
                  value={settings.blockedCategories.join(", ")}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      blockedCategories: e.target.value
                        .split(",")
                        .map((x) => x.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
            </div>
          </section>

          <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
            <div className="px-5 py-3 border-b border-zinc-200 font-semibold">Knowledge base</div>
            <div className="p-5 space-y-4">
              {knowledgeBase.length === 0 && (
                <div className="text-sm text-zinc-500">
                  No entries yet. Add pricing, address, and policy snippets here.
                </div>
              )}
              {knowledgeBase.map((entry) => (
                <div key={entry.id} className="grid gap-2 rounded-lg border border-zinc-200 p-4">
                  <input
                    className="h-9 rounded-md border border-zinc-200 px-3 text-sm"
                    value={entry.title}
                    onChange={(e) => {
                      setKnowledgeBase((prev) =>
                        prev.map((item) =>
                          item.id === entry.id ? { ...item, title: e.target.value } : item
                        )
                      );
                    }}
                    placeholder="Title"
                  />
                  <textarea
                    className="h-24 rounded-md border border-zinc-200 px-3 py-2 text-sm"
                    value={entry.content}
                    onChange={(e) => {
                      setKnowledgeBase((prev) =>
                        prev.map((item) =>
                          item.id === entry.id ? { ...item, content: e.target.value } : item
                        )
                      );
                    }}
                    placeholder="Canned response or policy"
                  />
                  <input
                    className="h-9 rounded-md border border-zinc-200 px-3 text-sm"
                    value={(entry.tags || []).join(", ")}
                    onChange={(e) => {
                      setKnowledgeBase((prev) =>
                        prev.map((item) =>
                          item.id === entry.id
                            ? {
                                ...item,
                                tags: e.target.value
                                  .split(",")
                                  .map((x) => x.trim())
                                  .filter(Boolean),
                              }
                            : item
                        )
                      );
                    }}
                    placeholder="Tags (optional)"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setKnowledgeBase((prev) => prev.filter((item) => item.id !== entry.id))
                    }
                    className="text-xs text-rose-600"
                  >
                    Remove entry
                  </button>
                </div>
              ))}
              <Button
                variant="secondary"
                onClick={() =>
                  setKnowledgeBase((prev) => [
                    ...prev,
                    {
                      id: `kb_${Date.now()}`,
                      title: "",
                      content: "",
                      tags: [],
                    },
                  ])
                }
              >
                Add knowledge entry
              </Button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
