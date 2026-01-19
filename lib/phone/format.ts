const PHONE_RE = /^\+?[1-9]\d{6,14}$/;

export function formatCallerPhone(input?: string | null, businessPhone?: string | null): string {
  if (!input) return "Unknown caller";
  const trimmed = input.trim();
  if (!trimmed) return "Unknown caller";
  if (!PHONE_RE.test(trimmed)) return "Unknown caller";
  const business = businessPhone?.trim();
  if (business && PHONE_RE.test(business) && business === trimmed) return "Unknown caller";
  return trimmed;
}
