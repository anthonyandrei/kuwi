const dayMilliseconds = 86_400_000;

/** Parse a strict date-only value as UTC midnight so period math ignores local DST.
 * @param {string} value - Calendar date in YYYY-MM-DD form.
 * @returns {Date} UTC midnight for the validated date.
 * @throws {Error} The value is malformed or not a real calendar date.
 */
function asDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("Choose a valid budget date.");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new Error("Choose a valid budget date.");
  return date;
}

/** Format a UTC date-only value without applying a local timezone offset.
 * @param {Date} date - Date whose UTC calendar day should be returned.
 * @returns {string} Date in YYYY-MM-DD form.
 */
function dateText(date) {
  return date.toISOString().slice(0, 10);
}

/** Shift a date-only value by whole calendar days.
 * @param {string} value - Valid YYYY-MM-DD date.
 * @param {number} days - Signed number of days to shift.
 * @returns {string} Shifted YYYY-MM-DD date.
 * @throws {Error} The input date is invalid.
 */
function addDays(value, days) {
  const date = asDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return dateText(date);
}

/** Resolve inclusive bi-weekly anchors or the reference's 14-day default.
 * @param {{biweeklyStartDate?: string, biweeklyEndDate?: string}} options - Optional saved cycle dates.
 * @returns {{start: string, length: number}} Anchor date and inclusive cycle length in days.
 * Invalid or reversed anchors resolve to January 5, 1970 through January 18, 1970.
 */
function biweeklyCycle(options) {
  try {
    const start = asDate(options.biweeklyStartDate ?? "1970-01-05");
    const end = asDate(options.biweeklyEndDate ?? "1970-01-18");
    if (end >= start) {
      return {
        start: options.biweeklyStartDate ?? "1970-01-05",
        length: Math.round((end - start) / dayMilliseconds) + 1,
      };
    }
  } catch {
    // Invalid or absent anchors use the recovered helper's default cycle.
  }
  return { start: "1970-01-05", length: 14 };
}

/** Return the selected budget interval containing a date, using inclusive boundaries.
 * @param {string} interval - `daily`, `weekly`, `bi-weekly`, `monthly`, or `annually`.
 * @param {string} referenceDate - Valid date used to choose the active cycle.
 * @param {{monthlyCycleStartDay?: number, biweeklyStartDate?: string, biweeklyEndDate?: string}} [options] - Cycle preferences; monthly defaults to day 1.
 * @returns {{start: string, end: string}} Active period bounds in YYYY-MM-DD form.
 * @throws {Error} The date is invalid or the interval is unsupported.
 */
export function budgetPeriod(interval, referenceDate, {
  monthlyCycleStartDay = 1,
  biweeklyStartDate,
  biweeklyEndDate,
} = {}) {
  const reference = asDate(referenceDate);
  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth();
  const day = reference.getUTCDate();

  if (interval === "daily") return { start: referenceDate, end: referenceDate };
  if (interval === "weekly") {
    const daysSinceMonday = (reference.getUTCDay() + 6) % 7;
    const start = addDays(referenceDate, -daysSinceMonday);
    return { start, end: addDays(start, 6) };
  }
  if (interval === "bi-weekly") {
    const { start: anchorStart, length } = biweeklyCycle({ biweeklyStartDate, biweeklyEndDate });
    const offset = Math.floor((reference - asDate(anchorStart)) / dayMilliseconds / length) * length;
    const start = addDays(anchorStart, offset);
    return { start, end: addDays(start, length - 1) };
  }
  if (interval === "monthly") {
    const cycleDay = Math.min(31, Math.max(1, Math.floor(monthlyCycleStartDay)));
    const currentStart = new Date(Date.UTC(year, month, Math.min(cycleDay, new Date(Date.UTC(year, month + 1, 0)).getUTCDate())));
    const startMonth = reference < currentStart ? month - 1 : month;
    const cycleStart = new Date(Date.UTC(year, startMonth, 1));
    const start = new Date(Date.UTC(
      cycleStart.getUTCFullYear(),
      cycleStart.getUTCMonth(),
      Math.min(cycleDay, new Date(Date.UTC(cycleStart.getUTCFullYear(), cycleStart.getUTCMonth() + 1, 0)).getUTCDate()),
    ));
    const nextStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, Math.min(
      cycleDay,
      new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 2, 0)).getUTCDate(),
    )));
    nextStart.setUTCDate(nextStart.getUTCDate() - 1);
    return { start: dateText(start), end: dateText(nextStart) };
  }
  if (interval === "annually") return { start: `${year}-01-01`, end: `${year}-12-31` };
  throw new Error("Choose a supported budget interval.");
}

