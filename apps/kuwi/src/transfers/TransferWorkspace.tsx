import { createElement, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { getLocalDate } from "../expenses/entry";
import type { Account, CreateTransferResult } from "../storage/client";
import { saveTransfer } from "./commands";
import {
  normalizeTransferInput,
  parseTransferAmount,
  parseTransferFee,
  validateTransferDate,
} from "./entry";

const ink = "#293c32";
const sage = "#486b51";

/** Format minor units using the selected account's currency and decimal precision. */
function formatMoney(minor: number, currency: string, digits: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(minor / 10 ** digits);
}

/** Render a same-currency transfer form with eligible accounts and available funds.
 * @param accounts - Current local accounts and their derived balances.
 * @param initialAccount - Account selected before the user opens transfers.
 * @param onBack - Return to the selected account without saving.
 * @param onTransfer - Publish the committed account list and source ledger.
 */
export function TransferWorkspace({
  accounts,
  initialAccount,
  onBack,
  onTransfer,
}: {
  accounts: Account[];
  initialAccount: Account;
  onBack: () => void;
  onTransfer: (result: CreateTransferResult) => void;
}) {
  const sources = accounts.filter((item) =>
    ["debit", "credit"].includes(item.type) && item.currency_code === initialAccount.currency_code,
  );
  const [fromAccountId, setFromAccountId] = useState(initialAccount.id);
  const selectedSource = sources.find((item) => item.id === fromAccountId) ?? sources[0];
  const destinations = accounts.filter((item) =>
    item.id !== selectedSource?.id && item.type === "debit" &&
    item.currency_code === selectedSource?.currency_code,
  );
  const [toAccountId, setToAccountId] = useState("");
  const selectedDestination = destinations.find((item) => item.id === toAccountId) ?? destinations[0];
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(getLocalDate());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const operation = useRef<{ key: string; id: string } | null>(null);
  const currency = selectedSource?.currency_code ?? initialAccount.currency_code;
  const digits = selectedSource?.decimal_places ?? initialAccount.decimal_places;
  const available = selectedSource
    ? selectedSource.type === "credit"
      ? Math.max(0, (selectedSource.credit_limit_minor ?? 0) - selectedSource.balance_minor)
      : Math.max(0, selectedSource.balance_minor)
    : 0;

  /** Validate and submit with an operation ID stable across an unchanged retry. */
  async function submitTransfer() {
    if (!selectedSource || !selectedDestination) {
      setError("Add an eligible debit account in the same currency first.");
      return;
    }
    const dateError = validateTransferDate(date);
    if (dateError) return setError(dateError);
    const amountMinor = parseTransferAmount(amount, digits);
    if (amountMinor === null) {
      const decimalPart = amount.replace(/,/g, "").split(".")[1] ?? "";
      const precision = digits === 2 ? "two" : digits === 0 ? "zero" : String(digits);
      setError(decimalPart.length > digits
        ? `Enter an amount with at most ${precision} decimal places.`
        : "Enter a transfer amount greater than zero.");
      return;
    }
    const feeMinor = parseTransferFee(fee, digits);
    if (feeMinor === null) {
      const precision = digits === 2 ? "two" : digits === 0 ? "zero" : String(digits);
      setError(`Enter a valid fee with at most ${precision} decimal places.`);
      return;
    }
    const payload = {
      fromAccountId: selectedSource.id,
      toAccountId: selectedDestination.id,
      amountMinor,
      feeMinor,
      date,
      note: note.trim(),
    };
    const key = JSON.stringify(payload);
    if (operation.current?.key !== key)
      operation.current = { key, id: crypto.randomUUID() };
    setSaving(true);
    setError("");
    try {
      const result = await saveTransfer({
        operationId: operation.current.id,
        ...payload,
      });
      operation.current = null;
      onTransfer(result);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const selectStyle = {
    boxSizing: "border-box" as const,
    width: "100%",
    minHeight: 54,
    padding: 14,
    border: "1px solid #83927e",
    borderRadius: 14,
    fontSize: 17,
    color: ink,
    backgroundColor: "#fffdf7",
  };
  const sourceSelect = createElement(
    "select",
    {
      "aria-label": "From account",
      value: selectedSource?.id ?? "",
      onChange: (event: { currentTarget: { value: string } }) => {
        setFromAccountId(event.currentTarget.value);
        setToAccountId("");
      },
      style: selectStyle,
    },
    ...sources.map((item) => createElement("option", { key: item.id, value: item.id }, item.name)),
  );
  const destinationSelect = createElement(
    "select",
    {
      "aria-label": "To account",
      value: selectedDestination?.id ?? "",
      onChange: (event: { currentTarget: { value: string } }) => setToAccountId(event.currentTarget.value),
      style: selectStyle,
    },
    ...destinations.map((item) => createElement("option", { key: item.id, value: item.id }, item.name)),
  );

  return (
    <View style={styles.content}>
      <Pressable accessibilityRole="button" onPress={onBack} style={styles.back}>
        <Text style={styles.backText}>Back to account</Text>
      </Pressable>
      <Text accessibilityRole="header" style={styles.title}>Transfer between accounts</Text>
      <Text style={styles.copy}>Move money between accounts that use {currency}.</Text>
      {selectedSource ? (
        <View style={styles.available}>
          <Text style={styles.label}>{selectedSource.type === "credit" ? "Available credit" : "Available balance"}</Text>
          <Text style={styles.balance}>{formatMoney(available, currency, digits)}</Text>
        </View>
      ) : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {!destinations.length ? (
        <Text style={styles.hint}>Add a debit account in {currency} to receive a transfer.</Text>
      ) : null}
      <Text style={styles.label}>From account</Text>
      {sourceSelect}
      <Text style={styles.label}>To account</Text>
      {destinationSelect}
      <Text style={styles.label}>Amount ({currency})</Text>
      <TextInput
        accessibilityLabel="Transfer amount"
        value={amount}
        onChangeText={(value) => setAmount(normalizeTransferInput(value, digits))}
        keyboardType={digits === 0 ? "number-pad" : "decimal-pad"}
        placeholder="0"
        style={styles.input}
      />
      <Text style={styles.label}>Fee ({currency}, optional)</Text>
      <TextInput
        accessibilityLabel="Transfer fee (optional)"
        value={fee}
        onChangeText={(value) => setFee(normalizeTransferInput(value, digits))}
        keyboardType={digits === 0 ? "number-pad" : "decimal-pad"}
        placeholder="0"
        style={styles.input}
      />
      <Text style={styles.label}>Date</Text>
      {createElement("input", {
        "aria-label": "Transfer date",
        type: "date",
        value: date,
        onChange: (event: { currentTarget: { value: string } }) => setDate(event.currentTarget.value),
        style: {
          boxSizing: "border-box",
          width: "100%",
          minHeight: 54,
          padding: 16,
          border: "1px solid #83927e",
          borderRadius: 14,
          fontSize: 17,
          color: ink,
          backgroundColor: "#fffdf7",
        },
      })}
      <Text style={styles.label}>Note</Text>
      <TextInput
        accessibilityLabel="Transfer note"
        value={note}
        onChangeText={setNote}
        placeholder="Optional note"
        style={styles.input}
      />
      <Pressable
        accessibilityRole="button"
        disabled={saving || !selectedDestination}
        onPress={() => void submitTransfer()}
        style={[styles.saveButton, (saving || !selectedDestination) && styles.disabled]}
      >
        <Text style={styles.saveText}>{saving ? "Saving…" : "Save transfer"}</Text>
      </Pressable>
      <Text style={styles.hint}>
        The amount moves now, even when the transfer has a future date. Any fee is recorded as an expense.
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
  error: { padding: 14, borderRadius: 12, color: "#752e1a", backgroundColor: "#fae7de" },
  available: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#d8dfd2", gap: 6 },
  balance: { color: ink, fontSize: 26, fontWeight: "700" },
});
