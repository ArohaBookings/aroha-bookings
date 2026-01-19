type SearchParams = Record<string, string | string[] | undefined>;

export function getParam(sp: SearchParams, key: string): string {
  const value = sp[key];
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
  const value = sp[key];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  return [value].filter(Boolean);
}