/** Count cycles from the rollover start through the cycle containing today.
 * @param {string} interval - Configured budget period.
 * @param {string} startedAt - First rollover date, normally the start of a cycle.
 * @param {string} today - Current local calendar date.
 * @param {object} options - Period preferences used by `budgetPeriod`.
 * @returns {number} At least one elapsed cycle.
 */
function rolloverCycles(interval, startedAt, today, options) {
  const first = budgetPeriod(interval, startedAt, options).start;
  const current = budgetPeriod(interval, today, options).start;
  if (interval === "daily")
    return Math.max(1, Math.floor((asDate(current) - asDate(first)) / dayMilliseconds) + 1);
  if (interval === "weekly")
    return Math.max(1, Math.floor((asDate(current) - asDate(first)) / (7 * dayMilliseconds)) + 1);
  if (interval === "bi-weekly") {
    const firstDate = asDate(first);
    const currentDate = asDate(current);
    const { length } = biweeklyCycle(options);
    return Math.max(1, Math.floor((currentDate - firstDate) / (length * dayMilliseconds)) + 1);
  }
  if (interval === "monthly") {
    const firstDate = asDate(first);
    const currentDate = asDate(current);
    return Math.max(1, (currentDate.getUTCFullYear() - firstDate.getUTCFullYear()) * 12 + currentDate.getUTCMonth() - firstDate.getUTCMonth() + 1);
  }
  return Math.max(1, asDate(current).getUTCFullYear() - asDate(first).getUTCFullYear() + 1);
}

/** Resolve account currency and convert an entry when both FX quotes exist.
 * @param {object} entry - Ledger record with account ID and integer minor units.
 * @param {Map<string, object>} accountById - Account metadata indexed by ID.
 * @param {string} preferredCurrency - Target currency for budget calculations.
 * @param {Record<string, number>} [rates] - Positive quotes relative to one shared base.
 * @param {Set<string>} missingCurrencies - Updated with every currency whose quote is absent.
 * @returns {number|null} Converted major units, or null when a required quote is missing.
 */
function convertAmount(entry, accountById, preferredCurrency, rates, missingCurrencies) {
  const account = accountById.get(entry.account_id);
  const sourceCurrency = account?.currency_code ?? preferredCurrency;
  const amount = entry.amount_minor / 10 ** (account?.decimal_places ?? 2);
  if (sourceCurrency === preferredCurrency) return amount;
  const sourceRate = rates?.[sourceCurrency];
  const targetRate = rates?.[preferredCurrency];
  if (!(sourceRate > 0) || !(targetRate > 0)) {
    if (!(sourceRate > 0)) missingCurrencies.add(sourceCurrency);
    if (!(targetRate > 0)) missingCurrencies.add(preferredCurrency);
    return null;
  }
  return amount / sourceRate * targetRate;
}

/** Match the reference's explicit planned flag and future-date fallback.
 * @param {object} entry - Ledger row with date and optional planned marker.
 * @param {string} today - Current local calendar date.
 * @param {string} recurringIdField - Recurrence reference used by this entry type.
 * @returns {boolean} Whether the row is planned and should be excluded.
 */
function isPlanned(entry, today, recurringIdField) {
  if (typeof entry.planned === "boolean") return entry.planned;
  if (typeof entry.planned === "number") return entry.planned !== 0;
  return entry.date > today && !entry[recurringIdField];
}

