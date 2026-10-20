export function nowIso(): string {
  return new Date().toISOString();
}

export function addSeconds(iso: string | Date, seconds: number): string {
  const base = typeof iso === 'string' ? new Date(iso) : iso;
  return new Date(base.getTime() + seconds * 1000).toISOString();
}

export function addMinutes(iso: string | Date, minutes: number): string {
  return addSeconds(iso, minutes * 60);
}

export function addHours(iso: string | Date, hours: number): string {
  return addSeconds(iso, hours * 3600);
}

export function isPast(iso: string | null | undefined): boolean {
  if (!iso) return true;
  return new Date(iso).getTime() <= Date.now();
}

/** Calendar date (YYYY-MM-DD) in a given IANA timezone. */
export function editionDateFor(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

/**
 * The edition a story belongs to.
 *
 * A story written on Monday is printed in the Tuesday edition: the newsroom
 * assembles that edition late on Monday evening and it goes live at midnight.
 * Tagging the story with the date it will actually be read keeps the edition
 * query an exact match (`edition_date = ?`) instead of a fragile time window.
 */
export function nextEditionDate(date: Date, timeZone: string): string {
  return editionDateFor(new Date(date.getTime() + 24 * 3600 * 1000), timeZone);
}

export function localHourFor(date: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  }).format(date);
  return Number.parseInt(hour, 10);
}

export function localWeekdayFor(date: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
}

export function previousDate(dateIso: string): string {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function humanDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

export interface WeekBounds {
  /** Monday 00:00 in the site timezone, as a UTC ISO instant. */
  startIso: string;
  /** Following Monday 00:00 in the site timezone, as a UTC ISO instant. */
  endIso: string;
  /** Monday calendar date, YYYY-MM-DD in the site timezone. */
  startDate: string;
  /** Sunday calendar date, YYYY-MM-DD in the site timezone. */
  endDate: string;
}

function datePartsIn(
  timeZone: string,
  date: Date,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: string): number =>
    Number.parseInt(parts.find((part) => part.type === type)?.value ?? '0', 10);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

/** Convert a wall-clock midnight in `timeZone` to the corresponding UTC instant. */
function zonedMidnightUtc(dateIso: string, timeZone: string): Date {
  const [year, month, day] = dateIso.split('-').map((part) => Number.parseInt(part, 10));
  const guess = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, 0, 0, 0);
  let instant = guess;
  // Two passes handle timezones with daylight-saving transitions.
  for (let pass = 0; pass < 2; pass += 1) {
    const local = datePartsIn(timeZone, new Date(instant));
    const localAsUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
    );
    instant = guess - (localAsUtc - instant);
  }
  return new Date(instant);
}

function addDaysToDateString(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split('-').map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days, 12));
  return date.toISOString().slice(0, 10);
}

/**
 * Calendar-week boundaries (Monday 00:00 through the following Monday 00:00)
 * in the newsroom timezone. `published_at` is stored as UTC ISO, so both
 * bounds are returned as UTC instants for direct comparison in SQL.
 */
export function weekBoundsFor(date: Date, timeZone: string): WeekBounds {
  const localDate = editionDateFor(date, timeZone);
  const weekday = localWeekdayFor(date, timeZone); // 0 = Sunday
  const daysSinceMonday = (weekday + 6) % 7;
  const startDate = addDaysToDateString(localDate, -daysSinceMonday);
  const nextMonday = addDaysToDateString(startDate, 7);
  const endDate = addDaysToDateString(startDate, 6);
  return {
    startIso: zonedMidnightUtc(startDate, timeZone).toISOString(),
    endIso: zonedMidnightUtc(nextMonday, timeZone).toISOString(),
    startDate,
    endDate,
  };
}
