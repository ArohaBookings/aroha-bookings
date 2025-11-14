// app/email-ai/review/[id]/edit/EditClient.tsx
"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  id: string;
  initialSubject: string;
  initialBody: string;
};

type ApiOk = { ok: true; editUrl?: string };
type ApiErr = { ok: false; error?: string };

export default function EditClient({ id, initialSubject, initialBody }: Props) {
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState<"send" | "draft" | null>(null);
  const [msg, setMsg] = useState<string>("");
  const [msgKind, setMsgKind] = useState<"ok" | "err" | "">("");

  const API = "/api/email-ai/action";
  const LS_KEY = `edit:${id}`;

  // --- hydrate from localStorage (simple autosave)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) {
        const { subject, body } = JSON.parse(saved);
        if (subjectRef.current && typeof subject === "string") {
          subjectRef.current.value = subject;
        }
        if (bodyRef.current && typeof body === "string") {
          bodyRef.current.value = body;
          autoResize(bodyRef.current);
        }
        return;
      }
      // first render: apply initial and size textarea
      if (bodyRef.current) autoResize(bodyRef.current);
    } catch {
      /* ignore */
    }
  }, [LS_KEY]);

  // --- autosave on input
  const persist = () => {
    try {
      const subject = subjectRef.current?.value ?? "";
      const body = bodyRef.current?.value ?? "";
      localStorage.setItem(LS_KEY, JSON.stringify({ subject, body }));
    } catch {
      /* ignore */
    }
  };

  // --- auto-resize textarea
  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(800, Math.max(160, el.scrollHeight))}px`;
  }

  // --- keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Enter" && (e.metaKey || e.ctrlKey)) && busy === null) {
        e.preventDefault();
        void call("approve");
      }
      if (e.key === "Escape") {
        (document.activeElement as HTMLElement | null)?.blur?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy]);

  async function call(op: "approve" | "save_draft") {
    setMsg("");
    setMsgKind("");
    setBusy(op === "approve" ? "send" : "draft");
    try {
      const subjectRaw = subjectRef.current?.value?.trim() ?? "";
      const subject = subjectRaw || "(no subject)"; // safe fallback
      const body = bodyRef.current?.value?.trim() ?? "";
      if (!body) throw new Error("Body is required.");

      const res = await fetch(API, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ op, id, subject, body }),
      });

      // handle 204 or non-JSON bodies gracefully
      const text = await res.text();
      let j: ApiOk | ApiErr | null = null;
      try {
        j = text ? (JSON.parse(text) as any) : { ok: res.ok } as any;
      } catch {
        j = { ok: res.ok } as any;
      }

      if (!res.ok || !j || (j as any).ok === false) {
        const err =
          (j as ApiErr)?.error ||
          (text && text.slice(0, 300)) ||
          `HTTP ${res.status}`;
        throw new Error(err);
      }

      if (op === "save_draft") {
        const url = (j as ApiOk).editUrl;
        if (url) window.open(url, "_blank", "noopener");
        setMsg("Draft created in Gmail.");
        setMsgKind("ok");
      } else {
        setMsg("Sent successfully.");
        setMsgKind("ok");
      }

      // clear autosave on success
      try {
        localStorage.removeItem(LS_KEY);
      } catch {
        /* ignore */
      }
    } catch (e: any) {
      setMsg(e?.message || "Failed.");
      setMsgKind("err");
    } finally {
      setBusy(null);
    }
  }

  return (
    <form
      className="mt-6 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void call("approve");
      }}
    >
      <label className="block">
        <span className="text-sm font-medium">Subject</span>
        <input
          ref={subjectRef}
          defaultValue={initialSubject}
          onInput={persist}
          className="mt-1 w-full rounded border px-3 py-2"
          placeholder="Subject"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium">Body</span>
        <textarea
          ref={bodyRef}
          defaultValue={initialBody}
          onInput={(e) => {
            autoResize(e.currentTarget);
            persist();
          }}
          rows={12}
          className="mt-1 w-full rounded border px-3 py-2 font-mono"
          placeholder="Type your reply…"
        />
        <div className="mt-1 text-xs text-neutral-500">
          Tip: ⌘/Ctrl+Enter to send.
        </div>
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy !== null}
          className="rounded bg-black text-white px-4 py-2 disabled:opacity-60"
        >
          {busy === "send" ? "Sending…" : "Send"}
        </button>

        <button
          type="button"
          onClick={() => void call("save_draft")}
          disabled={busy !== null}
          className="rounded border px-4 py-2 disabled:opacity-60"
        >
          {busy === "draft" ? "Saving draft…" : "Save draft in Gmail"}
        </button>

        <a href="/email-ai/review" className="ml-auto text-sm underline">
          Back
        </a>
      </div>

      {msg && (
        <div
          className={`text-sm mt-2 ${
            msgKind === "err" ? "text-red-600" : "text-green-700"
          }`}
        >
          {msg}
        </div>
      )}
    </form>
  );
}
