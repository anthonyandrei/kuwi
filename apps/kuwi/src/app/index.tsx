import { useEffect, useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import {
  closeDatabase,
  database,
  type Account,
  type TransactionLedger,
  type ProductBackup,
  type Setup,
} from "../storage/client";
import { TransactionWorkspace } from "../transactions/TransactionWorkspace";
import { TransferWorkspace } from "../transfers/TransferWorkspace";
const currencies = [
  ["PHP", "Philippine Peso"],
  ["USD", "US Dollar"],
  ["EUR", "Euro"],
  ["GBP", "British Pound"],
  ["JPY", "Japanese Yen"],
  ["TWD", "New Taiwan Dollar"],
];
const cream = "#f9f5eb",
  ink = "#293c32",
  sage = "#486b51";

/** Return fraction digits for the currencies currently offered by Kuwi. */
function decimalPlaces(currency: string) {
  return currency === "JPY" ? 0 : 2;
}

/** Convert stored minor units into editable decimal text without rounding. */
function amountText(amountMinor: number, currency: string) {
  const scale = 10 ** decimalPlaces(currency);
  const whole = Math.floor(amountMinor / scale).toString();
  if (scale === 1) return whole;
  return `${whole}.${(amountMinor % scale).toString().padStart(2, "0")}`;
}

/** Parse nonnegative decimal text into safe integer minor units, or return null if invalid. */
function amountMinor(text: string, currency: string) {
  const digits = decimalPlaces(currency);
  const expression = digits === 0 ? /^\d+$/ : /^\d+(\.\d{0,2})?$/;
  if (!expression.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const amount = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0"));
  return Number.isSafeInteger(amount) ? amount : null;
}

/** Apply the recovered web input behavior: strip signs and truncate excess decimals. */
function cleanAmountInput(text: string, currency: string) {
  const digits = decimalPlaces(currency);
  const pieces = text.replace(/[^\d.]/g, "").split(".");
  const whole = pieces[0] || "0";
  if (digits === 0 || pieces.length === 1) return whole;
  return `${whole}.${pieces.slice(1).join("").slice(0, digits)}`;
}

/** Format stored minor units for account display using the selected currency's precision. */
function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
  }).format(amount / 10 ** decimalPlaces(currency));
}

type AccountForm = { mode: "create" } | { mode: "edit"; account: Account };

