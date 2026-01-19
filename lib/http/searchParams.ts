export type SearchParams = Record<string, string | string[] | undefined>;
export type SearchParamsInput = SearchParams | Promise<SearchParams> | null | undefined;

export function getParam(sp: SearchParams, key: string): string {
  const value = sp?.[key];
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

export function getBoolParam(sp: SearchParams, key: string): boolean {
  const raw = getParam(sp, key).toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function getLowerParam(sp: SearchParams, key: string, fallback = ""): string {
  const raw = getParam(sp, key).trim().toLowerCase();
  return raw || fallback;
}

export function getArrayParam(sp: SearchParams, key: string): string[] {
  const value = sp?.[key];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  return [value].filter(Boolean);
}

export async function resolveSearchParams(input: SearchParamsInput): Promise<SearchParams> {
  const sp = await Promise.resolve(input ?? {});
  return sp || {};
}

export async function getParamAsync(input: SearchParamsInput, key: string): Promise<string> {
  const sp = await resolveSearchParams(input);
  return getParam(sp, key);
}

export async function getLowerParamAsync(
  input: SearchParamsInput,
  key: string,
  fallback = ""
): Promise<string> {
  const sp = await resolveSearchParams(input);
  return getLowerParam(sp, key, fallback);
}

export async function getBoolParamAsync(input: SearchParamsInput, key: string): Promise<boolean> {
  const sp = await resolveSearchParams(input);
  return getBoolParam(sp, key);
}

export async function getArrayParamAsync(input: SearchParamsInput, key: string): Promise<string[]> {
  const sp = await resolveSearchParams(input);
  return getArrayParam(sp, key);
}
