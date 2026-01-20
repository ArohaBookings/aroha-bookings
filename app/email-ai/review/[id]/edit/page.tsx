/* eslint-disable @typescript-eslint/no-explicit-any */
// app/email-ai/review/[id]/edit/page.tsx

import { cookies, headers } from "next/headers";
import Link from "next/link";
import EditClient from "./EditClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

/* ───────────────────────────────────────────────
   Types mirrored from the API response
────────────────────────────────────────────── */
type ThreadItem = { id: string; date: string; from: string; body: string };

type ApiLogOk = {
  ok: true;
  id: string;
  subject?: string | null;
  snippet?: string | null;
  gmailThreadId?: string | null;
  suggested?: { subject?: string; body?: string };
  draftId?: string | null; // allow API to send this if available
  replyTo?: string | null;
  thread?: ThreadItem[];
};

type ApiLogErr = { ok: false; status?: number; error?: string };

type ApiLog = ApiLogOk | ApiLogErr;

/* ───────────────────────────────────────────────
   Helpers
────────────────────────────────────────────── */
function buildOrigin(h: Headers) {
  // Support local dev and proxies (Vercel/Reverse proxies)
  const proto =
    h.get("x-forwarded-proto") ||
    (process.env.NODE_ENV === "production" ? "https" : "http");
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) throw new Error("Missing Host header");
  return `${proto}://${host}`;
}

async function getLogFromApi(id: string): Promise<ApiLog> {
  try {
    const hdrs = await headers();
    const origin = buildOrigin(hdrs);
    const url = `${origin}/api/email-ai/log/${encodeURIComponent(id)}`;

    // Forward auth cookies so the API sees the session
    const cookieStr = (await cookies())
      .getAll()
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Cookie: cookieStr,
      },
    });

    // Handle non-JSON bodies safely
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* ignore */
    }

    if (!res.ok || !parsed || parsed.ok !== true) {
      return {
        ok: false,
        status: res.status,
        error:
          (parsed && parsed.error) ||
          text?.slice(0, 400) ||
          `Request failed (${res.status})`,
      };
    }
    return parsed as ApiLogOk;
  } catch (e: any) {
    return { ok: false, error: e?.message || "Network error" };
  }
}

/* ───────────────────────────────────────────────
   Page
   NOTE: In the App Router, `params` is a plain object (not a Promise).
────────────────────────────────────────────── */
export default async function Page({
  params,
}: {
  params: { id: string };
}) {
  const id = params?.id;
  if (!id) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-semibold">Email — Edit</h1>
        <p className="mt-4 text-red-600">Missing ID in the URL.</p>
        <div className="mt-6">
          <Link href="/email-ai/review" className="underline text-indigo-600">
            ← Back to review queue
          </Link>
        </div>
      </main>
    );
  }

  const data = await getLogFromApi(id);

  if (!data.ok) {
    const hint =
      data.status === 401
        ? "You’re not signed in (or your session cookie didn’t reach the API)."
        : data.status === 403
        ? "You don’t have access to this organization."
        : data.status === 404
        ? "That email item wasn’t found."
        : data.error
        ? String(data.error)
        : "Unknown error.";

    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-semibold">Email — Edit</h1>
        <p className="mt-4 text-red-600">Couldn’t load that item.</p>
        <p className="mt-1 text-sm text-neutral-600">{hint}</p>
        <div className="mt-6 flex items-center gap-4">
          <Link href="/login" className="underline text-indigo-600">
            Go to login
          </Link>
          <Link href="/email-ai/review" className="underline text-indigo-600">
            Back to review queue
          </Link>
        </div>
      </main>
    );
  }

  // Pre-fill subject/body from suggestion or fallbacks
  const initialSubject =
    (data.suggested?.subject ?? data.subject ?? "(no subject)").toString();
  const initialBody = (data.suggested?.body ?? "").toString();

  // If a Gmail draft exists, show a direct link (we don’t redirect to avoid confusing users)
  const gmailDraftHref = data.draftId
    ? `https://mail.google.com/mail/u/0/#drafts?compose=${encodeURIComponent(
        data.draftId
      )}`
    : null;

  // Quick Gmail compose link (fallback when there’s no draft)
  const gmailComposeHref = (() => {
    const u = new URL("https://mail.google.com/mail/u/0/");
    u.hash = "compose=new";
    const qp = new URLSearchParams();
    if (data.replyTo) qp.set("to", data.replyTo);
    if (initialSubject) qp.set("su", initialSubject);
    if (initialBody) qp.set("body", initialBody);
    return `${u.toString()}&${qp.toString()}`;
  })();

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Edit &amp; Send</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Thread: {data.gmailThreadId || "(new message)"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {gmailDraftHref ? (
            <a
              href={gmailDraftHref}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 rounded bg-indigo-600 text-white"
              title="Open existing Gmail draft"
            >
              Open Gmail Draft
            </a>
          ) : (
            <a
              href={gmailComposeHref}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 rounded border"
              title="Open Gmail composer (no draft yet)"
            >
              Open in Gmail
            </a>
          )}
          <Link
            href="/email-ai/review"
            className="px-3 py-1.5 rounded border"
            title="Back to review queue"
          >
            Back
          </Link>
        </div>
      </div>

      {/* Internal editor: EditClient handles sending/skip via API */}
      <EditClient id={data.id} initialSubject={initialSubject} initialBody={initialBody} />

      {/* Recent thread preview */}
      {Array.isArray(data.thread) && data.thread.length > 0 && (
        <section className="mt-4">
          <h2 className="text-lg font-medium mb-2">Recent thread</h2>
          <div className="space-y-3">
            {data.thread.map((m) => (
              <article key={m.id} className="rounded border p-3 bg-white">
                <div className="text-xs text-neutral-600">
                  {m.date} — {m.from}
                </div>
                <div className="text-neutral-800 mt-1 whitespace-pre-wrap">
                  {m.body}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Tiny footnote/help */}
      <p className="text-xs text-neutral-500">
        Tip: If Gmail opens but doesn’t thread, send from the existing draft when available.
      </p>
    </main>
  );
}
