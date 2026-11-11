export type HomePeriod = "daily" | "weekly" | "monthly";

export type DateRange = { start: string; end: string };

/** Parse an exact calendar date as a UTC-midnight value for stable period math.
 * @param value - Calendar date in `YYYY-MM-DD` form.
 * @returns The parsed date at UTC midnight.
 * @throws {Error} When the value is missing, malformed, or not a real calendar date.
 */
function dateAtUtcMidnight(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new Error("Choose a valid calendar date.");
  }
  return date;
}

/** Format a date as a zero-padded UTC calendar date.
 * @param date - Date whose UTC year, month, and day should be retained.
 * @returns A `YYYY-MM-DD` string.
 */
function dateText(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Shift a validated calendar date by a whole number of UTC days.
 * @param value - Starting date in `YYYY-MM-DD` form.
 * @param days - Signed whole-day offset.
 * @returns The shifted date in `YYYY-MM-DD` form.
 * @throws {Error} When `value` is not a valid calendar date.
 */
function addDays(value: string, days: number) {
  const date = dateAtUtcMidnight(value);
  date.setUTCDate(date.getUTCDate() + days);
  return dateText(date);
}

/** Get a monthly budget boundary, clamping cycle days that short months lack.
 * @param year - Calendar year.
 * @param month - Zero-based month, as used by `Date`.
 * @param cycleDay - Desired day of the month, from 1 through 31.
 * @returns The boundary at UTC midnight.
 */
function monthBoundary(year: number, month: number, cycleDay: number) {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(cycleDay, lastDay)));
}

/** Get an inclusive Home range using the calendar boundaries shared with budgets.
 * @param period - Day, Monday-to-Sunday week, or saved monthly cycle.
 * @param today - Reference date in `YYYY-MM-DD` form.
 * @param monthlyCycleStartDay - Saved monthly start day, clamped to 1 through 31.
 * @returns Inclusive start and end dates in `YYYY-MM-DD` form.
 * @throws {Error} When `today` is not a valid calendar date.
 */
export function homePeriod(period: HomePeriod, today: string, monthlyCycleStartDay: number): DateRange {
  const reference = dateAtUtcMidnight(today);
  if (period === "daily") return { start: today, end: today };
  if (period === "weekly") {
    const daysSinceMonday = (reference.getUTCDay() + 6) % 7;
    const start = addDays(today, -daysSinceMonday);
    return { start, end: addDays(start, 6) };
  }
  const cycleDay = Math.min(31, Math.max(1, Math.floor(monthlyCycleStartDay)));
  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth();
  const currentStart = monthBoundary(year, month, cycleDay);
  const startMonth = reference < currentStart ? month - 1 : month;
  const start = monthBoundary(year, startMonth, cycleDay);
  const next = monthBoundary(start.getUTCFullYear(), start.getUTCMonth() + 1, cycleDay);
  next.setUTCDate(next.getUTCDate() - 1);
  return { start: dateText(start), end: dateText(next) };
}

/** Return today's date in the device's local calendar, without a time component.
 * @returns The local date in `YYYY-MM-DD` form.
 */
export function localCalendarDate() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

/** Format a calendar date for the activity timeline in the app's locale.
 * @param value - Date in `YYYY-MM-DD` form.
 * @returns A localized month, day, and year label.
 * @throws {Error} When `value` is not a valid calendar date.
 */
export function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-PH", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(dateAtUtcMidnight(value));
}
