// app/email-ai/review/reviewclient.tsx
'use client';

import { useEffect } from 'react';

export default function ReviewClient() {
  useEffect(() => {
    // ---------- tiny helpers ----------
    const $ = (s: string, r: Document | HTMLElement = document) =>
      r.querySelector(s) as HTMLElement | null;
    const $$ = (s: string, r: Document | HTMLElement = document) =>
      Array.from(r.querySelectorAll(s)) as HTMLElement[];

    const safeText = (el: Element | null) => (el?.textContent ?? '').trim();

    // ---------- refresh / auto-refresh ----------
    const refresh = () => {
      try {
        const u = new URL(location.href);
        u.searchParams.set('_', String(Date.now()));
        location.href = u.toString();
      } catch {
        location.reload();
      }
    };

    const refreshBtn = $('#refresh-btn');
    const handleRefresh = () => refresh();
    refreshBtn?.addEventListener('click', handleRefresh);

    const auto = $('#autorefresh-toggle') as HTMLInputElement | null;
    let autoTimer: number | null = null;
    const AUTO_KEY = 'emailai_autorefresh';

    const startAuto = () => {
      if (autoTimer) return;
      autoTimer = window.setInterval(refresh, 30_000);
    };
    const stopAuto = () => {
      if (!autoTimer) return;
      clearInterval(autoTimer);
      autoTimer = null;
    };

    if (auto && localStorage.getItem(AUTO_KEY) === '1') {
      auto.checked = true;
      startAuto();
    }
    const handleAutoChange = () => {
      if (!auto) return;
      if (auto.checked) {
        localStorage.setItem(AUTO_KEY, '1');
        startAuto();
      } else {
        localStorage.removeItem(AUTO_KEY);
        stopAuto();
      }
    };
    auto?.addEventListener('change', handleAutoChange);

    // ---------- API helper ----------
    const API =
      (typeof location !== 'undefined' && location.origin ? location.origin : '') +
      '/api/email-ai/action';

    const postJSON = async (url: string, body: any) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify(body || {}),
      });
      const txt = await res.text();
      let j: any = null;
      try {
        j = txt ? JSON.parse(txt) : null;
      } catch {
        /* ignore parse error; keep txt */
      }
      if (!res.ok || (j && j.ok === false)) {
        const msg = (j && (j.error || j.message)) || txt || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      return j || { ok: true };
    };

    const sendFeedback = async (logId: string, action: string) => {
      try {
        await fetch("/api/email-ai/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ logId, action, source: "email-ai-review" }),
        });
      } catch {}
    };

    const removeRow = (row: HTMLElement | null) => {
      if (!row) return;
      row.style.opacity = '0.5';
      setTimeout(() => row.remove(), 120);
    };

    // ---------- elements used across features ----------
    const countLabel = $('#count-label');
    const search = $('#search') as HTMLInputElement | null;
    const classFilter = $('#class-filter') as HTMLSelectElement | null;
    const confFilter = $('#conf-filter') as HTMLSelectElement | null;

    const chkAll = $('#chk-all') as HTMLInputElement | null;
    const selectedCount = $('#selected-count');
    const bulkSend = $('#bulk-send') as HTMLButtonElement | null;
    const bulkSkip = $('#bulk-skip') as HTMLButtonElement | null;

    // ---------- selection helpers ----------
    const visibleRows = () =>
      $$('#queue-list > li').filter((li) => (li as HTMLElement).style.display !== 'none');

    const selectedRows = () =>
      visibleRows().filter((li) => {
        const box = li.querySelector('.row-chk') as HTMLInputElement | null;
        return !!box && box.checked;
      });

    const updateBulkState = () => {
      const n = selectedRows().length;
      if (selectedCount) selectedCount.textContent = n + ' selected';
      const disabled = n === 0;
      if (bulkSend) bulkSend.disabled = disabled;
      if (bulkSkip) bulkSkip.disabled = disabled;
    };

    // ---------- filtering ----------
    const applyFilters = () => {
      const q = (search?.value || '').toLowerCase().trim();
      const cls = (classFilter?.value || '').toLowerCase();
      const conf = Number(confFilter?.value || 0);

      let visible = 0;
      $$('#queue-list > li').forEach((li) => {
        const subjEl = li.querySelector('.font-medium');
        const prevEl = li.querySelector('details > div');

        const subject = safeText(subjEl).toLowerCase();
        const snippet = safeText(prevEl as Element | null).toLowerCase();

        const c = (li.getAttribute('data-class') || 'other').toLowerCase();
        const k = Number(li.getAttribute('data-conf') || 0);

        const okSearch = !q || subject.includes(q) || snippet.includes(q);
        const okClass = !cls || c === cls;
        const okConf = !conf || k >= conf;

        const show = okSearch && okClass && okConf;
        (li as HTMLElement).style.display = show ? '' : 'none';
        if (show) visible += 1;
      });

      if (countLabel) countLabel.textContent = String(visible);
      updateBulkState();
    };

    // listeners for filters
    const onSearch = () => applyFilters();
    const onClass = () => applyFilters();
    const onConf = () => applyFilters();
    search?.addEventListener('input', onSearch);
    classFilter?.addEventListener('change', onClass);
    confFilter?.addEventListener('change', onConf);

    // initial pass
    applyFilters();
    updateBulkState();

    // ---------- bulk select all ----------
    const onChkAll = () => {
      if (!chkAll) return;
      const on = !!chkAll.checked;
      visibleRows().forEach((li) => {
        const c = li.querySelector('.row-chk') as HTMLInputElement | null;
        if (c) c.checked = on;
      });
      updateBulkState();
    };
    chkAll?.addEventListener('change', onChkAll);

    // each row checkbox updates bulk state
    const perRowChecks = $$('.row-chk') as HTMLInputElement[];
    perRowChecks.forEach((c) => c.addEventListener('change', updateBulkState));

    // ---------- bulk actions ----------
    const onBulkSend = async () => {
      const rows = selectedRows();
      if (!rows.length || !bulkSend) return;
      bulkSend.disabled = true;
      try {
        for (const r of rows) {
          const id = r.getAttribute('data-id') || '';
          if (!id) continue;
          await postJSON(API, { op: 'approve', id });
          await sendFeedback(id, "approve_suggested");
          removeRow(r);
        }
      } catch (e: any) {
        alert('Bulk send error: ' + (e?.message || 'error'));
      } finally {
        bulkSend.disabled = false;
        if (chkAll) chkAll.checked = false;
        updateBulkState();
        applyFilters();
      }
    };

    const onBulkSkip = async () => {
      const rows = selectedRows();
      if (!rows.length || !bulkSkip) return;
      bulkSkip.disabled = true;
      try {
        for (const r of rows) {
          const id = r.getAttribute('data-id') || '';
          if (!id) continue;
          await postJSON(API, { op: 'skip', id });
          await sendFeedback(id, "skip");
          removeRow(r);
        }
      } catch (e: any) {
        alert('Bulk skip error: ' + (e?.message || 'error'));
      } finally {
        bulkSkip.disabled = false;
        if (chkAll) chkAll.checked = false;
        updateBulkState();
        applyFilters();
      }
    };

    bulkSend?.addEventListener('click', onBulkSend);
    bulkSkip?.addEventListener('click', onBulkSkip);

    // ---------- row actions (approve / draft / skip) ----------
    const onRowClick = async (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const btn = target.closest('.js-approve, .js-draft, .js-skip') as HTMLButtonElement | null;
      if (!btn) return;

      const row = btn.closest('li') as HTMLElement | null;
      if (!row) return;

      const id = row.getAttribute('data-id') || '';
      if (!id) return;

      // parse suggested
      let suggested: { subject?: string; body?: string } | null = null;
      try {
        const raw = row.getAttribute('data-suggested');
        suggested = raw ? JSON.parse(raw) : null;
      } catch {
        suggested = null;
      }

      const subjectFallback = safeText(row.querySelector('.font-medium'));
      const payload: any = { id };

      if (btn.classList.contains('js-approve')) {
        payload.op = 'approve';
        payload.subject = suggested?.subject || subjectFallback || '';
        payload.body = suggested?.body || '';
      } else if (btn.classList.contains('js-draft')) {
  // Go straight to the edit page for this log
  const editUrl = `/email-ai/review/${id}/edit`;
  window.location.href = editUrl;
  return; // stop here so we DON'T call the action API for drafts
} else if (btn.classList.contains('js-skip')) {
        payload.op = 'skip';
      } else {
        return;
      }

btn.disabled = true;

// only pre-open for draft to avoid popup blocking
const draftPopup =
  payload.op === 'save_draft' ? window.open('about:blank', '_blank', 'noopener') : null;
if (draftPopup && draftPopup.document) {
  draftPopup.document.write('<p style="font-family:system-ui;margin:16px">Preparing Gmail draft…</p>');
  draftPopup.document.close();
}

try {
  const res = await postJSON(API, payload);

  // APPROVE / SKIP: remove on explicit success only
  if (payload.op !== 'save_draft') {
    if (res?.ok === true) removeRow(row);   // only when server says ok
    if (res?.ok === true && payload.op === 'approve') await sendFeedback(id, "approve_suggested");
    if (res?.ok === true && payload.op === 'skip') await sendFeedback(id, "skip");
    return;
  }

  // SAVE_DRAFT: require both action and editUrl
  if (res?.ok === true && res?.action === 'draft_created' && res?.editUrl) {
    if (draftPopup) {
      draftPopup.location.replace(res.editUrl);
    } else {
      // fallback if popup blocked
      window.open(res.editUrl, '_blank', 'noopener');
    }
    removeRow(row); // remove ONLY after we navigated the draft tab
  } else {
    // keep row; show why
    draftPopup?.close();
    const why =
      res?.error ||
      (!res?.editUrl ? 'no edit URL returned' : 'draft not created');
    alert('Draft failed: ' + why);
  }
} catch (err: any) {
  draftPopup?.close();
  alert(err?.message || 'Action failed');
  // keep the row on any error
} finally {
  btn.disabled = false;
  updateBulkState();
  applyFilters();
}
    };
    document.addEventListener('click', onRowClick);

    // ---------- keyboard shortcuts ----------
    const onKey = (ev: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      const row = active?.closest ? (active.closest('li') as HTMLElement | null) : null;
      if (!row) return;
      const trigger = (sel: string) => {
        const b = row.querySelector(sel) as HTMLButtonElement | null;
        if (b) {
          ev.preventDefault();
          b.click();
        }
      };
      if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') trigger('.js-approve');
      if (!ev.metaKey && !ev.ctrlKey && (ev.key === 's' || ev.key === 'S')) trigger('.js-skip');
      if (!ev.metaKey && !ev.ctrlKey && (ev.key === 'e' || ev.key === 'E')) trigger('.js-draft');
    };
    document.addEventListener('keydown', onKey);

    // ---------- cleanup ----------
    return () => {
      refreshBtn?.removeEventListener('click', handleRefresh);
      auto?.removeEventListener('change', handleAutoChange);
      stopAuto();

      search?.removeEventListener('input', onSearch);
      classFilter?.removeEventListener('change', onClass);
      confFilter?.removeEventListener('change', onConf);
      chkAll?.removeEventListener('change', onChkAll);
      perRowChecks.forEach((c) => c.removeEventListener('change', updateBulkState));

      bulkSend?.removeEventListener('click', onBulkSend);
      bulkSkip?.removeEventListener('click', onBulkSkip);

      document.removeEventListener('click', onRowClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return null;
}
