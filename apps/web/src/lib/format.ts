/** Date, number and label formatting shared by server and client components. */

const DEFAULT_TIMEZONE = 'Asia/Kolkata';

function parse(iso: string | Date | null | undefined): Date | null {
  if (!iso) return null;
  const date = iso instanceof Date ? iso : new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(
  iso: string | Date | null | undefined,
  timeZone = DEFAULT_TIMEZONE,
): string {
  const date = parse(iso);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone,
  }).format(date);
}

export function formatDateShort(
  iso: string | Date | null | undefined,
  timeZone = DEFAULT_TIMEZONE,
): string {
  const date = parse(iso);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(date);
}

export function formatDayMonth(
  iso: string | Date | null | undefined,
  timeZone = DEFAULT_TIMEZONE,
): string {
  const date = parse(iso);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone,
  }).format(date);
}

export function formatDateTime(
  iso: string | Date | null | undefined,
  timeZone = DEFAULT_TIMEZONE,
): string {
  const date = parse(iso);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).format(date);
}

export function formatTime(
  iso: string | Date | null | undefined,
  timeZone = DEFAULT_TIMEZONE,
): string {
  const date = parse(iso);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).format(date);
}

/** Calendar date (YYYY-MM-DD) in an IANA timezone. */
export function editionDateFor(date: Date, timeZone = DEFAULT_TIMEZONE): string {
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

/** Today's date in the newsroom timezone. */
export function todayIn(timeZone = DEFAULT_TIMEZONE): string {
  return editionDateFor(new Date(), timeZone);
}

/**
 * The edition a story published right now belongs to.
 * Mirrors `nextEditionDate` in the API: stories filed today are printed in
 * tomorrow's paper, which goes live at midnight.
 */
export function nextEditionDateFor(date: Date, timeZone = DEFAULT_TIMEZONE): string {
  return editionDateFor(new Date(date.getTime() + 24 * 3600 * 1000), timeZone);
}

/** "Tue, 20 Oct 2026" — used for edition headers. */
export function editionHeading(dateIso: string, timeZone = DEFAULT_TIMEZONE): string {
  const date = parse(`${dateIso}T12:00:00Z`);
  if (!date) return dateIso;
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone,
  }).format(date);
}

/** "Tuesday" — compact weekday label. */
export function weekdayFor(dateIso: string, timeZone = DEFAULT_TIMEZONE): string {
  const date = parse(`${dateIso}T12:00:00Z`);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone }).format(date);
}

export function relativeTime(iso: string | Date | null | undefined, now = Date.now()): string {
  const date = parse(iso);
  if (!date) return '';
  const seconds = Math.round((date.getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 60) return 'just now';
  if (abs < 3600) return formatter.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return formatter.format(Math.round(seconds / 3600), 'hour');
  if (abs < 604_800) return formatter.format(Math.round(seconds / 86_400), 'day');
  if (abs < 2_629_800) return formatter.format(Math.round(seconds / 604_800), 'week');
  return formatter.format(Math.round(seconds / 2_629_800), 'month');
}

export function readingLabel(minutes: number): string {
  const value = Math.max(1, Math.round(minutes || 1));
  return `${value} min read`;
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (value < 1000) return String(Math.round(value));
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
}

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Safe percent for progress-ish UI. */
export function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
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

function addDaysToDateString(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split('-').map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days, 12));
  return date.toISOString().slice(0, 10);
}

function zonedMidnightUtc(dateIso: string, timeZone: string): Date {
  const [year, month, day] = dateIso.split('-').map((part) => Number.parseInt(part, 10));
  const guess = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, 0, 0, 0);
  let instant = guess;
  // Two passes are enough to settle daylight-saving transitions.
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(instant));
    const value = (type: string): number =>
      Number.parseInt(parts.find((part) => part.type === type)?.value ?? '0', 10);
    const localAsUtc = Date.UTC(
      value('year'),
      value('month') - 1,
      value('day'),
      value('hour'),
      value('minute'),
      value('second'),
    );
    instant = guess - (localAsUtc - instant);
  }
  return new Date(instant);
}

/**
 * Calendar-week boundaries (Monday 00:00 through the following Monday 00:00)
 * in the newsroom timezone. Mirrors `weekBoundsFor` in the API.
 */
export function weekBoundsFor(date: Date, timeZone = DEFAULT_TIMEZONE): WeekBounds {
  const localDate = editionDateFor(date, timeZone);
  const weekdayName = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone }).format(date);
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekdayName);
  const daysSinceMonday = ((weekday < 0 ? 0 : weekday) + 6) % 7;
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