/** Render local setup, account management, transaction workspaces, and backup actions. */
export default function Home() {
  const [saved, setSaved] = useState<Setup | null>(null),
    [phase, setPhase] = useState("loading");
  const [name, setName] = useState(""),
    [account, setAccount] = useState("Cash"),
    [amount, setAmount] = useState("0");
  const [currency, setCurrency] = useState("PHP");
  const [calculator, setCalculator] = useState(false);
  const [intro, setIntro] = useState(0);
  const [awake, setAwake] = useState(false);
  const [step, setStep] = useState(0),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const [accountForm, setAccountForm] = useState<AccountForm | null>(null);
  const [accountName, setAccountName] = useState("");
  const [accountType, setAccountType] = useState<Account["type"]>("debit");
  const [accountCurrency, setAccountCurrency] = useState("PHP");
  const [accountBalance, setAccountBalance] = useState("0");
  const [creditLimit, setCreditLimit] = useState("0");
  const [creditOwedEnabled, setCreditOwedEnabled] = useState(false);
  const [operation, setOperation] = useState<{ key: string; id: string } | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [transactionLedger, setTransactionLedger] = useState<TransactionLedger | null>(null);
  const [transactionMode, setTransactionMode] = useState<"expense" | "income" | "history" | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [backupMessage, setBackupMessage] = useState("");
  /**
   * Reopen the worker and read canonical setup, updating saved data and phase.
   * Resolves after startup succeeds or its failure is displayed; callers reset
   * loading/error state before an explicit retry.
   */
  function load() {
    return closeDatabase()
      .then(() => database("state"))
      .then(
        (state) => {
          setSaved(state as Setup | null);
          setPhase("ready");
        },
        (failure: Error) => {
          setError(failure.message);
          setPhase("error");
        },
      );
  }
  useEffect(() => {
    void load();
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker
        .register("/sw.js")
        .catch(() =>
          setError("Offline caching failed. Stay online and reload to retry."),
        );
  }, []);

  /** Open a clean creation form or populate the editor from the selected account. */
  function editAccount(account?: Account) {
    setError("");
    setOperation(null);
    if (account) {
      setAccountForm({ mode: "edit", account });
      setAccountName(account.name);
      setAccountType(account.type);
      setAccountCurrency(account.currency_code);
      setAccountBalance(amountText(account.balance_minor, account.currency_code));
      setCreditLimit(
        account.credit_limit_minor === null
          ? "0"
          : amountText(account.credit_limit_minor, account.currency_code),
      );
      setCreditOwedEnabled(account.balance_minor > 0);
      return;
    }
    setAccountForm({ mode: "create" });
    setAccountName("");
    setAccountType("debit");
    setAccountCurrency(saved?.preferred_currency || "PHP");
    setAccountBalance("0");
    setCreditLimit("0");
    setCreditOwedEnabled(false);
  }

  /**
   * Reuse the current operation ID for an unchanged retry, or create a new one when input changes.
   * @param command - Database write command included in the retry identity.
   * @param payload - Normalized form fields included in the retry identity.
   * @returns The stable ID the database uses to deduplicate this submission.
   */
  function operationId(command: string, payload: object) {
    const key = JSON.stringify([command, payload]);
    if (!operation || operation.key !== key) {
      const next = { key, id: crypto.randomUUID() };
      setOperation(next);
      return next.id;
    }
    return operation.id;
  }

  /**
   * Validate form text, save the account command, and reload committed SQLite state.
   * The operation ID survives a failed response while the normalized content is unchanged.
   * Storage and validation errors stay visible in the form.
   */
  async function saveAccount() {
    if (!saved || !accountForm) return;
    const name = accountName.trim();
    if (!name) {
      setError("Please enter an account name.");
      return;
    }
    const balance = amountMinor(accountBalance, accountCurrency);
    const limit = accountType === "credit" ? amountMinor(creditLimit, accountCurrency) : null;
    if (balance === null || (accountType === "credit" && limit === null)) {
      setError("Enter an amount with at most two decimal places (whole numbers for JPY).");
      return;
    }
    const payload = {
      ...(accountForm.mode === "edit" ? { accountId: accountForm.account.id } : {}),
      name,
      type: accountType,
      currency: accountCurrency,
      balanceMinor: accountType === "credit" && !creditOwedEnabled ? 0 : balance,
      ...(accountType === "credit" ? { creditLimitMinor: limit } : {}),
    };
    const command = accountForm.mode === "create" ? "account.create" : "account.update";
    const operationKey = operationId(command, payload);
    setSaving(true);
    setError("");
    try {
      await database(command, { ...payload, operationId: operationKey });
      const state = (await database("state")) as Setup | null;
      setSaved(state);
      if (selectedAccount) {
        setSelectedAccount(
          state?.accounts.find((account) => account.id === selectedAccount.id) ?? null,
        );
      }
      setAccountForm(null);
      setOperation(null);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  }
  /**
   * Load the selected account's local ledger before opening an entry or history.
   * @param mode - Workspace view to display after the ledger loads.
   * @returns Resolves after opening the workspace or displaying a storage error.
   * On storage failure, keeps the current screen open and shows the error.
   */
  async function openTransactionWorkspace(mode: "expense" | "income" | "history") {
    if (!selectedAccount) return;
    setError("");
    try {
      const ledger = await database<TransactionLedger>("ledger", {
        accountId: selectedAccount.id,
      });
      setTransactionLedger(ledger);
      setTransactionMode(mode);
    } catch (failure) {
      setError((failure as Error).message);
    }
  }
  /** Validate onboarding amounts and commit setup through the worker's atomic command. */
  async function finish() {
    const digits = currency === "JPY" ? 0 : 2;
    if (!(digits === 0 ? /^\d+$/ : /^\d+(\.\d{0,2})?$/).test(amount)) {
      setError(
        "Enter an amount with at most two decimal places (whole numbers for JPY).",
      );
      return;
    }
    const [whole, fraction = ""] = amount.split(".");
    const minor =
      Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0"));
    if (!Number.isSafeInteger(minor)) {
      setError("This amount is too large.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      setSaved(
        (await database("complete", {
          name,
          account,
          currency,
          amountMinor: minor,
          operationId: "setup:first",
        })) as Setup | null,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  /** Close files before releasing ownership so another tab may safely open them. */
  async function close() {
    try {
      await closeDatabase();
      setPhase("closed");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  /** Download the complete v4 snapshot; report export errors in the visible page alert.
   * @returns {Promise<void>} Resolves after the browser download is triggered.
   */
  async function exportBackup() {
    setSaving(true);
    setError("");
    setBackupMessage("");
    try {
      const backup = await database<ProductBackup>("exportBackup");
      const file = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = `kuwi-backup-${new Date().toISOString().slice(0, 10)}.kuwi.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setBackupMessage("Backup downloaded.");
    } catch (failure) {
      setError(`Backup export failed: ${(failure as Error).message}`);
    } finally {
      setSaving(false);
    }
  }
  /** Parse and restore one selected file, updating visible state only after commit.
   * @param {File} file - User-selected backup contents; extension and MIME type are ignored.
   * @returns {Promise<void>} Resolves after success or after a failure is shown to the user.
   */
  async function restoreBackupFile(file: File) {
    setSaving(true);
    setError("");
    setBackupMessage("");
    try {
      let backup: unknown;
      try {
        backup = JSON.parse(await file.text());
      } catch {
        throw Error("This file is not valid JSON. Choose a Kuwi backup file.");
      }
      const restored = await database<Setup | null>("restoreBackup", { backup });
      setSaved(restored);
      setSelectedAccount(null);
      setTransactionLedger(null);
      setTransactionMode(null);
      setAccountForm(null);
      setBackupMessage("Backup restored.");
    } catch (failure) {
      setError(`Backup restore failed: ${(failure as Error).message}`);
    } finally {
      setSaving(false);
    }
  }
  /** Open the system file picker; `accept` is only a hint and content is validated after selection.
   * @returns {void} Starts a restore after the user selects a file; cancellation leaves data unchanged.
   */
  function chooseBackupFile() {
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = ".json,.kuwi-backup,application/json";
    picker.onchange = () => {
      const file = picker.files?.[0];
      if (file) void restoreBackupFile(file);
    };
    picker.click();
  }
  /** Render a labeled action with a real disabled state during validation or saving. */
  const button = (label: string, onPress: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[s.button, disabled && s.disabled]}
    >
      <Text style={s.buttonText}>{label}</Text>
    </Pressable>
  );
  return (
    <ScrollView
      contentContainerStyle={s.page}
      keyboardShouldPersistTaps="handled"
    >
      <View style={s.shell}>
        <Text style={s.brand}>kuwi</Text>
        {error ? (
          <Text accessibilityRole="alert" style={s.error}>
            {error}
          </Text>
        ) : null}
        {backupMessage ? (
          <Text accessibilityRole="status" style={s.note}>
            {backupMessage}
          </Text>
        ) : null}
        <Modal
          visible={calculator}
          transparent
          animationType="slide"
          onRequestClose={() => setCalculator(false)}
        >
          <View style={s.overlay}>
            <View style={s.calculator}>
              <Text style={s.title}>Opening balance</Text>
              <Text style={s.balance}>{amount}</Text>
              <View style={s.keys}>
                {[
                  "1",
                  "2",
                  "3",
                  "4",
                  "5",
                  "6",
                  "7",
                  "8",
                  "9",
                  ".",
                  "0",
                  "⌫",
                ].map((key) => (
                  <Pressable
                    key={key}
                    accessibilityRole="button"
                    accessibilityLabel={key === "⌫" ? "Delete digit" : key}
                    onPress={() =>
                      setAmount((value) =>
                        key === "⌫"
                          ? value.slice(0, -1) || "0"
                          : key === "."
                            ? currency === "JPY" || value.includes(".")
                              ? value
                              : value + "."
                            : value.includes(".") &&
                                value.split(".")[1].length >= 2
                              ? value
                              : value === "0"
                                ? key
                                : value + key,
                      )
                    }
                    style={s.key}
                  >
                    <Text style={s.title}>{key}</Text>
                  </Pressable>
                ))}
              </View>
              {button("Done", () => setCalculator(false))}
            </View>
          </View>
        </Modal>
        {phase === "loading" ? (
          <Text style={s.copy}>Opening your local account…</Text>
        ) : phase === "error" || phase === "closed" ? (
          <View style={s.content}>
            <Text style={s.title}>
              {phase === "closed"
                ? "Database closed"
                : "Unable to open your data"}
            </Text>
            <Text style={s.copy}>
              Your existing storage stays on this device.
            </Text>
            {button("Retry opening", () => {
              setPhase("loading");
              setError("");
              void load();
            })}
          </View>
        ) : saved ? (
          <View style={s.content}>
            <Text style={s.title}>Welcome, {saved.preferred_name}.</Text>
            {transferOpen && selectedAccount ? (
              <TransferWorkspace
                accounts={saved.accounts}
                initialAccount={selectedAccount}
                onBack={() => setTransferOpen(false)}
                onTransfer={(result) => {
                  setSaved((current) => current ? { ...current, accounts: result.accounts } : current);
                  setSelectedAccount(result.ledger.account);
                  setTransactionLedger(result.ledger);
                  setTransactionMode(null);
                  setTransferOpen(false);
                }}
              />
            ) : transactionMode && transactionLedger ? (
              <TransactionWorkspace
                mode={transactionMode}
                ledger={transactionLedger}
                onBack={() => setTransactionMode(null)}
                onLedgerChange={(next) => {
                  setTransactionLedger(next);
                  setSelectedAccount(next.account);
                  setSaved((current) => current ? {
                    ...current,
                    accounts: next.accounts,
                  } : current);
                }}
              />
            ) : accountForm ? (
              <View style={s.form}>
                <Text accessibilityRole="header" style={s.sectionTitle}>
                  {accountForm.mode === "create" ? "New account" : "Edit account"}
                </Text>
                <Text style={s.label}>Account name</Text>
                <TextInput
                  accessibilityLabel="Account name"
                  value={accountName}
                  onChangeText={setAccountName}
                  style={s.input}
                />
                {accountForm.mode === "create" ? (
                  <>
                    <Text style={s.label}>Account type</Text>
                    <View style={s.typeOptions}>
                      {(["debit", "assets", "credit"] as const).map((type) => (
                        <Pressable
                          key={type}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: accountType === type }}
                          accessibilityLabel={type === "assets" ? "Assets" : type === "credit" ? "Credit" : "Debit"}
                          onPress={() => {
                            setAccountType(type);
                            setAccountBalance("0");
                            setCreditOwedEnabled(false);
                          }}
                          style={[s.typeOption, accountType === type && s.typeSelected]}
                        >
                          <Text style={s.label}>{type === "assets" ? "Assets" : type === "credit" ? "Credit" : "Debit"}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </>
                ) : null}
                <Text style={s.label}>Currency</Text>
                <View style={s.currencyOptions}>
                  {currencies.map(([code, label]) => (
                    <Pressable
                      key={code}
                      accessibilityRole="button"
                      accessibilityLabel={`${code} ${label}`}
                      accessibilityState={{ selected: accountCurrency === code }}
                      disabled={accountForm.mode === "edit" && Boolean(accountForm.account.has_activity)}
                      onPress={() => {
                        setAccountCurrency(code);
                        setAccountBalance((value) => cleanAmountInput(value, code));
                        setCreditLimit((value) => cleanAmountInput(value, code));
                      }}
                      style={[
                        s.currencyOption,
                        accountCurrency === code && s.typeSelected,
                        accountForm.mode === "edit" && accountForm.account.has_activity ? s.disabled : null,
                      ]}
                    >
                      <Text style={s.label}>{code}</Text>
                    </Pressable>
                  ))}
                </View>
                {accountType === "credit" ? (
                  <>
                    <Text style={s.label}>Credit limit ({accountCurrency})</Text>
                    <TextInput
                      accessibilityLabel={`Credit limit (${accountCurrency})`}
                      value={creditLimit}
                      onChangeText={(value) => setCreditLimit(cleanAmountInput(value, accountCurrency))}
                      keyboardType="decimal-pad"
                      style={s.input}
                    />
                    {accountForm.mode === "create" ? (
                      <>
                        {button(creditOwedEnabled ? "Remove current balance" : "Add current balance", () => {
                          setCreditOwedEnabled(!creditOwedEnabled);
                          if (!creditOwedEnabled) setAccountBalance("0");
                        })}
                        {creditOwedEnabled ? (
                          <>
                            <Text style={s.label}>Current balance ({accountCurrency})</Text>
                            <TextInput
                              accessibilityLabel={`Current balance (${accountCurrency})`}
                              value={accountBalance}
                              onChangeText={(value) => setAccountBalance(cleanAmountInput(value, accountCurrency))}
                              keyboardType="decimal-pad"
                              style={s.input}
                            />
                          </>
                        ) : null}
                      </>
                    ) : null}
                  </>
                ) : (
                  <>
                    <Text style={s.label}>Opening balance ({accountCurrency})</Text>
                    <TextInput
                      accessibilityLabel={`Opening balance (${accountCurrency})`}
                      value={accountBalance}
                      onChangeText={(value) => setAccountBalance(cleanAmountInput(value, accountCurrency))}
                      keyboardType="decimal-pad"
                      editable={accountForm.mode === "create" || !accountForm.account.has_activity}
                      style={[s.input, accountForm.mode === "edit" && Boolean(accountForm.account.has_activity) && s.lockedInput]}
                    />
                  </>
                )}
                {button(
                  saving ? "Saving…" : accountForm.mode === "create" ? "Save account" : "Save changes",
                  () => void saveAccount(),
                  saving,
                )}
                {button("Cancel", () => {
                  setAccountForm(null);
                  setError("");
                  setOperation(null);
                }, saving)}
              </View>
            ) : selectedAccount ? (
              <View style={s.accountDetails}>
                <Text accessibilityRole="header" style={s.sectionTitle}>
                  {selectedAccount.name}
                </Text>
                <Text style={s.note}>
                  {selectedAccount.type === "assets" ? "Assets" : selectedAccount.type === "credit" ? "Credit" : "Debit"} account
                </Text>
                <Text style={s.label}>Balance</Text>
                <Text style={s.accountBalance}>
                  {formatMoney(selectedAccount.balance_minor, selectedAccount.currency_code)}
                </Text>
                <Text style={s.note}>Currency {selectedAccount.currency_code}</Text>
                {selectedAccount.type === "credit" && selectedAccount.credit_limit_minor !== null ? (
                  <Text style={s.note}>
                    Credit limit {formatMoney(selectedAccount.credit_limit_minor, selectedAccount.currency_code)}
                  </Text>
                ) : null}
                {button("Add expense", () => void openTransactionWorkspace("expense"))}
                {selectedAccount.type !== "assets"
                  ? button("Add income", () => void openTransactionWorkspace("income"))
                  : null}
                {selectedAccount.type !== "assets"
                  ? button("Transfer between accounts", () => setTransferOpen(true))
                  : null}
                {button("Transaction history", () => void openTransactionWorkspace("history"))}
                {button("Edit account details", () => editAccount(selectedAccount))}
                {button("Back to accounts", () => setSelectedAccount(null))}
              </View>
            ) : (
              <View style={s.accounts}>
                <Text accessibilityRole="header" style={s.sectionTitle}>Your accounts</Text>
                {(saved.accounts || []).map((account) => (
                  <View key={account.id} style={s.account}>
                    <View style={s.accountHeading}>
                      <View style={s.accountCopy}>
                        <Text style={s.label}>{account.name}</Text>
                        <Text style={s.note}>{account.type === "assets" ? "Assets" : account.type === "credit" ? "Credit" : "Debit"} / {account.currency_code}</Text>
                      </View>
                      <Text style={s.accountBalance}>{formatMoney(account.balance_minor, account.currency_code)}</Text>
                    </View>
                    {account.type === "credit" && account.credit_limit_minor !== null ? (
                      <Text style={s.note}>Credit limit {formatMoney(account.credit_limit_minor, account.currency_code)}</Text>
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`View account ${account.name}`}
                      onPress={() => setSelectedAccount(account)}
                      style={s.editButton}
                    >
                      <Text style={s.editButtonText}>View account</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Edit account ${account.name}`}
                      onPress={() => editAccount(account)}
                      style={s.editButton}
                    >
                      <Text style={s.editButtonText}>Edit account</Text>
                    </Pressable>
                  </View>
                ))}
                {button("Add account", () => editAccount())}
                <Text style={s.note}>Saved on this device. No sign-in required.</Text>
                <Text style={s.note}>Restoring a backup replaces the data saved in this browser.</Text>
                {button(saving ? "Exporting…" : "Export backup", () => void exportBackup(), saving)}
                {button(saving ? "Working…" : "Restore backup", chooseBackupFile, saving)}
                {button("Close database", () => void close())}
              </View>
            )}
          </View>
        ) : (
          <View style={s.content}>
            <Animated.View
              key={`${step}-${intro}`}
              entering={FadeIn.duration(300).reduceMotion(ReduceMotion.System)}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Wake Kuwi"
                onPress={() => setAwake(true)}
              >
                <Image
                  source={{ uri: "/quokka.png" }}
                  style={s.mascot}
                  accessibilityLabel="Kuwi the quokka"
                />
              </Pressable>
              {step === 0 ? (
                <Text style={s.mascotHint}>
                  {awake
                    ? "Hello. Ready when you are."
                    : "Tap Kuwi to say hello"}
                </Text>
              ) : null}
            </Animated.View>
            {step === 0 ? (
              <>
                <Text style={s.title}>Make yourself at home.</Text>
                <Text style={s.copy}>
                  Start with your name and the money you have today.
                </Text>
                {button("Continue offline", () => setStep(1))}
                <Text style={s.note}>
                  Safari and the Home Screen app keep separate local data.
                </Text>
              </>
            ) : step === 1 ? (
              <>
                <Text style={s.title}>What should Kuwi call you?</Text>
                <Text style={s.label}>Preferred name</Text>
                <TextInput
                  accessibilityLabel="Preferred name"
                  value={name}
                  onChangeText={setName}
                  autoComplete="given-name"
                  maxLength={100}
                  style={s.input}
                  returnKeyType="next"
                  onSubmitEditing={() => {
                    if (name.trim()) setStep(4);
                  }}
                />
                {button("Next", () => setStep(4), !name.trim())}
              </>
            ) : step === 4 ? (
              <>
                <Text style={s.title}>
                  {
                    [
                      "A little more clarity.",
                      "A place for every peso.",
                      "Room for your plans.",
                    ][intro]
                  }
                </Text>
                <Text style={s.copy}>
                  {
                    [
                      "See where your money goes, one day at a time.",
                      "Start with the cash or account you use most.",
                      "Build from what you have today.",
                    ][intro]
                  }
                </Text>
                {button("Next", () => {
                  if (intro < 2) setIntro(intro + 1);
                  else setStep(2);
                })}
                {button("Skip introduction", () => setStep(2))}
              </>
            ) : step === 2 ? (
              <>
                <Text style={s.title}>Your main currency</Text>
                <Text style={s.copy}>
                  {currencies.find((item) => item[0] === currency)?.[1]} (
                  {currency})
                </Text>
                {currencies.map(([code, label]) => (
                  <Pressable
                    key={code}
                    accessibilityRole="button"
                    accessibilityLabel={`${code} ${label}`}
                    accessibilityState={{ selected: currency === code }}
                    onPress={() => setCurrency(code)}
                    style={[
                      s.input,
                      currency === code && {
                        borderColor: sage,
                        borderWidth: 2,
                      },
                    ]}
                  >
                    <Text style={s.label}>
                      {code} {label}
                      {currency === code ? "  ✓" : ""}
                    </Text>
                  </Pressable>
                ))}
                {button("Next", () => setStep(3))}
                {button("Back", () => setStep(1))}
              </>
            ) : (
              <>
                <Text style={s.title}>Your first account</Text>
                <Text style={s.label}>Account name</Text>
                <TextInput
                  accessibilityLabel="Account name"
                  value={account}
                  onChangeText={setAccount}
                  style={s.input}
                />
                <Text style={s.label}>Opening balance ({currency})</Text>
                <TextInput
                  accessibilityLabel={`Opening balance (${currency})`}
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="decimal-pad"
                  style={s.input}
                />
                {button("Use number pad", () => setCalculator(true))}
                <Text style={s.note}>Leave the name blank to use Cash.</Text>
                {button(
                  saving ? "Saving…" : "Save my account",
                  () => void finish(),
                  saving,
                )}
                {button("Back", () => setStep(2), saving)}
              </>
            )}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
const s = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "#293c3266",
  },
  calculator: {
    backgroundColor: cream,
    padding: 24,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    gap: 20,
  },
  keys: { flexDirection: "row", flexWrap: "wrap" },
  key: { width: "33.33%", padding: 16, alignItems: "center" },
  page: { flexGrow: 1, backgroundColor: cream, padding: 24 },
  shell: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    paddingTop: 24,
    paddingBottom: 32,
  },
  brand: { color: ink, fontSize: 32, fontWeight: "800", marginBottom: 24 },
  content: { gap: 18 },
  title: { fontSize: 32, lineHeight: 38, fontWeight: "700", color: ink },
  copy: { fontSize: 17, lineHeight: 26, color: ink },
  label: { fontSize: 16, fontWeight: "600", color: ink },
  note: { fontSize: 14, lineHeight: 22, color: "#526355" },
  mascotHint: {
    textAlign: "center",
    color: "#526355",
    fontSize: 13,
    marginTop: 12,
  },
  mascot: {
    width: 220,
    height: 220,
    alignSelf: "center",
    resizeMode: "contain",
    borderRadius: 110,
  },
  input: {
    padding: 18,
    borderWidth: 1,
    borderColor: "#83927e",
    borderRadius: 14,
    fontSize: 18,
    color: ink,
    backgroundColor: "#fffdf7",
  },
  button: {
    padding: 18,
    borderRadius: 14,
    backgroundColor: sage,
    alignItems: "center",
  },
  buttonText: { color: "#ffffff", fontSize: 17, fontWeight: "600" },
  disabled: { opacity: 0.5 },
  error: {
    backgroundColor: "#fae7de",
    color: "#752e1a",
    padding: 16,
    marginBottom: 20,
    borderRadius: 12,
  },
  account: {
    backgroundColor: "#e2e9d9",
    padding: 18,
    borderRadius: 14,
    gap: 12,
  },
  accounts: { gap: 16 },
  form: { gap: 14 },
  accountDetails: { gap: 12 },
  sectionTitle: { fontSize: 24, lineHeight: 30, fontWeight: "700", color: ink },
  accountHeading: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  accountCopy: { flex: 1, gap: 5 },
  accountBalance: { fontSize: 19, fontWeight: "700", color: ink, fontVariant: ["tabular-nums"] },
  editButton: { alignSelf: "flex-start", paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "#f9f5eb" },
  editButtonText: { color: sage, fontSize: 14, fontWeight: "700" },
  typeOptions: { flexDirection: "row", gap: 8 },
  typeOption: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: "#83927e", backgroundColor: "#fffdf7" },
  typeSelected: { borderColor: sage, borderWidth: 2, backgroundColor: "#e2e9d9" },
  currencyOptions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  currencyOption: { minWidth: 54, alignItems: "center", paddingVertical: 10, paddingHorizontal: 12, borderRadius: 11, borderWidth: 1, borderColor: "#83927e", backgroundColor: "#fffdf7" },
  lockedInput: { opacity: 0.65, backgroundColor: "#e2e9d9" },
  balance: { fontSize: 36, fontWeight: "600", color: ink },
});
