type RetellFetchResult<T> =
  | { ok: true; status: number; json: T; textSnippet: string }
  | { ok: false; status: number | null; textSnippet: string };

type RetellListResult =
  | {
      ok: true;
      status: number;
      calls: unknown[];
      chosenUrl: string;
      tried: Array<{ url: string; status: number | null }>;
    }
  | {
      ok: false;
      status: number | null;
      calls: [];
      chosenUrl: string | null;
      tried: Array<{ url: string; status: number | null }>;
    };

const DEFAULT_BASE = "https://api.retellai.com";
const ALT_BASES = ["https://api.retell.ai"];
const DEFAULT_PATHS = [
  "/v1/calls",
  "/v2/calls",
  "/v1/calls/list",
  "/v2/calls/list",
  "/v1/call/list",
  "/v2/call/list",
  "/v1/list-calls",
];

let cachedCallsPath: string | null = null;

export function normalizeBase(base: string) {
  return base.replace(/\/$/, "");
}

export function buildUrl(base: string, path: string, params?: Record<string, string | number>) {
  const url = new URL(`${normalizeBase(base)}${path}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  }
  return url.toString();
}

export async function retellFetchJson<T>(
  url: string,
  apiKey: string,
  options?: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal; timeoutMs?: number }
): Promise<RetellFetchResult<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? 12_000);
  const abortHandler = () => controller.abort();
  options?.signal?.addEventListener("abort", abortHandler);

  try {
    const method = options?.method ?? "GET";
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body: JSON.stringify(options?.body || {}) } : {}),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    const textSnippet = text ? text.slice(0, 400) : "";
    let json = {} as T;
    try {
      json = text ? (JSON.parse(text) as T) : ({} as T);
    } catch {
      json = {} as T;
    }
    if (!res.ok) {
      return { ok: false, status: res.status, textSnippet };
    }
    return { ok: true, status: res.status, json, textSnippet };
  } catch (err: any) {
    const aborted = err?.name === "AbortError" || String(err?.message || "").toLowerCase().includes("aborted");
    return { ok: false, status: aborted ? 499 : null, textSnippet: String(err?.message || "") };
  } finally {
    clearTimeout(timeout);
    options?.signal?.removeEventListener("abort", abortHandler);
  }
}

export async function retellListCalls(input: {
  agentId: string;
  apiKey: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<RetellListResult> {
  const baseEnv = normalizeBase(process.env.RETELL_BASE_URL || DEFAULT_BASE);
  const bases = [baseEnv, ...ALT_BASES.map((b) => normalizeBase(b))].filter(
    (v, i, self) => self.indexOf(v) === i
  );
  const rawOverride = (process.env.RETELL_CALLS_LIST_PATH || "").trim();
  const overridePath = rawOverride ? (rawOverride.startsWith("/") ? rawOverride : `/${rawOverride}`) : "";
  const limit = input.limit ?? 50;

  const candidatePaths = [
    ...(overridePath ? [overridePath] : []),
    ...(cachedCallsPath ? [cachedCallsPath] : []),
    ...DEFAULT_PATHS,
  ].filter((value, index, self) => self.indexOf(value) === index);

  const tried: Array<{ url: string; status: number | null }> = [];

  for (const baseUrl of bases) {
    for (const path of candidatePaths) {
      const url = buildUrl(baseUrl, path, { agent_id: input.agentId, limit });
      const isListPath = /list/i.test(path);
      const method = isListPath ? "POST" : "GET";
      const body = isListPath ? { agent_id: input.agentId, limit } : undefined;
      const result = await retellFetchJson<{ calls?: unknown[] }>(url, input.apiKey, {
        method,
        body,
        signal: input.signal,
        timeoutMs: 12_000,
      });
      tried.push({ url, status: result.status ?? null });
      console.log("[calls.sync] RETELL_TRY", { url, method, status: result.status ?? null });

      if (result.ok) {
        const json = result.json as any;
        const calls = Array.isArray(json?.calls) ? json.calls : Array.isArray(json) ? json : [];
        cachedCallsPath = path;
        return { ok: true, status: result.status, calls, chosenUrl: url, tried };
      }
    }
  }

  return { ok: false, status: tried[tried.length - 1]?.status ?? null, calls: [], chosenUrl: null, tried };
}
