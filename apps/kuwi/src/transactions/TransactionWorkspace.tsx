import { createElement, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { saveExpense, saveIncome } from "./commands";
import {
  getLocalDate,
  parseExpenseAmount,
  parseIncomeAmount,
  validateExpenseDate,
  validateIncomeDate,
} from "./entry";
import type { TransactionLedger } from "../storage/client";

const ink = "#293c32";
const sage = "#486b51";

/**
 * Format an integer minor-unit amount using its account currency precision.
 * @param minor - Amount stored in minor units.
 * @param currency - ISO currency code for display.
 * @param digits - Decimal places used by the account currency.
 * @returns The localized currency string.
 */
function formatMoney(minor: number, currency: string, digits: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(minor / 10 ** digits);
}

/**
 * Render an expense or income form, or the combined transaction and transfer history.
 * @param mode - Entry type or history view to show.
 * @param ledger - Selected account, canonical category lists, and saved transactions.
 * @param onBack - Return to the selected account screen.
 * @param onLedgerChange - Publish the refreshed ledger after a successful save.
 * @returns The form or combined transaction history for the selected account.
 */
export function TransactionWorkspace({
  mode,
  ledger,
  onBack,
  onLedgerChange,
}: {
  mode: "expense" | "income" | "history";
  ledger: TransactionLedger;
  onBack: () => void;
  onLedgerChange: (next: TransactionLedger) => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(getLocalDate());
  const [categoryId, setCategoryId] = useState(mode === "expense" ? "other" : "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const incomeAttempt = useRef<{ operationId: string } | null>(null);
  const expenseOperationId = useRef("");
  const { account } = ledger;
  const currency = account.currency_code;
  const today = getLocalDate();

  /**
   * Validate and save the selected entry with a stable operation ID for retries.
   * A failed save keeps the form values and displays the error for another attempt.
   */
  async function submitTransaction() {
    const isIncome = mode === "income";
    const dateError = isIncome
      ? validateIncomeDate(date)
      : validateExpenseDate(date, today);
    if (dateError) {
      setError(dateError);
      return;
    }

    const isFutureIncome = isIncome && date > today;
    const amountMinor = isIncome
      ? parseIncomeAmount(amount, account.decimal_places, isFutureIncome)
      : parseExpenseAmount(amount, account.decimal_places);
    if (amountMinor === null) {
      setError(
        isIncome
          ? "Enter a valid income amount. Current and past entries must be greater than zero."
          : "Enter an expense amount greater than zero.",
      );
      return;
    }

    setError("");
    setSaving(true);
    try {
      if (isIncome) {
        const request = {
          accountId: account.id,
          categoryId: categoryId || undefined,
          amountMinor,
          date,
          note: note.trim() || undefined,
        };
        if (!incomeAttempt.current)
          incomeAttempt.current = { operationId: crypto.randomUUID() };
        const result = await saveIncome({
          operationId: incomeAttempt.current.operationId,
          ...request,
        });
        onLedgerChange(result.ledger);
        incomeAttempt.current = null;
      } else {
        if (!expenseOperationId.current) expenseOperationId.current = crypto.randomUUID();
        const result = await saveExpense({
          operationId: expenseOperationId.current,
          accountId: account.id,
          categoryId,
          amountMinor,
          date,
          note: note.trim(),
        });
        onLedgerChange(result.ledger);
        expenseOperationId.current = "";
      }
      setAmount("");
      setNote("");
      setDate(getLocalDate());
      setCategoryId(isIncome ? "" : "other");
      onBack();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (mode === "history")
    return (
      <View style={styles.content}>
        <Pressable accessibilityRole="button" onPress={onBack} style={styles.back}>
          <Text style={styles.backText}>Back to account</Text>
        </Pressable>
        <Text style={styles.title}>Transaction history</Text>
        <View style={styles.balanceSummary}>
          <Text style={styles.label}>Current balance</Text>
          <Text style={styles.balance}>
            {formatMoney(account.balance_minor, currency, account.decimal_places)}
          </Text>
        </View>
        {ledger.transactions.length === 0 && ledger.transfers.length === 0 ? (
          <Text style={styles.copy}>Your transactions will appear here.</Text>
        ) : (
          <ScrollView style={styles.history}>
            {[
              ...ledger.transactions.map((transaction) => ({
                kind: "transaction" as const,
                id: transaction.id,
                date: transaction.date,
                createdAt: transaction.created_at,
                transaction,
              })),
              ...ledger.transfers.map((transfer) => ({
                kind: "transfer" as const,
                id: transfer.id,
                date: transfer.date,
                createdAt: transfer.created_at,
                transfer,
              })),
            ]
              .sort((left, right) =>
                right.date.localeCompare(left.date) ||
                right.createdAt.localeCompare(left.createdAt) ||
                right.id.localeCompare(left.id),
              )
              .map((item) => item.kind === "transaction" ? (() => {
                const transaction = item.transaction;
                const categoryLabel = transaction.category_label ?? "Income";
                const amountLabel = formatMoney(
                  transaction.amount_minor,
                  currency,
                  account.decimal_places,
                );
                return (
                  <View key={`${transaction.kind}:${transaction.id}`} style={styles.entry}>
                    <View style={styles.entryCopy}>
                      <Text style={styles.entryTitle}>
                        {transaction.note || categoryLabel}
                      </Text>
                      <Text style={styles.meta}>
                        {categoryLabel} · {transaction.date} · {account.name}
                        {transaction.planned ? " · Planned" : ""}
                      </Text>
                    </View>
                    <Text
                      style={
                        transaction.kind === "income"
                          ? styles.incomeAmount
                          : styles.entryAmount
                      }
                    >
                      {transaction.kind === "income" ? "+" : ""}{amountLabel}
                    </Text>
                  </View>
                );
              })() : (
                <View key={`transfer:${item.transfer.id}`} style={styles.entry}>
                  <View style={styles.entryCopy}>
                    <Text style={styles.entryTitle}>
                      {item.transfer.direction === "outgoing"
                        ? `Transfer to ${item.transfer.to_account_name}`
                        : `Transfer from ${item.transfer.from_account_name}`}
                    </Text>
                    <Text style={styles.meta}>{item.transfer.date} · {account.name}</Text>
                    {item.transfer.note ? <Text style={styles.meta}>{item.transfer.note}</Text> : null}
                  </View>
                  <Text style={styles.entryAmount}>
                    {formatMoney(
                      item.transfer.direction === "outgoing"
                        ? -item.transfer.amount_minor
                        : item.transfer.amount_minor,
                      currency,
                      account.decimal_places,
                    )}
                  </Text>
                </View>
              ))}
          </ScrollView>
        )}
      </View>
    );

  const isIncome = mode === "income";
  const categories = isIncome
    ? [{ id: "", label: "No category" }, ...ledger.income_categories]
    : ledger.expense_categories;

  return (
    <View style={styles.content}>
      <Pressable accessibilityRole="button" onPress={onBack} style={styles.back}>
        <Text style={styles.backText}>Back to account</Text>
      </Pressable>
      <Text style={styles.title}>{isIncome ? "Add income" : "Add an expense"}</Text>
      <Text style={styles.copy}>
        {isIncome
          ? `Record income for ${account.name}.`
          : `Record money spent from ${account.name}.`}
      </Text>
      <View style={styles.balanceSummary}>
        <Text style={styles.label}>Current balance</Text>
        <Text style={styles.balance}>
          {formatMoney(account.balance_minor, currency, account.decimal_places)}
        </Text>
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <Text style={styles.label}>Amount ({currency})</Text>
      <TextInput
        accessibilityLabel={isIncome ? "Income amount" : "Expense amount"}
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder="0"
        style={styles.input}
      />
      <Text style={styles.label}>{isIncome ? "Category (optional)" : "Category"}</Text>
      <View style={styles.categories}>
        {categories.map((category) => (
          <Pressable
            key={category.id || "no-category"}
            accessibilityRole="button"
            accessibilityState={{ selected: categoryId === category.id }}
            onPress={() => setCategoryId(category.id)}
            style={[
              styles.category,
              categoryId === category.id && styles.categorySelected,
            ]}
          >
            <Text
              style={[
                styles.categoryText,
                categoryId === category.id && styles.categoryTextSelected,
              ]}
            >
              {category.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.label}>Date</Text>
      {createElement("input", {
        "aria-label": isIncome ? "Income date" : "Expense date",
        type: "date",
        value: date,
        ...(isIncome ? {} : { max: today }),
        onChange: (event: { currentTarget: { value: string } }) =>
          setDate(event.currentTarget.value),
        style: {
          boxSizing: "border-box",
          width: "100%",
          padding: 16,
          border: "1px solid #83927e",
          borderRadius: 14,
          fontSize: 18,
          color: ink,
          backgroundColor: "#fffdf7",
        },
      })}
      <Text style={styles.label}>Note</Text>
      <TextInput
        accessibilityLabel={isIncome ? "Income note" : "Expense note"}
        value={note}
        onChangeText={setNote}
        placeholder="What was it for?"
        style={styles.input}
      />
      <Pressable
        accessibilityRole="button"
        disabled={saving}
        onPress={() => void submitTransaction()}
        style={[styles.saveButton, saving && styles.disabled]}
      >
        <Text style={styles.saveText}>
          {saving ? "Saving…" : isIncome ? "Save income" : "Save expense"}
        </Text>
      </Pressable>
      <Text style={styles.hint}>
        {isIncome
          ? "Future-dated income is planned and does not change the balance."
          : "Choose today or an earlier date."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16 },
  back: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center" },
  backText: { color: sage, fontSize: 15, fontWeight: "700" },
  title: { color: ink, fontSize: 28, lineHeight: 34, fontWeight: "700" },
  copy: { color: ink, fontSize: 16, lineHeight: 24 },
  label: { color: ink, fontSize: 15, fontWeight: "700" },
  input: {
    minHeight: 54,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "#83927e",
    borderRadius: 14,
    fontSize: 17,
    color: ink,
    backgroundColor: "#fffdf7",
  },
  categories: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  category: {
    minWidth: "30%",
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#c5cec0",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fffdf7",
  },
  categorySelected: { backgroundColor: sage, borderColor: sage },
  categoryText: { color: ink, fontWeight: "600" },
  categoryTextSelected: { color: "#ffffff" },
  saveButton: {
    minHeight: 54,
    borderRadius: 14,
    backgroundColor: sage,
    alignItems: "center",
    justifyContent: "center",
  },
  saveText: { color: "#ffffff", fontSize: 16, fontWeight: "700" },
  disabled: { opacity: 0.55 },
  hint: { color: "#526355", fontSize: 13, lineHeight: 19 },
  error: {
    padding: 14,
    borderRadius: 12,
    color: "#752e1a",
    backgroundColor: "#fae7de",
  },
  balanceSummary: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#d8dfd2",
    gap: 6,
  },
  balance: { color: ink, fontSize: 26, fontWeight: "700" },
  history: { maxHeight: 460 },
  entry: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#d8dfd2",
  },
  entryCopy: { flex: 1, gap: 5 },
  entryTitle: { color: ink, fontSize: 16, fontWeight: "700" },
  meta: { color: "#526355", fontSize: 12, lineHeight: 18 },
  entryAmount: { color: ink, fontSize: 16, fontWeight: "700" },
  incomeAmount: { color: sage, fontSize: 16, fontWeight: "700" },
});
