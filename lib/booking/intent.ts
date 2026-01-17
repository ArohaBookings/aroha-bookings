export type BookingIntent = {
  from: Date;
  to: Date;
  preferredTime?: { hour: number; minute: number };
  label: string;
};

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function nextWeekday(base: Date, target: number, forceNext = false) {
  const day = base.getDay();
  let diff = (target + 7 - day) % 7;
  if (diff === 0 && forceNext) diff = 7;
  const out = new Date(base);
  out.setDate(out.getDate() + diff);
  return out;
}

function parseTime(text: string) {
  const match = text.match(/(\d{1,2})(?::(\d{2}))?\s?(am|pm)?/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridian = (match[3] || "").toLowerCase();
  if (meridian === "pm" && hour < 12) hour += 12;
  if (meridian === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function inferIntentRange(text: string) {
  const lower = text.toLowerCase();
  const now = new Date();

  let from = startOfDay(now);
  let to = endOfDay(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));
  let label = "Next 7 days";

  if (lower.includes("tomorrow")) {
    const t = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    from = startOfDay(t);
    to = endOfDay(t);
    label = "Tomorrow";
  } else if (lower.includes("today")) {
    from = startOfDay(now);
    to = endOfDay(now);
    label = "Today";
  } else if (lower.includes("next week")) {
    const monday = nextWeekday(now, 1, true);
    from = startOfDay(monday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    to = endOfDay(sunday);
    label = "Next week";
  } else if (lower.includes("this week")) {
    const monday = nextWeekday(now, 1, false);
    from = startOfDay(monday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    to = endOfDay(sunday);
    label = "This week";
  } else {
    const weekdays: Array<[string, number]> = [
      ["monday", 1],
      ["tuesday", 2],
      ["wednesday", 3],
      ["thursday", 4],
      ["friday", 5],
      ["saturday", 6],
      ["sunday", 0],
    ];
    for (const [name, idx] of weekdays) {
      if (lower.includes(`next ${name}`)) {
        const day = nextWeekday(now, idx, true);
        from = startOfDay(day);
        to = endOfDay(day);
        label = `Next ${name}`;
        break;
      }
      if (lower.includes(name)) {
        const day = nextWeekday(now, idx, false);
        from = startOfDay(day);
        to = endOfDay(day);
        label = name[0].toUpperCase() + name.slice(1);
        break;
      }
    }
  }

  const preferredTime = parseTime(lower);

  return {
    from,
    to,
    preferredTime: preferredTime || undefined,
    label,
  } satisfies BookingIntent;
}
