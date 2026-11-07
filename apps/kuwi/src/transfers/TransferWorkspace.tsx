import { createElement, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { getLocalDate } from "../transactions/entry";
import type { Account, CreateTransferResult } from "../storage/client";
import { saveTransfer } from "./commands";
import {
  canonicalTransferRate,
  normalizeTransferInput,
  parseTransferAmount,
  parseTransferFee,
  parseTransferRate,
  rateFromReceivedAmount,
  receivedAmountFromRate,
  validateTransferDate,
} from "./entry";

const ink = "#293c32";
const sage = "#486b51";

/** Format integer minor units with the precision of the referenced currency. */
function formatMoney(minor: number, currency: string, digits: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(minor / 10 ** digits);
}

/** Render editable offline transfer details and preserve one command ID across unchanged retries.
 * @param accounts - Current local accounts with ledger-derived balances and currency precision.
 * @param initialAccount - Account selected before opening this workspace.
 * @param onBack - Return without changing the ledger.
 * @param onTransfer - Publish the atomic result after storage confirms the save.
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
  const sources = accounts.filter((item) => ["debit", "credit"].includes(item.type));
  const [fromAccountId, setFromAccountId] = useState(initialAccount.id);
  const selectedSource = sources.find((item) => item.id === fromAccountId) ?? sources[0];
  const destinations = accounts.filter((item) =>
    item.id !== selectedSource?.id && item.type === "debit",
  );
  const [toAccountId, setToAccountId] = useState("");
  const selectedDestination = destinations.find((item) => item.id === toAccountId) ?? destinations[0];
  const [amount, setAmount] = useState("");
  const [receivedAmount, setReceivedAmount] = useState("");
  const [exchangeRate, setExchangeRate] = useState("1");
  const [conversionMode, setConversionMode] = useState<"rate" | "received">("rate");
  const [fee, setFee] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(getLocalDate());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const operation = useRef<{ key: string; id: string } | null>(null);
  const sourceCurrency = selectedSource?.currency_code ?? initialAccount.currency_code;
  const sourceDigits = selectedSource?.decimal_places ?? initialAccount.decimal_places;
  const destinationCurrency = selectedDestination?.currency_code ?? sourceCurrency;
  const destinationDigits = selectedDestination?.decimal_places ?? sourceDigits;
  const sameCurrency = sourceCurrency === destinationCurrency;
  const sourceAmountMinor = parseTransferAmount(amount, sourceDigits);
  const enteredRate = parseTransferRate(exchangeRate);
  const enteredReceivedMinor = parseTransferAmount(receivedAmount, destinationDigits);
  const calculatedReceivedMinor = sameCurrency
    ? sourceAmountMinor
    : conversionMode === "rate" && sourceAmountMinor !== null && enteredRate !== null
      ? receivedAmountFromRate(sourceAmountMinor, sourceDigits, enteredRate, destinationDigits)
      : null;
  const receivedAmountMinor = sameCurrency
    ? sourceAmountMinor
    : conversionMode === "rate" ? calculatedReceivedMinor : enteredReceivedMinor;
  const effectiveRate = sameCurrency
    ? 1
    : conversionMode === "rate"
      ? enteredRate
      : sourceAmountMinor !== null && enteredReceivedMinor !== null
        ? rateFromReceivedAmount(sourceAmountMinor, sourceDigits, enteredReceivedMinor, destinationDigits)
        : null;
  const receivedText = sameCurrency
    ? amount
    : conversionMode === "rate" && calculatedReceivedMinor !== null
      ? minorText(calculatedReceivedMinor, destinationDigits)
      : receivedAmount;
  const feeMinorForSummary = parseTransferFee(fee, sourceDigits);
  const available = selectedSource
    ? selectedSource.type === "credit"
      ? Math.max(0, (selectedSource.credit_limit_minor ?? 0) - selectedSource.balance_minor)
      : Math.max(0, selectedSource.balance_minor)
    : 0;

  /** Format a minor-unit amount for an editable decimal input without rounding. */
  function minorText(minor: number, digits: number): string {
    const scale = 10 ** digits;
    const whole = Math.floor(minor / scale).toString();
    if (digits === 0) return whole;
    return `${whole}.${(minor % scale).toString().padStart(digits, "0")}`;
  }

  /** Strip unsupported exchange-rate characters while leaving fractional precision unlimited. */
  function cleanRateInput(value: string): string {
    const pieces = value.replace(/[^\d.]/g, "").split(".");
    return pieces.length > 1 ? `${pieces[0] || "0"}.${pieces.slice(1).join("")}` : pieces[0];
  }

  /** Validate and submit one operation with a stable ID for identical retries. */
  async function submitTransfer() {
    if (!selectedSource || !selectedDestination) {
      setError("Add an eligible debit account to receive this transfer.");
      return;
    }
    const dateError = validateTransferDate(date);
    if (dateError) return setError(dateError);
    if (sourceAmountMinor === null) {
      const fraction = amount.replace(/,/g, "").split(".")[1] ?? "";
      setError(fraction.length > sourceDigits
        ? `Enter an amount with at most ${sourceDigits} decimal places.`
        : "Enter a transfer amount greater than zero.");
      return;
    }
    const feeMinor = parseTransferFee(fee, sourceDigits);
    if (feeMinor === null) {
      setError(`Enter a valid fee with at most ${sourceDigits} decimal places.`);
      return;
    }
    if (receivedAmountMinor === null || effectiveRate === null || effectiveRate <= 0) {
      setError("Enter a positive received amount and exchange rate.");
      return;
    }
    const payload = {
      fromAccountId: selectedSource.id,
      toAccountId: selectedDestination.id,
      amountMinor: sourceAmountMinor,
      receivedAmountMinor,
      exchangeRate: canonicalTransferRate(effectiveRate),
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
      const result = await saveTransfer({ operationId: operation.current.id, ...payload });
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
  const sourceAmountLabel = sourceAmountMinor === null ? "Enter a valid source amount." :
    `Source amount: ${formatMoney(sourceAmountMinor, sourceCurrency, sourceDigits)}`;
  const receivedAmountLabel = receivedAmountMinor === null ? "Enter a rate or received amount." :
    `Received amount: ${formatMoney(receivedAmountMinor, destinationCurrency, destinationDigits)}`;
  const totalDeductionMinor = sourceAmountMinor !== null && feeMinorForSummary !== null
    ? sourceAmountMinor + feeMinorForSummary
    : null;

  return (
    <View style={styles.content}>
      <Pressable accessibilityRole="button" onPress={onBack} style={styles.back}>
        <Text style={styles.backText}>Back to account</Text>
      </Pressable>
      <Text accessibilityRole="header" style={styles.title}>Transfer between accounts</Text>
      <Text style={styles.copy}>Enter the conversion rate manually. Kuwi saves transfers offline.</Text>
      {selectedSource ? (
        <View style={styles.available}>
          <Text style={styles.label}>{selectedSource.type === "credit" ? "Available credit" : "Available balance"}</Text>
          <Text style={styles.balance}>{formatMoney(available, sourceCurrency, sourceDigits)}</Text>
        </View>
      ) : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {!destinations.length ? (
        <Text style={styles.hint}>Add a debit account to receive this transfer.</Text>
      ) : null}
      <Text style={styles.label}>From account</Text>
      {sourceSelect}
      <Text style={styles.label}>To account</Text>
      {destinationSelect}
      <Text style={styles.label}>Amount sent ({sourceCurrency})</Text>
      <TextInput
        accessibilityLabel="Transfer amount"
        value={amount}
        onChangeText={(value) => setAmount(normalizeTransferInput(value, sourceDigits))}
        keyboardType={sourceDigits === 0 ? "number-pad" : "decimal-pad"}
        placeholder="0"
        style={styles.input}
      />
      {!sameCurrency ? (
        <>
          <Text style={styles.label}>Exchange rate (1 {sourceCurrency} in {destinationCurrency})</Text>
          <TextInput
            accessibilityLabel="Exchange rate"
            value={conversionMode === "rate" ? exchangeRate : effectiveRate?.toString() ?? ""}
            onChangeText={(value) => {
              setConversionMode("rate");
              setExchangeRate(cleanRateInput(value));
            }}
            keyboardType="decimal-pad"
            placeholder="1"
            style={styles.input}
          />
          <Text style={styles.label}>Amount received ({destinationCurrency})</Text>
          <TextInput
            accessibilityLabel={`Amount received (${destinationCurrency})`}
            value={receivedText}
            onChangeText={(value) => {
              setConversionMode("received");
              setReceivedAmount(normalizeTransferInput(value, destinationDigits));
            }}
            keyboardType={destinationDigits === 0 ? "number-pad" : "decimal-pad"}
            placeholder="0"
            style={styles.input}
          />
        </>
      ) : null}
      <Text style={styles.label}>Fee ({sourceCurrency}, optional)</Text>
      <TextInput
        accessibilityLabel="Transfer fee (optional)"
        value={fee}
        onChangeText={(value) => setFee(normalizeTransferInput(value, sourceDigits))}
        keyboardType={sourceDigits === 0 ? "number-pad" : "decimal-pad"}
        placeholder="0"
        style={styles.input}
      />
      <Text style={styles.label}>Date</Text>
      {createElement("input", {
        "aria-label": "Transfer date",
        type: "date",
        value: date,
        onChange: (event: { currentTarget: { value: string } }) => setDate(event.currentTarget.value),
        style: selectStyle,
      })}
      <Text style={styles.label}>Note</Text>
      <TextInput
        accessibilityLabel="Transfer note"
        value={note}
        onChangeText={setNote}
        placeholder="Optional note"
        style={styles.input}
      />
      <View accessibilityLabel="Transfer summary" style={styles.summary}>
        <Text style={styles.summaryText}>{sourceAmountLabel}</Text>
        {!sameCurrency ? <Text style={styles.summaryText}>{receivedAmountLabel}</Text> : null}
        {!sameCurrency && effectiveRate !== null ? (
          <Text style={styles.summaryText}>Rate: 1 {sourceCurrency} = {effectiveRate.toString()} {destinationCurrency}</Text>
        ) : null}
        <Text style={styles.summaryText}>
          Fee: {formatMoney(feeMinorForSummary ?? 0, sourceCurrency, sourceDigits)} {sourceCurrency}
        </Text>
        <Text style={styles.summaryText}>
          Total source deduction: {totalDeductionMinor === null ? "Enter a valid amount." : formatMoney(totalDeductionMinor, sourceCurrency, sourceDigits)}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={saving || !selectedDestination}
        onPress={() => void submitTransfer()}
        style={[styles.saveButton, (saving || !selectedDestination) && styles.disabled]}
      >
        <Text style={styles.saveText}>{saving ? "Saving…" : "Save transfer"}</Text>
      </Pressable>
      <Text style={styles.hint}>The transfer takes effect immediately, including for a future date. Fees are recorded as expenses in {sourceCurrency}.</Text>
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
  summary: { gap: 8, borderRadius: 14, backgroundColor: "#eef1e7", padding: 16 },
  summaryText: { color: ink, fontSize: 14, lineHeight: 20 },
});
