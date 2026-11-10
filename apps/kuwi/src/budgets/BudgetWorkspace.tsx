import { createElement, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { database, type BudgetRecord, type BudgetState, type SaveBudgetInput, type SaveBudgetResult } from "../storage/client";

const ink = "var(--kuwi-ink)";
const sage = "var(--kuwi-accent-button)";
const periods: [BudgetRecord["interval"], string][] = [
  ["daily", "Daily"],
  ["weekly", "Weekly"],
  ["bi-weekly", "Bi-weekly"],
  ["monthly", "Monthly"],
  ["annually", "Annual"],
];

type BudgetForm = {
  categoryId: string;
  type: "fixed" | "percentage";
  amount: string;
  interval: BudgetRecord["interval"];
  rolloverEnabled: boolean;
  biweeklyStartDate: string;
  biweeklyEndDate: string;
};
const budgetDrafts = new Map<string, { form: BudgetForm | null; cycleDay: string }>();

/** Discard every in-memory budget draft after the ledger is replaced. */
export function clearBudgetDrafts(): void {
  budgetDrafts.clear();
}

/** Format a stored thousandth value without trailing zeroes for editing.
 * @param milli - Amount in thousandths of the preferred currency unit.
 * @returns Decimal text without insignificant trailing zeroes.
 */
function amountText(milli: number): string {
  return (milli / 1000).toFixed(3).replace(/\.?0+$/, "");
}

/** Format stored hundredths of one percent as editable text.
 * @param basisPoints - Percentage multiplied by 100, such as 1250 for 12.5%.
 * @returns Percentage text without insignificant trailing zeroes.
 */
function percentageText(basisPoints: number): string {
  return (basisPoints / 100).toFixed(2).replace(/\.?0+$/, "");
}

/** Parse a currency amount into thousandths without accepting unsupported precision.
 * @param value - Nonnegative amount text; at most two fraction digits, or whole JPY units.
 * @param currency - Currency whose supported fraction digits govern validation.
 * @returns Amount in thousandths, or null for invalid precision or an unsafe integer.
 */
function parseAmount(value: string, currency: string): number | null {
  const digits = currency === "JPY" ? 0 : 2;
  if (!(digits === 0 ? /^\d+$/ : /^\d+(\.\d{0,2})?$/.test(value))) return null;
  const [whole, fraction = ""] = value.split(".");
  const milli = Number(whole) * 1000 + Number(fraction.padEnd(3, "0"));
  return Number.isSafeInteger(milli) ? milli : null;
}

/** Parse a percentage into hundredths of one percent for exact storage.
 * @param value - Nonnegative percentage text with up to two fraction digits.
 * @returns Integer percentage basis points, or null when invalid or unsafe.
 */
function parsePercentage(value: string): number | null {
  if (!/^\d+(\.\d{0,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(basisPoints) ? basisPoints : null;
}

/** Format today's browser-local calendar date for a new bi-weekly anchor.
 * @returns Local date in YYYY-MM-DD form.
 */
function localDate(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Add calendar days to a date-only value without local DST shifts.
 * @param value - Valid YYYY-MM-DD date.
 * @param count - Signed number of calendar days.
 * @returns Shifted YYYY-MM-DD date.
 */
function addDays(value: string, count: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + count));
  return date.toISOString().slice(0, 10);
}

/** Check that date text represents a real YYYY-MM-DD calendar date.
 * @param value - User-entered date text.
 * @returns Whether the value is a valid date-only calendar day.
 */
function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Format a derived amount in the profile's preferred currency.
 * @param value - Amount in major currency units.
 * @param currency - Supported preferred currency code.
 * @returns Locale-formatted currency text.
 */
function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(value);
}

/** Render category budgets, editing controls, and progress derived from the local ledger.
 * @param initialState - Category definitions and progress read from local storage.
 * @param onBack - Returns to the account workspace.
 * @param onStateChange - Receives the refreshed canonical and derived budget state after a save.
 * @returns Budget workspace view; unsaved form values remain in memory through same-session route changes.
 */
export function BudgetWorkspace({
  initialState,
  onBack,
  onStateChange,
}: {
  initialState: BudgetState;
  onBack: () => void;
  onStateChange: (state: BudgetState) => void;
}) {
  const draftKey = initialState.preferredCurrency ?? "default";
  const savedDraft = budgetDrafts.get(draftKey);
  const [state, setState] = useState(initialState);
  const [form, setForm] = useState<BudgetForm | null>(savedDraft?.form ?? null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [cycleDay, setCycleDay] = useState(savedDraft?.cycleDay ?? String(initialState.monthlyCycleStartDay));
  const [savingCycleDay, setSavingCycleDay] = useState(false);
  const [operationAttempt, setOperationAttempt] = useState<{ key: string; id: string } | null>(null);

  useEffect(() => {
    budgetDrafts.set(draftKey, { form, cycleDay });
  }, [draftKey, form, cycleDay]);

  /** Open a new form or load a category's current definition.
   * @param categoryId - Built-in expense category ID.
   * @returns Nothing; updates the local editor state.
   */
  function editBudget(categoryId: string) {
    const current = state.budgets.find((budget) => budget.category_id === categoryId);
    const now = localDate();
    const biweeklyStartDate = current?.biweekly_start_date ?? now;
    setForm({
      categoryId,
      type: current?.type ?? "fixed",
      amount: current?.type === "percentage"
        ? percentageText(current.percentage_basis_points ?? 0)
        : amountText(current?.amount_milli ?? 0),
      interval: current?.interval ?? "monthly",
      rolloverEnabled: current?.rollover_enabled === 1,
      biweeklyStartDate,
      biweeklyEndDate: current?.biweekly_end_date ?? addDays(biweeklyStartDate, 13),
    });
    setError("");
    setOperationAttempt(null);
  }

  /** Reuse the operation ID for unchanged content after a failed response.
   * @param key - Stable JSON identity of normalized form values.
   * @returns Existing retry ID or a new UUID for these values.
   */
  function operationIdFor(key: string): string {
    if (!operationAttempt || operationAttempt.key !== key) {
      const next = { key, id: crypto.randomUUID() };
      setOperationAttempt(next);
      return next.id;
    }
    return operationAttempt.id;
  }

  /** Keep the selected range valid when a new start passes its current end.
   * @param biweeklyStartDate - User-entered start date, including partial input while editing.
   * @returns Nothing; updates the start and, when needed, moves the end 13 days forward.
   */
  function changeBiweeklyStart(biweeklyStartDate: string) {
    setForm((current) => {
      if (!current) return current;
      const biweeklyEndDate = isDateOnly(biweeklyStartDate) &&
        isDateOnly(current.biweeklyEndDate) && biweeklyStartDate > current.biweeklyEndDate
        ? addDays(biweeklyStartDate, 13)
        : current.biweeklyEndDate;
      return { ...current, biweeklyStartDate, biweeklyEndDate };
    });
  }

  /** Move the start to an earlier selected end, matching the recovered editor rule.
   * @param biweeklyEndDate - User-entered end date, including partial input while editing.
   * @returns Nothing; updates the end and, when needed, moves the start to that date.
   */
  function changeBiweeklyEnd(biweeklyEndDate: string) {
    setForm((current) => {
      if (!current) return current;
      const biweeklyStartDate = isDateOnly(biweeklyEndDate) &&
        isDateOnly(current.biweeklyStartDate) && biweeklyEndDate < current.biweeklyStartDate
        ? biweeklyEndDate
        : current.biweeklyStartDate;
      return { ...current, biweeklyStartDate, biweeklyEndDate };
    });
  }

  /** Validate the editor, save the definition atomically, and refresh derived progress.
   * Invalid input or storage failure remains visible in the editor; unchanged retries keep their ID.
   * @returns Resolves after success or after displaying a validation/storage error.
   */
  async function saveBudget() {
    if (!form || !state.preferredCurrency) return;
    const parsed = form.type === "fixed"
      ? parseAmount(form.amount, state.preferredCurrency)
      : parsePercentage(form.amount);
    if (parsed === null) {
      setError(form.type === "fixed"
        ? "Enter a valid amount with the selected currency's precision."
        : "Enter a valid percentage with up to two decimal places.");
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[aria-label="Budget amount"], [aria-label="Budget percentage"]')?.focus());
      return;
    }
    if (form.interval === "bi-weekly" &&
      (!isDateOnly(form.biweeklyStartDate) ||
        !isDateOnly(form.biweeklyEndDate) ||
        form.biweeklyEndDate < form.biweeklyStartDate)) {
      setError("Choose a valid bi-weekly start and end date.");
      if (typeof document !== "undefined") {
        document.querySelector<HTMLInputElement>('[aria-label="Bi-weekly cycle start"]')?.focus();
      }
      return;
    }
    const input: Omit<SaveBudgetInput, "operationId"> = {
      categoryId: form.categoryId,
      type: form.type,
      amountMilli: form.type === "fixed" ? parsed : 0,
      percentageBasisPoints: form.type === "percentage" ? parsed : null,
      interval: form.interval,
      rolloverEnabled: form.type === "fixed" && form.rolloverEnabled,
      ...(form.interval === "bi-weekly"
        ? { biweeklyStartDate: form.biweeklyStartDate, biweeklyEndDate: form.biweeklyEndDate }
        : {}),
    };
    const key = JSON.stringify(input);
    const operationId = operationIdFor(key);
    setSaving(true);
    setError("");
    try {
      const result = await database<SaveBudgetResult>("saveBudget", {
        ...input,
        operationId,
      });
      setState(result.state);
      onStateChange(result.state);
      setOperationAttempt(null);
      setForm(null);
      budgetDrafts.delete(draftKey);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  }

  /** Save the preferred start day used by monthly budget periods.
   * @returns Resolves after the canonical setting and progress refresh, or displays an error.
   */
  async function saveCycleDay() {
    if (!/^\d+$/.test(cycleDay) || Number(cycleDay) < 1 || Number(cycleDay) > 31) {
      setError("Choose a monthly cycle start day from 1 to 31.");
      return;
    }
    setSavingCycleDay(true);
    setError("");
    try {
      const next = await database<BudgetState>("saveMonthlyCycleStartDay", { day: Number(cycleDay) });
      setState(next);
      onStateChange(next);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSavingCycleDay(false);
    }
  }

  /** Close the editor, discard unsubmitted values, and reset retry identity.
   * @returns Nothing; updates the local editor state.
   */
  function cancelEdit() {
    setForm(null);
    setError("");
    setOperationAttempt(null);
    budgetDrafts.delete(draftKey);
  }

  /** Render an accessible action with a real disabled state while saving.
   * @param label - Visible and accessible button label.
   * @param onPress - Action invoked when the control is activated.
   * @param disabled - Whether the control is temporarily unavailable.
   * @returns Pressable button view.
   */
  const button = (label: string, onPress: () => void, disabled = false, secondary = false) => (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[secondary ? styles.secondaryButton : styles.button, disabled && styles.disabled]}
    >
      <Text style={secondary ? styles.secondaryButtonText : styles.buttonText}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={styles.content}>
      <Pressable accessibilityRole="button" onPress={onBack} style={styles.back}>
        <Text style={styles.backText}>‹ Back to accounts</Text>
      </Pressable>
      <Text accessibilityRole="header" nativeID="route-heading" style={styles.heading}>Budgets</Text>
      <Text style={styles.note}>Category limits apply across all accounts.</Text>
      <Text style={styles.note}>Budget currency: {state.preferredCurrency ?? "unavailable"}</Text>
      <View style={styles.cyclePreference}>
        <Text style={styles.label}>Monthly cycle starts on day</Text>
        <TextInput
          accessibilityLabel="Monthly cycle start day"
          keyboardType="number-pad"
          value={cycleDay}
          onChangeText={setCycleDay}
          style={styles.cycleInput}
        />
        {button(savingCycleDay ? "Saving…" : "Save monthly cycle", () => void saveCycleDay(), savingCycleDay)}
      </View>
      {error && !form ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {state.budgets.length ? (
        <View style={styles.summary}>
          <Text style={styles.label}>Current budgets</Text>
          {state.summary?.available ? (
            <Text style={styles.summaryAmount}>
              {formatMoney(state.summary.spent ?? 0, state.preferredCurrency ?? "PHP")} of {formatMoney(state.summary.limit ?? 0, state.preferredCurrency ?? "PHP")}
            </Text>
          ) : (
            <Text style={styles.note}>Progress unavailable. Exchange quotes are missing for {state.summary?.missingCurrencies.join(", ")}.</Text>
          )}
        </View>
      ) : (
        <Text style={styles.note}>Choose an expense category to set its limit.</Text>
      )}
      {form ? (
        <View style={styles.form}>
          <Text accessibilityRole="header" style={styles.subheading}>
            {state.budgets.some((budget) => budget.category_id === form.categoryId)
              ? `${state.categories.find(({ id }) => id === form.categoryId)?.label} budget`
              : `New ${state.categories.find(({ id }) => id === form.categoryId)?.label} budget`}
          </Text>
          <Text style={styles.label}>Budget type</Text>
          <View style={styles.options}>
            {(["fixed", "percentage"] as const).map((type) => (
              <Pressable
                key={type}
                accessibilityRole="radio"
                aria-checked={form.type === type}
                accessibilityLabel={type === "fixed" ? "Fixed amount" : "Percentage of income"}
                accessibilityState={{ checked: form.type === type }}
                onPress={() => setForm({ ...form, type, amount: "0", rolloverEnabled: type === "fixed" && form.rolloverEnabled })}
                style={[styles.option, form.type === type && styles.optionSelected]}
              >
                <Text style={styles.label}>{type === "fixed" ? "Fixed amount" : "% of income"}{form.type === type ? "  ✓" : ""}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.label}>
            {form.type === "fixed" ? `Budget amount (${state.preferredCurrency})` : "Percentage of income"}
          </Text>
          <TextInput
            accessibilityLabel={form.type === "fixed" ? "Budget amount" : "Budget percentage"}
            accessibilityHint={error.startsWith("Enter a valid amount") || error.startsWith("Enter a valid percentage") ? error : undefined}
            keyboardType="decimal-pad"
            value={form.amount}
            onChangeText={(amount) => { setForm({ ...form, amount }); if (error.startsWith("Enter a valid amount") || error.startsWith("Enter a valid percentage")) setError(""); }}
            style={styles.input}
          />
          {error.startsWith("Enter a valid amount") || error.startsWith("Enter a valid percentage") ? (
            <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
          ) : null}
          <Text style={styles.note}>Saving zero clears this category budget.</Text>
          <Text style={styles.label}>Budget period</Text>
          <View style={styles.periods}>
            {periods.map(([interval, label]) => (
              <Pressable
                key={interval}
                accessibilityRole="radio"
                aria-checked={form.interval === interval}
                accessibilityLabel={label}
                accessibilityState={{ checked: form.interval === interval }}
                onPress={() => setForm({ ...form, interval })}
                style={[styles.period, form.interval === interval && styles.periodSelected]}
              >
                <Text style={styles.periodText}>{label}{form.interval === interval ? "  ✓" : ""}</Text>
              </Pressable>
            ))}
          </View>
          {form.interval === "bi-weekly" ? (
            <>
              <Text style={styles.label}>Bi-weekly cycle start</Text>
              {createElement("input", {
                "aria-label": "Bi-weekly cycle start",
                "aria-describedby": error === "Choose a valid bi-weekly start and end date." ? "budget-date-error" : undefined,
                "aria-invalid": error === "Choose a valid bi-weekly start and end date." ? "true" : undefined,
                type: "date",
                value: form.biweeklyStartDate,
                onChange: (event: { currentTarget: { value: string } }) => { setError(""); changeBiweeklyStart(event.currentTarget.value); },
                style: { boxSizing: "border-box", width: "100%", padding: 14, border: "1px solid var(--kuwi-border)", borderRadius: 12, fontSize: 17, color: ink, backgroundColor: "var(--kuwi-surface)" },
              })}
              <Text style={styles.label}>Bi-weekly cycle end</Text>
              {createElement("input", {
                "aria-label": "Bi-weekly cycle end",
                "aria-describedby": error === "Choose a valid bi-weekly start and end date." ? "budget-date-error" : undefined,
                "aria-invalid": error === "Choose a valid bi-weekly start and end date." ? "true" : undefined,
                type: "date",
                value: form.biweeklyEndDate,
                onChange: (event: { currentTarget: { value: string } }) => { setError(""); changeBiweeklyEnd(event.currentTarget.value); },
                style: { boxSizing: "border-box", width: "100%", padding: 14, border: "1px solid var(--kuwi-border)", borderRadius: 12, fontSize: 17, color: ink, backgroundColor: "var(--kuwi-surface)" },
              })}
              {error === "Choose a valid bi-weekly start and end date." ? (
                <Text nativeID="budget-date-error" accessibilityRole="alert" style={styles.error}>{error}</Text>
              ) : null}
            </>
          ) : null}
          {form.type === "fixed" ? (
            <Pressable
              accessibilityRole="checkbox"
              aria-checked={form.rolloverEnabled}
              accessibilityLabel="Carry unused budget forward"
              accessibilityState={{ checked: form.rolloverEnabled }}
              onPress={() => setForm({ ...form, rolloverEnabled: !form.rolloverEnabled })}
              style={styles.checkbox}
            >
              <View style={styles.checkMark} accessibilityElementsHidden>
                {form.rolloverEnabled ? <Text style={styles.checkText}>✓</Text> : null}
              </View>
              <Text style={styles.label}>Carry unused budget forward</Text>
            </Pressable>
          ) : null}
          {error && error !== "Choose a valid bi-weekly start and end date." && !error.startsWith("Enter a valid amount") && !error.startsWith("Enter a valid percentage") ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          {button(saving ? "Saving…" : "Save budget", () => void saveBudget(), saving)}
          {button("Cancel", cancelEdit, saving, true)}
        </View>
      ) : (
        <View style={styles.categories}>
          {state.categories.map((category) => {
            const budget = state.budgets.find((candidate) => candidate.category_id === category.id);
            return (
              <View key={category.id} style={styles.category}>
                <View style={styles.categoryHeading}>
                  <Text style={styles.label}>{category.label}</Text>
                  {budget ? (
                    budget.available ? (
                      <Text style={styles.categoryAmount}>
                        {formatMoney(budget.spent ?? 0, state.preferredCurrency ?? "PHP")} / {formatMoney(budget.limit ?? 0, state.preferredCurrency ?? "PHP")}
                      </Text>
                    ) : (
                      <Text style={styles.note}>Progress unavailable</Text>
                    )
                  ) : <Text style={styles.note}>No limit</Text>}
                </View>
                {budget ? (
                  <Text style={styles.note}>
                    {budget.type === "percentage" ? `${(budget.percentage_basis_points ?? 0) / 100}% of income` : "Fixed amount"} · {budget.period.start} to {budget.period.end}
                  </Text>
                ) : null}
                {budget?.available ? (
                  <>
                    <View style={styles.track}>
                      <View style={[styles.fill, { width: `${budget.progressPercent ?? 0}%` }]} />
                    </View>
                    <Text style={styles.note}>
                      {(budget.progressPercent ?? 0).toFixed(0)}% used · {formatMoney(budget.remaining ?? 0, state.preferredCurrency ?? "PHP")} remaining
                    </Text>
                  </>
                ) : null}
                {button(budget ? `Edit ${category.label} budget` : `Set ${category.label} budget`, () => editBudget(category.id), false, true)}
              </View>
            );
          })}
        </View>
      )}
      {form ? null : button("Back to accounts", onBack, false, true)}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16 },
  heading: { color: ink, fontSize: 28, lineHeight: 34, fontWeight: "700" },
  subheading: { color: ink, fontSize: 21, lineHeight: 27, fontWeight: "700" },
  label: { color: ink, fontSize: 15, fontWeight: "600" },
  note: { color: "var(--kuwi-secondary-text)", fontSize: 13, lineHeight: 19 },
  summaryAmount: { color: ink, fontSize: 20, fontWeight: "700", fontVariant: ["tabular-nums"] },
  summary: { gap: 6, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "var(--kuwi-divider)" },
  cyclePreference: { gap: 9, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "var(--kuwi-divider)" },
  cycleInput: { width: 112, padding: 12, borderWidth: 1, borderColor: "var(--kuwi-border)", borderRadius: 12, fontSize: 17, color: ink, backgroundColor: "var(--kuwi-surface)" },
  categories: { gap: 14 },
  category: { gap: 8, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: "var(--kuwi-divider)" },
  categoryHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  categoryAmount: { color: ink, fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] },
  track: { height: 8, backgroundColor: "var(--kuwi-selected)", borderRadius: 8, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: sage, borderRadius: 8 },
  form: { gap: 13 },
  options: { flexDirection: "row", gap: 8 },
  option: { flex: 1, alignItems: "center", padding: 12, borderRadius: 11, borderWidth: 1, borderColor: "var(--kuwi-border)", backgroundColor: "var(--kuwi-surface)" },
  optionSelected: { borderColor: sage, borderWidth: 2, backgroundColor: "var(--kuwi-selected)" },
  input: { padding: 14, borderWidth: 1, borderColor: "var(--kuwi-border)", borderRadius: 12, fontSize: 17, color: ink, backgroundColor: "var(--kuwi-surface)" },
  periods: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  period: { paddingVertical: 9, paddingHorizontal: 11, borderRadius: 10, borderWidth: 1, borderColor: "var(--kuwi-border)", backgroundColor: "var(--kuwi-surface)" },
  periodSelected: { borderColor: sage, backgroundColor: "var(--kuwi-selected)" },
  periodText: { color: ink, fontSize: 13, fontWeight: "600" },
  checkbox: { paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 10 },
  checkMark: { width: 22, height: 22, borderWidth: 2, borderColor: sage, borderRadius: 5, backgroundColor: "var(--kuwi-surface)", alignItems: "center", justifyContent: "center" },
  checkText: { color: ink, fontSize: 16, lineHeight: 18, fontWeight: "800" },
  back: { alignSelf: "flex-start", paddingVertical: 7, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1, borderColor: sage, backgroundColor: "var(--kuwi-surface)" },
  backText: { color: ink, fontSize: 14, fontWeight: "600" },
  button: { alignSelf: "flex-start", paddingVertical: 10, paddingHorizontal: 13, borderRadius: 10, backgroundColor: sage },
  buttonText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  secondaryButton: { alignSelf: "flex-start", paddingVertical: 10, paddingHorizontal: 13, borderRadius: 10, borderWidth: 1, borderColor: sage, backgroundColor: "var(--kuwi-surface)" },
  secondaryButtonText: { color: ink, fontSize: 14, fontWeight: "600" },
  disabled: { opacity: 0.5 },
  error: { color: "var(--kuwi-error-fg)", padding: 12, borderRadius: 10, backgroundColor: "var(--kuwi-error-bg)" },
});
