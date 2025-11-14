// app/email-ai/logs/LogsClient.tsx
"use client";

import { useEffect } from "react";

export type LogRow = {
  id: string;
  createdAt: string;              // ISO
  receivedAt?: string | null;     // ISO | null
  subject: string | null;
  snippet: string | null;
  classification: string | null;  // 'inquiry' | 'job' | 'support' | 'spam' | 'other' ...
  action: string | null;          // 'queued_for_review' | 'draft_created' | 'auto_sent' | 'skipped_*' ...
  confidence: number | null;      // 0..1
  gmailThreadId: string | null;
  gmailMsgId: string | null;
  // rawMeta?: { emailEpochMs?: number } // (carried by server, but we don't rely on it on client)
};

export default function LogsClient({ seed }: { seed: LogRow[] }) {
  useEffect(() => {
    // ---------- tiny DOM helpers
    const $  = (s: string, r: Document | HTMLElement = document) => r.querySelector(s) as HTMLElement | null;
    const $$ = (s: string, r: Document | HTMLElement = document) => Array.from(r.querySelectorAll(s)) as HTMLElement[];

    // ---------- cache elements (match page.tsx IDs exactly)
    const listEl       = $("#list");
    const countEl      = $("#count");
    const olderBtn     = $("#older") as HTMLButtonElement | null;

    const tabBtns      = $$(".tab"); // buttons with data-tab

    const searchEl     = $("#q")    as HTMLInputElement  | null;
    const classEl      = $("#cls")  as HTMLSelectElement | null;
    const confEl       = $("#minc") as HTMLSelectElement | null;
    const selCount = document.getElementById("sel-n") as HTMLSpanElement | null;
    const selCountEl   = $("#sel-n");
    const chkAll       = $("#all")  as HTMLInputElement | null;

    const pvSubject    = $("#subj");
    const pvBody       = $("#body");

    const actSuggest   = $("#act-suggest") as HTMLButtonElement | null;
    const actSend      = $("#act-send")    as HTMLButtonElement | null;
    const actSave      = $("#act-save")    as HTMLButtonElement | null;
    const actSkip      = $("#act-skip")    as HTMLButtonElement | null;
    const actGmail     = $("#act-gmail")   as HTMLAnchorElement  | null;

    const refreshBtn   = $("#refresh") as HTMLButtonElement | null;
    const autoChk      = $("#auto")    as HTMLInputElement  | null;

    // If the essential containers aren’t present, bail silently (prevents null deref)
    if (!listEl || !countEl || !pvSubject || !pvBody) return;

    // ---------- state
    let rows: LogRow[] = Array.isArray(seed) ? seed.slice() : [];
    let activeTab = (localStorage.getItem("emailai_logs_tab") || "inbox") as "all"|"inbox"|"drafts"|"sent"|"skipped";
    let q = (localStorage.getItem("emailai_logs_query") || "").toLowerCase();
    let klass = localStorage.getItem("emailai_logs_class") || "";
    let confMin = Number(localStorage.getItem("emailai_logs_conf") || 0);
    let pageSize = Number(localStorage.getItem("emailai_logs_pagesize") || 50);
    const selected = new Set<string>(); // list selection (bulk)
    let openId: string | null = null;   // currently opened log
    let autoTimer: ReturnType<typeof setInterval> | null = null;

    // ---------- utils
    const toast = (m: string, ok = true) => {
      const t = document.createElement("div");
      t.textContent = m;
      Object.assign(t.style, {
        position: "fixed", bottom: "12px", left: "50%", transform: "translateX(-50%)",
        background: ok ? "#111" : "#b91c1c", color: "#fff",
        padding: "8px 12px", borderRadius: "6px", zIndex: "9999"
      });
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 1400);
    };

    const isInbox   = (a?: string|null) => a === "queued_for_review";
    const isDraft   = (a?: string|null) => a === "draft_created" || a === "drafted";
    const isSent    = (a?: string|null) => a === "auto_sent" || a === "sent";
    const isSkipped = (a?: string|null) => a === "skipped_blocked" || a === "skipped_manual" || a === "skipped";

    // Prefer receivedAt -> createdAt
    const stamp = (r: LogRow) =>
      (r.receivedAt ? Date.parse(r.receivedAt) : undefined) ??
      Date.parse(r.createdAt);

    const enableActions = (on: boolean) => {
      [actSuggest, actSend, actSave, actSkip].forEach(b => {
        if (!b) return;
        b.disabled = !on;
        b.classList.toggle("opacity-50", !on);
      });
    };

    const filtered = () => {
      const arr = rows.filter(r => {
        if (activeTab === "inbox"   && !isInbox(r.action))   return false;
        if (activeTab === "drafts"  && !isDraft(r.action))   return false;
        if (activeTab === "sent"    && !isSent(r.action))    return false;
        if (activeTab === "skipped" && !isSkipped(r.action)) return false;
        if (klass && (r.classification || "other") !== klass) return false;
        if (confMin && (typeof r.confidence !== "number" || r.confidence * 100 < confMin)) return false;
        if (q) {
          const blob = `${r.subject ?? ""} ${r.snippet ?? ""}`.toLowerCase();
          if (!blob.includes(q)) return false;
        }
        return true;
      });
      return arr.sort((a, b) => stamp(b) - stamp(a));
    };

// ---- pill colour helper
const pillClass = (k?: string | null) => {
  const map: Record<string, string> = {
    inquiry: "bg-emerald-100 text-emerald-800",
    job: "bg-blue-100 text-blue-800",
    support: "bg-sky-100 text-sky-800",
    spam: "bg-zinc-200 text-zinc-800",
    other: "bg-zinc-100 text-zinc-700",
    draft_created: "bg-indigo-100 text-indigo-800",
    drafted: "bg-indigo-100 text-indigo-800",
    auto_sent: "bg-indigo-200 text-indigo-900",
    sent: "bg-indigo-200 text-indigo-900",
    queued_for_review: "bg-amber-100 text-amber-800",
    skipped_blocked: "bg-rose-100 text-rose-800",
    skipped_manual: "bg-rose-100 text-rose-800",
    skipped: "bg-rose-100 text-rose-800",
  };

  return map[k ?? "other"] ?? map.other;
};
  
// ---------- rendering
function renderList() {
  const data = filtered();
  const slice = data.slice(0, pageSize);

  // if DOM elements are missing, just bail out safely
  if (!countEl || !listEl) return;

  countEl.textContent = String(data.length);
  listEl.innerHTML = "";

  for (const r of slice) {
    const li = document.createElement("li");
    li.dataset.id = r.id;
    li.className = "px-3 py-3 hover:bg-zinc-50";

    const checked = selected.has(r.id) ? "checked" : "";
    const when = new Date(stamp(r)).toLocaleString();

    li.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-start gap-2 min-w-0">
          <input type="checkbox" class="row-chk h-4 w-4 mt-1" ${checked}/>
          <div class="min-w-0">
            <div class="text-[11px] text-zinc-500">${when}</div>
            <div class="font-medium truncate max-w-[360px]">${r.subject ?? "(no subject)"}</div>
            <div class="text-xs text-zinc-600 truncate max-w-[420px]">${r.snippet ?? ""}</div>
            <div class="mt-1 flex gap-2 items-center">
              ${r.gmailThreadId ? '<a class="text-[11px] underline open-gmail" target="_blank">Open thread</a>' : ""}
            </div>
          </div>
        </div>
        <div class="shrink-0 text-right space-y-1">
          <span class="inline-flex items-center rounded px-2 py-0.5 text-2xs font-medium ${pillClass(r.classification)}">
            ${r.classification ?? "other"}
          </span><br/>
          <span class="inline-flex items-center rounded px-2 py-0.5 text-2xs font-medium ${pillClass(r.action)}">
            ${r.action ?? "queued_for_review"}
          </span>
          <div class="text-[11px] text-zinc-500">
            ${typeof r.confidence === "number" ? ((r.confidence * 100) | 0) + "%" : "—"}
          </div>
        </div>
      </div>
    `;

li.addEventListener("click", (ev) => {
  if ((ev.target as HTMLElement).classList.contains("row-chk")) return;
  openOne(r.id);
});

    li.querySelector(".row-chk")?.addEventListener("change", (ev: any) => {
      if (ev.target.checked) selected.add(r.id);
      else selected.delete(r.id);
      if (selCount) selCount.textContent = `${selected.size} selected`;
    });

    li.querySelector(".open-gmail")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (r.gmailThreadId) {
        window.open(
          `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(r.gmailThreadId)}`,
          "_blank",
          "noopener"
        );
      }
    });

    listEl.appendChild(li);
  }

  if (olderBtn) {
    olderBtn.style.visibility = data.length > slice.length ? "visible" : "hidden";
  }
}

    async function fetchFull(id: string) {
      const r = await fetch(`/api/email-ai/log/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }

    async function suggestFor(id: string, quietRedirectToReview = false) {
      try {
        const body = (document.getElementById("draft-body") as HTMLTextAreaElement)?.value || "";
        const subj = (document.getElementById("draft-subj") as HTMLInputElement)?.value || "";
        const res = await fetch("/api/email-ai/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: "queue_suggested", id, subject: subj, body })
        });
        if (!res.ok) throw 0;
        toast("Suggested reply created → Review ✅");
        if (quietRedirectToReview) location.href = "/email-ai/review";
      } catch {
        toast("Suggest failed", false);
      }
    }

    async function openOne(id: string) {
      openId = id;
      enableActions(true); // enable the top bar actions immediately (compose loads async)

      // reset preview
      pvSubject!.textContent = "Loading…";
      pvBody!.innerHTML = `<div class="text-zinc-500 p-6 text-center">Loading…</div>`;
      if (actGmail) actGmail.classList.add("opacity-50", "pointer-events-none");

      try {
        const j = await fetchFull(id);

        // subject
        pvSubject!.textContent = j.subject || "(no subject)";

        // thread + draft UI
        const when = new Date(j.createdAt ?? new Date().toISOString()).toLocaleString?.() ?? "";
        const suggestedSubject = j.suggested?.subject ?? (j.subject ? `Re: ${j.subject}` : "");
        const suggestedBody = (j.suggested?.body ?? j.snippet ?? "").toString();

        pvBody!.innerHTML = `
          <div class="space-y-4">
            ${(Array.isArray(j.thread) ? j.thread : []).map((m: any) => `
              <div class="rounded border p-3">
                <div class="text-xs text-zinc-500">${m.date ?? ""} — <b>${m.from ?? ""}</b></div>
                <div class="mt-2 whitespace-pre-wrap text-zinc-800">${m.body ?? ""}</div>
              </div>
            `).join("")}
            <div class="rounded border bg-zinc-50 p-3">
              <div class="text-xs text-zinc-500">${when}</div>
              <div class="mt-2 whitespace-pre-wrap text-zinc-800">${j.body ?? j.snippet ?? "(no preview)"}</div>
            </div>
            <div class="rounded border p-0">
              <div class="px-3 py-2 text-sm font-medium bg-indigo-50 border-b">Compose</div>
              <div class="p-3 space-y-2">
                <input id="draft-subj" class="w-full border rounded px-3 py-2 text-sm" placeholder="Subject" value="${suggestedSubject}">
                <textarea id="draft-body" class="w-full border rounded px-3 py-2 text-sm min-h-[220px]" placeholder="Write your reply…">${suggestedBody}</textarea>
                <div class="flex gap-2">
                  <button id="btn-suggest" class="px-2 py-1 border rounded text-xs">Create suggested reply</button>
                  <button id="btn-rewrite" class="px-2 py-1 border rounded text-xs">Rewrite</button>
                </div>
              </div>
            </div>
          </div>
        `;

        // compose helpers
        $("#btn-suggest")?.addEventListener("click", () => suggestFor(id, false));
        $("#btn-rewrite")?.addEventListener("click", async () => {
          try {
            const body = (document.getElementById("draft-body") as HTMLTextAreaElement)?.value || "";
            const res = await fetch("/api/email-ai/rewrite", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ logId: id, body })
            });
            if (!res.ok) throw 0;
            const j2 = await res.json();
            (document.getElementById("draft-body") as HTMLTextAreaElement).value = j2.body || body;
            toast("Rewritten");
          } catch {
            toast("Rewrite failed", false);
          }
        });

        if (j.gmailThreadId && actGmail) {
          actGmail.href = `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(j.gmailThreadId)}`;
          actGmail.classList.remove("opacity-50", "pointer-events-none");
        }

        // store selected id on action buttons
        if (actSend) (actSend as any).dataset.id = id;
        if (actSave) (actSave as any).dataset.id = id;
        if (actSkip) (actSkip as any).dataset.id = id;
        if (actSuggest) (actSuggest as any).dataset.id = id;

      } catch {
        pvSubject!.textContent = "(Failed to load)";
        pvBody!.innerHTML = `<div class="text-rose-600 p-6 text-center">Failed to load.</div>`;
      }
    }

    async function postAction(op: "approve" | "save_draft" | "skip", id: string, payload?: { subject?: string; body?: string }) {
      const res = await fetch("/api/email-ai/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, id, subject: payload?.subject, body: payload?.body })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }

    // ---------- wire tabs
    tabBtns.forEach(btn => {
      const el = btn as HTMLButtonElement;
      if (el.dataset.tab === activeTab) el.classList.add("bg-zinc-900", "text-white");
      el.addEventListener("click", () => {
        tabBtns.forEach(x => x.classList.remove("bg-zinc-900", "text-white"));
        el.classList.add("bg-zinc-900", "text-white");
        activeTab = (el.dataset.tab as any) || "inbox";
        localStorage.setItem("emailai_logs_tab", activeTab);
        selected.clear();
        if (selCountEl) selCountEl.textContent = "0 selected";
        openId = null;
        enableActions(false);
        pvSubject!.textContent = "(Select an item)";
        pvBody!.innerHTML = `<div class="p-6 text-zinc-500">No email selected.</div>`;
        renderList();
      });
    });

    // ---------- wire filters
    if (searchEl) {
      searchEl.value = q;
      searchEl.addEventListener("input", e => {
        q = (e.target as HTMLInputElement).value.trim().toLowerCase();
        localStorage.setItem("emailai_logs_query", q);
        renderList();
      });
    }
    if (classEl) {
      classEl.value = klass;
      classEl.addEventListener("change", e => {
        klass = (e.target as HTMLSelectElement).value;
        localStorage.setItem("emailai_logs_class", klass);
        renderList();
      });
    }
    if (confEl) {
      confEl.value = confMin ? String(confMin) : "";
      confEl.addEventListener("change", e => {
        confMin = Number((e.target as HTMLSelectElement).value || 0);
        localStorage.setItem("emailai_logs_conf", String(confMin));
        renderList();
      });
    }

    // ---------- bulk/select all
    if (chkAll) {
      chkAll.addEventListener("change", () => {
        const on = chkAll.checked;
        $$(".row-chk", listEl).forEach(c => {
          const li = c.closest("li") as HTMLElement | null;
          const id = li?.dataset.id;
          if (!id) return;
          (c as HTMLInputElement).checked = on;
          if (on) selected.add(id); else selected.delete(id);
        });
        if (selCountEl) selCountEl.textContent = `${selected.size} selected`;
      });
    }

    // ---------- top actions
    if (actSuggest) {
      actSuggest.addEventListener("click", () => {
        const id = (actSuggest as any).dataset.id as string | undefined;
        if (!id) return toast("Select a log first", false);
        suggestFor(id, false);
      });
    }

    if (actSend) {
      actSend.addEventListener("click", async () => {
        const id = (actSend as any).dataset.id as string | undefined;
        if (!id) return toast("Select a log first", false);
        actSend.disabled = true;
        try {
          const subj = (document.getElementById("draft-subj") as HTMLInputElement)?.value;
          const body = (document.getElementById("draft-body") as HTMLTextAreaElement)?.value;
          await postAction("approve", id, { subject: subj, body });
          toast("Sent ✅");
        } catch (e: any) {
          toast(`Send failed: ${e?.message || "error"}`, false);
        } finally {
          actSend.disabled = false;
        }
      });
    }

    if (actSave) {
      actSave.addEventListener("click", async () => {
        const id = (actSave as any).dataset.id as string | undefined;
        if (!id) return toast("Select a log first", false);
        actSave.disabled = true;
        try {
          const subj = (document.getElementById("draft-subj") as HTMLInputElement)?.value;
          const body = (document.getElementById("draft-body") as HTMLTextAreaElement)?.value;
          await postAction("save_draft", id, { subject: subj, body });
          toast("Draft saved ✍️");
        } catch (e: any) {
          toast(`Save failed: ${e?.message || "error"}`, false);
        } finally {
          actSave.disabled = false;
        }
      });
    }

    if (actSkip) {
      actSkip.addEventListener("click", async () => {
        const id = (actSkip as any).dataset.id as string | undefined;
        if (!id) return toast("Select a log first", false);
        actSkip.disabled = true;
        try {
          await postAction("skip", id);
          toast("Skipped");
        } catch (e: any) {
          toast(`Skip failed: ${e?.message || "error"}`, false);
        } finally {
          actSkip.disabled = false;
        }
      });
    }

    if (olderBtn) {
      olderBtn.addEventListener("click", () => {
        pageSize += 50;
        localStorage.setItem("emailai_logs_pagesize", String(pageSize));
        renderList();
      });
    }

    // ---------- refresh + auto-refresh
    const stopAuto = () => { if (autoTimer) clearInterval(autoTimer); autoTimer = null; };
    const startAuto = () => {
      stopAuto();
      if (!refreshBtn) return;
      autoTimer = setInterval(() => refreshBtn.click(), 30_000);
    };

    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        const u = new URL(location.href);
        u.searchParams.set("_", String(Date.now()));
        location.href = u.toString();
      });
    }

    if (autoChk) {
      const autoOn = localStorage.getItem("emailai_logs_autorefresh") === "1";
      if (autoOn) { autoChk.checked = true; startAuto(); }
      autoChk.addEventListener("change", () => {
        if (autoChk.checked) { localStorage.setItem("emailai_logs_autorefresh","1"); startAuto(); }
        else { localStorage.removeItem("emailai_logs_autorefresh"); stopAuto(); }
      });
    }

    // ---------- first render
    // highlight current tab button
    tabBtns.forEach(b => {
      b.classList.toggle("bg-zinc-900", (b as HTMLButtonElement).dataset.tab === activeTab);
      b.classList.toggle("text-white", (b as HTMLButtonElement).dataset.tab === activeTab);
    });
    enableActions(false);
    renderList();

    // ---------- cleanup
    return () => { stopAuto(); };
  }, [seed]);

  return null;
}