/** Sum eligible entries between inclusive dates, tracking missing FX quotes.
 * @param {object[]} entries - Expense or income ledger rows.
 * @param {string} start - Inclusive YYYY-MM-DD period start.
 * @param {string} end - Inclusive YYYY-MM-DD period end.
 * @param {string} today - Current date used for planned-entry fallback.
 * @param {Map<string, object>} accountById - Account metadata indexed by ID.
 * @param {string} preferredCurrency - Currency for the returned total.
 * @param {Record<string, number>} [rates] - Positive quotes relative to one shared base.
 * @param {Set<string>} missingCurrencies - Updated when a matching row lacks a required quote.
 * @param {(entry: object) => boolean} eligible - Additional category and status filter.
 * @returns {number} Sum of eligible rows that could be converted.
 */
function eligibleTotal(entries, start, end, today, accountById, preferredCurrency, rates, missingCurrencies, eligible) {
  let total = 0;
  for (const entry of entries) {
    if (entry.date < start || entry.date > end || !eligible(entry)) continue;
    const amount = convertAmount(entry, accountById, preferredCurrency, rates, missingCurrencies);
    if (amount === null) continue;
    total += amount;
  }
  return total;
}

/**
 * Derive one category's allocation and progress from canonical budget and ledger rows.
 * Missing cross-currency quotes make the result unavailable instead of using a guessed rate.
 * @param {object} input - Budget, profile currency, today, accounts, expenses, incomes, optional rates, and monthly cycle day.
 * @returns {object} Period, availability, missing currencies, limit, spending, remaining, capped progress, and percentage income base.
 * @throws {Error} The budget interval or a date required for period calculation is invalid.
 */
export function calculateBudgetProgress({
  budget,
  preferredCurrency,
  today,
  accounts,
  expenses,
  incomes,
  rates,
  monthlyCycleStartDay = 1,
}) {
  const periodOptions = {
    monthlyCycleStartDay,
    biweeklyStartDate: budget.biweekly_start_date,
    biweeklyEndDate: budget.biweekly_end_date,
  };
  const period = budgetPeriod(budget.interval, today, periodOptions);
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const missingCurrencies = new Set();
  const rollover = Boolean(budget.rollover_enabled);
  const start = rollover ? budget.rollover_started_at ?? period.start : period.start;
  const end = rollover ? today : period.end;
  const expensesInPeriod = eligibleTotal(
    expenses,
    start,
    end,
    today,
    accountById,
    preferredCurrency,
    rates,
    missingCurrencies,
    (expense) => expense.category_id === budget.category_id &&
      expense.affects_spending !== false && expense.affects_spending !== 0 &&
      !isPlanned(expense, today, "recurringExpenseId") &&
      (!rollover || expense.date <= today),
  );
  let incomeBase = null;
  if (budget.type === "percentage") {
    incomeBase = eligibleTotal(
      incomes,
      period.start,
      period.end,
      today,
      accountById,
      preferredCurrency,
      rates,
      missingCurrencies,
      (income) => !isPlanned(income, today, "recurringIncomeId"),
    );
  }

  if (missingCurrencies.size) {
    return {
      period,
      available: false,
      missingCurrencies: [...missingCurrencies].sort(),
      limit: null,
      spent: null,
      remaining: null,
      progressPercent: null,
      incomeBase,
    };
  }

  const configuredAmount = budget.amount_milli / 1000;
  const limit = budget.type === "percentage"
    ? (incomeBase * (budget.percentage_basis_points ?? 0)) / 10_000
    : rollover
      ? configuredAmount * rolloverCycles(budget.interval, start, today, periodOptions)
      : configuredAmount;
  const remaining = limit - expensesInPeriod;
  const progressPercent = limit > 0
    ? Math.min(100, (expensesInPeriod / limit) * 100)
    : expensesInPeriod > 0 ? 100 : 0;
  return {
    period,
    available: true,
    missingCurrencies: [],
    limit,
    spent: expensesInPeriod,
    remaining,
    progressPercent,
    incomeBase,
  };
}
