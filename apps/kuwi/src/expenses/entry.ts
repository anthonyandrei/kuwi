/**
 * Parse a positive decimal amount and round it to the account currency's minor units.
 * @param input - Numeric amount text; commas are ignored before parsing.
 * @param decimalPlaces - Number of minor-unit digits used by the account currency.
 * @returns A positive safe integer amount in minor units, or null for invalid input.
 */
export function parseExpenseAmount(
  input: string,
  decimalPlaces: number,
): number | null {
  const normalized = input.replace(/,/g, "").trim();
  if (!/^\d+(?:\.\d*)?$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const scale = 10 ** decimalPlaces;
  const minor = Math.round((amount + Number.EPSILON) * scale);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

/**
 * Validate a real date-only value and reject dates after the supplied local date.
 * @param value - Expense date in YYYY-MM-DD form.
 * @param today - Current browser-local date in YYYY-MM-DD form.
 * @returns A user-facing validation message, or null when the date is allowed.
 */
export function validateExpenseDate(value: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Choose a valid expense date.";
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    return "Choose a valid expense date.";
  if (value > today) return "Choose today or an earlier date.";
  return null;
}

/**
 * Return today's date in the user's local calendar without UTC conversion.
 * @returns Today's local date as YYYY-MM-DD.
 */
export function getLocalDate(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
