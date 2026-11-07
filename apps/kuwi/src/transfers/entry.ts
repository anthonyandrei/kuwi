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

/** Parse a positive finite exchange rate with no imposed decimal-place limit.
 * @param input - Rate text measured as destination units per source unit.
 * @returns The parsed JavaScript number, or null for invalid or nonpositive input.
 */
export function parseTransferRate(input: string): number | null {
  const value = input.trim();
  if (!/^\d+(?:\.\d*)?$/.test(value)) return null;
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

/** Preserve the canonical decimal representation of the parsed binary64 rate.
 * @param rate - Positive finite JavaScript number.
 * @returns Round-trippable decimal text for storage and request fingerprints.
 */
export function canonicalTransferRate(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Enter a positive exchange rate.");
  return rate.toString();
}

/** Truncate a finite decimal's shortest text representation into target minor units.
 * @param value - Nonnegative JavaScript number produced by the currency conversion.
 * @param decimalPlaces - Fraction digits of the destination currency.
 * @returns A safe integer in destination minor units, or null when it is invalid or too large.
 */
function truncateNumericAmountToMinor(value: number, decimalPlaces: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  // Use the number's rendered decimal digits so truncation matches the editable input formatter.
  const [coefficientText, exponentText] = value.toString().toLowerCase().split("e");
  const [whole, fraction = ""] = coefficientText.split(".");
  const coefficient = BigInt(`${whole}${fraction}`);
  const decimalShift = (exponentText ? Number(exponentText) : 0) - fraction.length + decimalPlaces;
  const minor = decimalShift >= 0
    ? coefficient * 10n ** BigInt(decimalShift)
    : coefficient / 10n ** BigInt(-decimalShift);
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}

/** Calculate received minor units, truncating excess target precision as Tarsi's form does.
 * @param sourceMinor - Positive integer source amount in source-currency minor units.
 * @param sourceDigits - Source currency decimal places.
 * @param rate - Destination units per source unit.
 * @param destinationDigits - Destination currency decimal places.
 * @returns Positive received amount in destination minor units, or null if it is not representable.
 */
export function receivedAmountFromRate(
  sourceMinor: number,
  sourceDigits: number,
  rate: number,
  destinationDigits: number,
): number | null {
  if (!Number.isSafeInteger(sourceMinor) || sourceMinor <= 0 ||
    !Number.isInteger(sourceDigits) || sourceDigits < 0 || sourceDigits > 3 ||
    !Number.isInteger(destinationDigits) || destinationDigits < 0 || destinationDigits > 3 ||
    !Number.isFinite(rate) || rate <= 0) return null;
  const convertedAmount = (sourceMinor / 10 ** sourceDigits) * rate;
  const receivedMinor = truncateNumericAmountToMinor(convertedAmount, destinationDigits);
  return receivedMinor !== null && receivedMinor > 0 ? receivedMinor : null;
}

/** Derive the unrounded rate from exact entered source and received minor units.
 * @param sourceMinor - Positive source amount in source-currency minor units.
 * @param sourceDigits - Source currency decimal places.
 * @param receivedMinor - Positive received amount in destination-currency minor units.
 * @param destinationDigits - Destination currency decimal places.
 * @returns Positive finite destination-per-source rate, or null for invalid values.
 */
export function rateFromReceivedAmount(
  sourceMinor: number,
  sourceDigits: number,
  receivedMinor: number,
  destinationDigits: number,
): number | null {
  if (!Number.isSafeInteger(sourceMinor) || sourceMinor <= 0 ||
    !Number.isSafeInteger(receivedMinor) || receivedMinor <= 0 ||
    !Number.isInteger(sourceDigits) || sourceDigits < 0 || sourceDigits > 3 ||
    !Number.isInteger(destinationDigits) || destinationDigits < 0 || destinationDigits > 3) return null;
  const rate = (receivedMinor / 10 ** destinationDigits) /
    (sourceMinor / 10 ** sourceDigits);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}
