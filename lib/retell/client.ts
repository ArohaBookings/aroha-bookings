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
const DEFAULT_PATHS = ["/v1/calls", "/v2/calls", "/v1/calls/list", "/v1/list-calls"];

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
  signal?: AbortSignal,
  timeoutMs = 12_000
): Promise<RetellFetchResult<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abortHandler = () => controller.abort();
  signal?.addEventListener("abort", abortHandler);

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
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
    signal?.removeEventListener("abort", abortHandler);
  }
}

export async function retellListCalls(input: {
  agentId: string;
  apiKey: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<RetellListResult> {
  const baseUrl = normalizeBase(process.env.RETELL_BASE_URL || DEFAULT_BASE);
  const rawOverride = (process.env.RETELL_CALLS_LIST_PATH || "").trim();
  const overridePath = rawOverride ? (rawOverride.startsWith("/") ? rawOverride : `/${rawOverride}`) : "";
  const limit = input.limit ?? 50;

  const candidatePaths = [
    ...(overridePath ? [overridePath] : []),
    ...(cachedCallsPath ? [cachedCallsPath] : []),
    ...DEFAULT_PATHS,
  ].filter((value, index, self) => self.indexOf(value) === index);

  const tried: Array<{ url: string; status: number | null }> = [];

  for (const path of candidatePaths) {
    const url = buildUrl(baseUrl, path, { agent_id: input.agentId, limit });
    const result = await retellFetchJson<{ calls?: unknown[] }>(url, input.apiKey, input.signal);
    tried.push({ url, status: result.status ?? null });
    console.log("[calls.sync] RETELL_TRY", { url, status: result.status ?? null });

    if (result.ok) {
      const json = result.json as any;
      const calls = Array.isArray(json?.calls) ? json.calls : Array.isArray(json) ? json : [];
      cachedCallsPath = path;
      return { ok: true, status: result.status, calls, chosenUrl: url, tried };
    }
  }

  return { ok: false, status: tried[tried.length - 1]?.status ?? null, calls: [], chosenUrl: null, tried };
}
