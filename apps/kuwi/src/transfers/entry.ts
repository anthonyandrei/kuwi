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

/** Preserve the canonical decimal representation of the parsed JavaScript rate.
 * @param rate - Positive finite JavaScript number.
 * @returns Round-trippable decimal text for storage and request fingerprints.
 * @throws {Error} The rate is zero, negative, or non-finite.
 */
export function canonicalTransferRate(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Enter a positive exchange rate.");
  return rate.toString();
}

/** Apply the rate's canonical decimal text and truncate toward zero at destination precision.
 * @param sourceMinor - Positive safe integer in source-currency minor units.
 * @param sourceDigits - Source currency decimal places, from zero through three.
 * @param rate - Positive finite destination units per source unit.
 * @param destinationDigits - Destination currency decimal places, from zero through three.
 * @returns Positive destination minor units, or null for invalid inputs, a zero result, or overflow.
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
  const rateText = rate.toString().toLowerCase();
  const [coefficientText, exponentText] = rateText.split("e");
  const [whole, fraction = ""] = coefficientText.split(".");
  const coefficient = BigInt(`${whole}${fraction}`);
  const rateScale = fraction.length - (exponentText ? Number(exponentText) : 0);
  const decimalShift = destinationDigits - sourceDigits - rateScale;
  const numerator = BigInt(sourceMinor) * coefficient;
  const receivedMinor = decimalShift >= 0
    ? numerator * 10n ** BigInt(decimalShift)
    : numerator / 10n ** BigInt(-decimalShift);
  return receivedMinor <= BigInt(Number.MAX_SAFE_INTEGER) && receivedMinor > 0n
    ? Number(receivedMinor)
    : null;
}

/** Derive a positive rate from exact source and received minor-unit amounts.
 * @param sourceMinor - Positive safe integer in source-currency minor units.
 * @param sourceDigits - Source currency decimal places, from zero through three.
 * @param receivedMinor - Positive safe integer in destination-currency minor units.
 * @param destinationDigits - Destination currency decimal places, from zero through three.
 * @returns Positive finite destination units per source unit, or null for invalid values.
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
  const rate = (receivedMinor / sourceMinor) * 10 ** (sourceDigits - destinationDigits);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}
