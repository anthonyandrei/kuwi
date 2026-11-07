import { createElement, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { deleteTransaction, saveExpense, saveIncome, updateTransaction } from "./commands";
import {
  getLocalDate,
  parseExpenseAmount,
  parseIncomeAmount,
  validateExpenseDate,
  validateIncomeDate,
} from "./entry";
import type { TransactionLedger, TransactionRecord } from "../storage/client";

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
 * Render an expense or income form, or the combined history with correction and deletion actions.
 * @param mode - Entry type or history view to show.
 * @param ledger - Selected account, all account balances, canonical categories, and saved transactions.
 * @param onBack - Return to the selected account screen.
 * @param onLedgerChange - Publish the refreshed ledger after a successful mutation.
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
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<TransactionRecord | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<TransactionRecord | null>(null);
  const [accountId, setAccountId] = useState(ledger.account.id);
  const operationAttempt = useRef<{ key: string; operationId: string } | null>(null);
  const { account } = ledger;
  const activeAccount = ledger.accounts.find((candidate) => candidate.id === accountId) ?? account;
  const currency = activeAccount.currency_code;
  const today = getLocalDate();

  /** Keep one mutation ID until its logical action succeeds.
   * @param key - Serialized operation type and target transaction identity.
   * @returns The ID already associated with this action, or a new random ID.
   */
  function operationIdFor(key: string): string {
    if (!operationAttempt.current || operationAttempt.current.key !== key)
      operationAttempt.current = { key, operationId: crypto.randomUUID() };
    return operationAttempt.current.operationId;
  }

  /**
   * Validate and create or replace the selected entry with a stable retry ID.
   * A failed write keeps the form values and displays the error for another attempt.
   * @returns Resolves after applying the result or displaying validation/storage errors.
   */
  async function submitTransaction() {
    const isIncome = (editing?.kind ?? mode) === "income";
    const isEditing = editing !== null;
    if (editing && isIncome && (editing.planned || date > today)) {
      setError("Planned income editing is unavailable until planned-entry rules are verified.");
      return;
    }
    const dateError = isIncome
      ? validateIncomeDate(date)
      : validateExpenseDate(date, today);
    if (dateError) {
      setError(dateError);
      return;
    }

    const isFutureIncome = isIncome && date > today;
    const amountMinor = isIncome
      ? parseIncomeAmount(amount, activeAccount.decimal_places, isFutureIncome)
      : parseExpenseAmount(amount, activeAccount.decimal_places);
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
      if (editing) {
        const request = {
          transactionId: editing.id,
          kind: editing.kind,
          currentAccountId: account.id,
          accountId: activeAccount.id,
          categoryId: categoryId || undefined,
          amountMinor,
          date,
          note: note.trim() || undefined,
        };
        const operationId = operationIdFor(JSON.stringify(["edit", request.kind, request.transactionId]));
        const result = await updateTransaction({ operationId, ...request });
        onLedgerChange(result.ledger);
        operationAttempt.current = null;
        setEditing(null);
        setStatus("Transaction updated.");
      } else {
        const request = {
          accountId: activeAccount.id,
          categoryId: categoryId || undefined,
          amountMinor,
          date,
          note: note.trim() || undefined,
        };
        const operationId = operationIdFor(JSON.stringify(["create", mode]));
        const result = isIncome
          ? await saveIncome({ operationId, ...request })
          : await saveExpense({ operationId, ...request, categoryId: categoryId || "other" });
        onLedgerChange(result.ledger);
        operationAttempt.current = null;
        setStatus("");
      }
      setAmount("");
      setNote("");
      setDate(getLocalDate());
      setCategoryId(isIncome ? "" : "other");
      if (!isEditing) onBack();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  }

  /** Delete the confirmed history row using one stable operation ID across retries.
   * @returns Resolves after refresh or after displaying the storage error.
   */
  async function confirmDelete() {
    if (!confirmingDelete) return;
    const request = {
      transactionId: confirmingDelete.id,
      kind: confirmingDelete.kind,
      currentAccountId: account.id,
    };
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const operationId = operationIdFor(JSON.stringify(["delete", request.kind, request.transactionId]));
      const result = await deleteTransaction({ operationId, ...request });
      onLedgerChange(result.ledger);
      operationAttempt.current = null;
      setConfirmingDelete(null);
      setEditing(null);
      setStatus("Transaction deleted.");
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  }

  /** Populate the editor with a saved transaction's account precision and fields.
   * @param transaction - Expense or income row selected from the current account's history.
   * @returns Nothing; updates local editor state.
   */
  function editTransaction(transaction: TransactionRecord) {
    const transactionAccount = ledger.accounts.find(
      (candidate) => candidate.id === transaction.account_id,
    ) ?? account;
    setEditing(transaction);
    setAccountId(transaction.account_id);
    setAmount(
      (transaction.amount_minor / 10 ** transactionAccount.decimal_places)
        .toFixed(transactionAccount.decimal_places),
    );
    setNote(transaction.note ?? "");
    setDate(transaction.date);
    setCategoryId(transaction.category_id ?? (transaction.kind === "expense" ? "other" : ""));
    setError("");
    setStatus("");
  }

  const isIncome = (editing?.kind ?? mode) === "income";
  const originalAccount = editing
    ? ledger.accounts.find((candidate) => candidate.id === editing.account_id) ?? account
    : account;
  const editableAccounts = ledger.accounts.filter((candidate) =>
    candidate.currency_code === originalAccount.currency_code &&
    (!isIncome || ["debit", "credit"].includes(candidate.type)),
  );

  if (mode === "history" && !editing)
    return (
      <View style={styles.content}>
        <Pressable accessibilityRole="button" onPress={onBack} style={styles.back}>
          <Text style={styles.backText}>Back to account</Text>
        </Pressable>
        <Text style={styles.title}>Transaction history</Text>
        {status ? <Text accessibilityRole="status" style={styles.success}>{status}</Text> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <View style={styles.balanceSummary}>
          <Text style={styles.label}>Current balance</Text>
          <Text style={styles.balance}>
            {formatMoney(account.balance_minor, currency, account.decimal_places)}
          </Text>
        </View>
        {ledger.transactions.length === 0 ? (
          <Text style={styles.copy}>Your transactions will appear here.</Text>
        ) : (
          <ScrollView style={styles.history}>
            {ledger.transactions.map((transaction) => {
              const categoryLabel = transaction.category_label ?? "Income";
              const amountLabel = formatMoney(
                transaction.amount_minor,
                currency,
                account.decimal_places,
              );
              return (
                <View key={`${transaction.kind}:${transaction.id}`} style={styles.entry}>
                  <View style={styles.entryMain}>
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
                  <View style={styles.entryActions}>
                    {transaction.kind === "income" && transaction.planned ? (
                      <Text style={styles.meta}>Planned income editing is unavailable.</Text>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Edit ${transaction.note || categoryLabel}`}
                        onPress={() => editTransaction(transaction)}
                        style={styles.actionButton}
                      >
                        <Text style={styles.actionText}>Edit</Text>
                      </Pressable>
                    )}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${transaction.note || categoryLabel}`}
                      onPress={() => { setConfirmingDelete(transaction); setError(""); }}
                      style={styles.actionButton}
                    >
                      <Text style={styles.deleteText}>Delete</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}
        {confirmingDelete ? (
          <View style={styles.confirmation}>
            <Text style={styles.label}>Delete this {confirmingDelete.kind}?</Text>
            <Text style={styles.copy}>It will be removed from history and the account balance will be recalculated.</Text>
            <View style={styles.entryActions}>
              <Pressable accessibilityRole="button" onPress={() => setConfirmingDelete(null)} style={styles.actionButton}>
                <Text style={styles.actionText}>Cancel delete</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={saving} onPress={() => void confirmDelete()} style={styles.deleteButton}>
                <Text style={styles.deleteText}>{saving ? "Deleting…" : "Confirm delete"}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    );

  const categories = isIncome
    ? [{ id: "", label: "No category" }, ...ledger.income_categories]
    : ledger.expense_categories;

  return (
    <View style={styles.content}>
      <Pressable accessibilityRole="button" onPress={() => editing ? setEditing(null) : onBack()} style={styles.back}>
        <Text style={styles.backText}>{editing ? "Back to transaction history" : "Back to account"}</Text>
      </Pressable>
      <Text style={styles.title}>{editing ? `Edit ${isIncome ? "income" : "expense"}` : isIncome ? "Add income" : "Add an expense"}</Text>
      <Text style={styles.copy}>
        {editing ? "Correct the saved transaction details." : isIncome
          ? `Record income for ${account.name}.`
          : `Record money spent from ${account.name}.`}
      </Text>
      <View style={styles.balanceSummary}>
        <Text style={styles.label}>Current balance</Text>
        <Text style={styles.balance}>
          {formatMoney(activeAccount.balance_minor, currency, activeAccount.decimal_places)}
        </Text>
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {status ? <Text accessibilityRole="status" style={styles.success}>{status}</Text> : null}
      {editing ? (
        <>
          <Text style={styles.label}>Account ({originalAccount.currency_code})</Text>
          <Text style={styles.meta}>Account changes are limited to accounts using the same currency.</Text>
          <View style={styles.categories}>
            {editableAccounts.map((candidate) => (
              <Pressable
                key={candidate.id}
                accessibilityRole="button"
                accessibilityState={{ selected: candidate.id === activeAccount.id }}
                onPress={() => setAccountId(candidate.id)}
                style={[styles.category, candidate.id === activeAccount.id && styles.categorySelected]}
              >
                <Text style={[styles.categoryText, candidate.id === activeAccount.id && styles.categoryTextSelected]}>
                  {candidate.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
      <Text style={styles.label}>Amount ({currency})</Text>
      <TextInput
        accessibilityLabel={editing ? "Transaction amount" : isIncome ? "Income amount" : "Expense amount"}
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
          {saving ? "Saving…" : editing ? "Save changes" : isIncome ? "Save income" : "Save expense"}
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
    gap: 10,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#d8dfd2",
  },
  entryMain: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  entryCopy: { flex: 1, gap: 5 },
  entryTitle: { color: ink, fontSize: 16, fontWeight: "700" },
  meta: { color: "#526355", fontSize: 12, lineHeight: 18 },
  entryAmount: { color: ink, fontSize: 16, fontWeight: "700" },
  incomeAmount: { color: sage, fontSize: 16, fontWeight: "700" },
  success: { color: sage, fontSize: 14, fontWeight: "600" },
  entryActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  actionButton: {
    minHeight: 44,
    minWidth: 48,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "#c5cec0",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fffdf7",
  },
  actionText: { color: sage, fontSize: 13, fontWeight: "700" },
  deleteText: { color: "#752e1a", fontSize: 13, fontWeight: "700" },
  deleteButton: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#d7a08c",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fae7de",
  },
  confirmation: {
    gap: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#d7a08c",
    borderRadius: 14,
    backgroundColor: "#fff8f2",
  },
});
