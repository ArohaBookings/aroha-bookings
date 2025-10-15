// lib/retell/time.ts
export function toDate(input: string | Date): Date {
  return typeof input === "string" ? new Date(input) : new Date(input.getTime());
}

export function addMinutes(d: Date, mins: number): Date {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() + mins);
  return x;
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}
