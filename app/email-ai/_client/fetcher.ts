// app/email-ai/_client/fetcher.ts
export async function postJSON<T>(
  url: string,
  body: any,
  timeoutMs = 20_000
): Promise<{ ok: boolean; status: number; json: T }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as T;
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(t);
  }
}
