import { createElement, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { saveExpense } from "./commands";
import { getLocalDate, parseExpenseAmount, validateExpenseDate } from "./entry";
import type { Ledger } from "../storage/client";

const ink = "#293c32";
const sage = "#486b51";

/** Format exact minor units using the currency precision stored with the account. */
function formatMoney(minor: number, currency: string, digits: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(minor / 10 ** digits);
}

/** Render entry or history without exposing database internals to the form. */
export function ExpenseWorkspace({
  mode,
  ledger,
  onBack,
  onLedgerChange,
}: {
  mode: "expense" | "history";
  ledger: Ledger;
  onBack: () => void;
  onLedgerChange: (next: Ledger) => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(getLocalDate());
  const [categoryId, setCategoryId] = useState("other");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const operationId = useRef("");
  const { account } = ledger;
  const currency = account.currency_code;

  /** Validate and save with one operation ID until a successful response arrives. */
  async function submitExpense() {
    const dateError = validateExpenseDate(date, getLocalDate());
    const amountMinor = parseExpenseAmount(amount, account.decimal_places);
    if (dateError) return setError(dateError);
    if (amountMinor === null)
      return setError("Enter an expense amount greater than zero.");
    setError("");
    setSaving(true);
    if (!operationId.current) operationId.current = crypto.randomUUID();
    try {
      const result = await saveExpense({
        operationId: operationId.current,
        accountId: account.account_id,
        categoryId,
        amountMinor,
        date,
        note,
      });
      onLedgerChange(result.ledger);
      operationId.current = "";
      setAmount("");
      setNote("");
      setDate(getLocalDate());
      setCategoryId("other");
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
        {ledger.expenses.length === 0 ? (
          <Text style={styles.copy}>Your saved expenses will appear here.</Text>
        ) : (
          <ScrollView style={styles.history}>
            {ledger.expenses.map((expense) => (
              <View key={expense.id} style={styles.entry}>
                <View style={styles.entryCopy}>
                  <Text style={styles.entryTitle}>
                    {expense.note || expense.category_label}
                  </Text>
                  <Text style={styles.meta}>
                    {expense.category_label} · {expense.date} · {account.account_name}
                  </Text>
                </View>
                <Text style={styles.entryAmount}>
                  {formatMoney(
                    expense.amount_minor,
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

  return (
    <View style={styles.content}>
      <Pressable accessibilityRole="button" onPress={onBack} style={styles.back}>
        <Text style={styles.backText}>Back to account</Text>
      </Pressable>
      <Text style={styles.title}>Add an expense</Text>
      <Text style={styles.copy}>Record money spent from {account.account_name}.</Text>
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
        accessibilityLabel="Expense amount"
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder="0"
        style={styles.input}
      />
      <Text style={styles.label}>Category</Text>
      <View style={styles.categories}>
        {ledger.categories.map((category) => (
          <Pressable
            key={category.id}
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
        "aria-label": "Expense date",
        type: "date",
        value: date,
        max: getLocalDate(),
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
        accessibilityLabel="Expense note"
        value={note}
        onChangeText={setNote}
        placeholder="What was it for?"
        style={styles.input}
      />
      <Pressable
        accessibilityRole="button"
        disabled={saving}
        onPress={() => void submitExpense()}
        style={[styles.saveButton, saving && styles.disabled]}
      >
        <Text style={styles.saveText}>{saving ? "Saving…" : "Save expense"}</Text>
      </Pressable>
      <Text style={styles.hint}>
        Choose today or an earlier date.
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
});
