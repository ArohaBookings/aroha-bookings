export type BookingHold = {
  id: string;
  start: string;
  end: string;
  staffId?: string | null;
  createdAt: string;
  expiresAt: string;
  source?: string;
  note?: string;
};

const MAX_HOLDS = 200;

function toDate(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function resolveBookingHolds(data: Record<string, unknown>): BookingHold[] {
  const raw = (data.bookingHolds as BookingHold[]) || [];
  const now = Date.now();
  return raw.filter((hold) => {
    const exp = toDate(hold.expiresAt);
    return exp ? exp.getTime() > now : false;
  });
}

export function addBookingHold(data: Record<string, unknown>, hold: BookingHold) {
  const existing = resolveBookingHolds(data);
  const next = [hold, ...existing].slice(0, MAX_HOLDS);
  return {
    ...data,
    bookingHolds: next,
  };
}

export function isSlotHeld(holds: BookingHold[], startISO: string, endISO: string, staffId?: string | null) {
  const start = toDate(startISO);
  const end = toDate(endISO);
  if (!start || !end) return false;
  return holds.some((hold) => {
    if (staffId && hold.staffId && hold.staffId !== staffId) return false;
    const hs = toDate(hold.start);
    const he = toDate(hold.end);
    if (!hs || !he) return false;
    return hs < end && he > start;
  });
}
