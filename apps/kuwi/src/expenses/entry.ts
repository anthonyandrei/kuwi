/** Convert a strict decimal entry into the account currency's integer minor units. */
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

/** Check a date-only value and keep ordinary expenses within the current ledger period. */
export function validateExpenseDate(value: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Choose a valid expense date.";
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    return "Choose a valid expense date.";
  if (value > today) return "Choose today or an earlier date.";
  return null;
}

/** Return today's date in the user's local calendar, without UTC shifting. */
export function getLocalDate(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
