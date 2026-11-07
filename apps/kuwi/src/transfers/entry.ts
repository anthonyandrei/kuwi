/** Strip unsupported characters and truncate fractional input to currency precision.
 * @param input - Text entered in the amount or fee field.
 * @param decimalPlaces - Currency fraction digits, currently zero for JPY and two otherwise.
 * @returns Editable numeric text with no excess fractional digits.
 */
export function normalizeTransferInput(input: string, decimalPlaces: number): string {
  if (!input) return "";
  const pieces = input.replace(/[^\d.]/g, "").split(".");
  const whole = pieces[0] || "0";
  if (decimalPlaces === 0 || pieces.length === 1) return whole;
  return `${whole}.${pieces.slice(1).join("").slice(0, decimalPlaces)}`;
}

/** Parse a positive decimal transfer amount in the currency's supported minor units.
 * @param input - User-entered amount; conventional grouping commas are ignored.
 * @param decimalPlaces - Currency fraction digits, currently zero for JPY and two otherwise.
 * @returns A positive safe integer in minor units, or null for invalid precision or value.
 */
export function parseTransferAmount(input: string, decimalPlaces: number): number | null {
  const normalized = input.replace(/,/g, "").trim();
  if (!/^\d+(?:\.\d*)?$/.test(normalized)) return null;
  const [, fraction = ""] = normalized.split(".");
  if (fraction.length > decimalPlaces) return null;
  const minor = Math.round((Number(normalized) + Number.EPSILON) * 10 ** decimalPlaces);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

/** Parse an optional nonnegative fee, where a blank field means zero.
 * @param input - Fee text from the form.
 * @param decimalPlaces - Currency fraction digits.
 * @returns A safe integer fee in minor units, or null when the value is invalid.
 */
export function parseTransferFee(input: string, decimalPlaces: number): number | null {
  if (!input.trim()) return 0;
  const normalized = input.replace(/,/g, "").trim();
  if (!/^\d+(?:\.\d*)?$/.test(normalized)) return null;
  const [, fraction = ""] = normalized.split(".");
  if (fraction.length > decimalPlaces) return null;
  const minor = Math.round((Number(normalized) + Number.EPSILON) * 10 ** decimalPlaces);
  return Number.isSafeInteger(minor) && minor >= 0 ? minor : null;
}

/** Validate a real calendar date for a transfer, including dates in the future.
 * @param value - Date-only text in YYYY-MM-DD form.
 * @returns A user-facing validation message, or null when it is a valid date.
 */
export function validateTransferDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Choose a valid transfer date.";
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? "Choose a valid transfer date."
    : null;
}
