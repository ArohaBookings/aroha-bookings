// lib/retell/phone.ts
export function normalizePhone(raw?: string | null): string {
  if (!raw) return "";
  const digits = raw.replace(/\D+/g, "");
  // Basic NZ handling; tweak for your markets
  if (digits.startsWith("0")) return digits;
  if (digits.startsWith("64")) return "0" + digits.slice(2);
  return digits;
}
