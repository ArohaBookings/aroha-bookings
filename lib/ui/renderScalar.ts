export function renderScalar(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Error) return value.message || "Error";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
