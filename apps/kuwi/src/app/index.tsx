import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
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
import Animated, { FadeIn, ReduceMotion, useReducedMotion } from "react-native-reanimated";
import {
  closeDatabase,
  database,
  type Account,
  type BackupReview,
  type TransactionLedger,
  type ProductBackup,
  type BudgetState,
  type Setup,
} from "../storage/client";
import { TransactionWorkspace, clearTransactionDrafts } from "../transactions/TransactionWorkspace";
import { TransferWorkspace, clearTransferDrafts } from "../transfers/TransferWorkspace";
import { BudgetWorkspace, clearBudgetDrafts } from "../budgets/BudgetWorkspace";
const currencies = [
  ["PHP", "Philippine Peso"],
  ["USD", "US Dollar"],
  ["EUR", "Euro"],
  ["GBP", "British Pound"],
  ["JPY", "Japanese Yen"],
  ["TWD", "New Taiwan Dollar"],
];
const cream = "var(--kuwi-page)",
  ink = "var(--kuwi-ink)",
  sage = "var(--kuwi-accent-button)",
  accentText = "var(--kuwi-accent-text)";

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

/** Read the URL parameters that identify a workspace location.
 * @param search - Query string from the current browser location.
 * @returns Route values, defaulting to the accounts view when no view is present.
 */
function routeFromLocation(search: string) {
  const params = new URLSearchParams(search);
  return {
    view: params.get("view") ?? "accounts",
    accountId: params.get("accountId") ?? undefined,
    mode: params.get("mode") ?? undefined,
    transactionId: params.get("transactionId") ?? undefined,
  };
}

type AccountForm = { mode: "create" } | { mode: "edit"; account: Account };
type AppRoute = { view: string; accountId?: string; mode?: string; transactionId?: string };

/** Keep one local database owner while rendering navigable finance and recovery workspaces. */
export default function Home() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const route = useLocalSearchParams<{ view?: string; accountId?: string; mode?: string; transactionId?: string }>();
  const [activeRoute, setActiveRoute] = useState<AppRoute>(() => ({
    view: route.view ?? "accounts",
    accountId: route.accountId,
    mode: route.mode,
    transactionId: route.transactionId,
  }));
  const routeView = activeRoute.view;
  const routeKey = `${activeRoute.view}:${activeRoute.accountId ?? ""}:${activeRoute.mode ?? ""}:${activeRoute.transactionId ?? ""}`;
  const hydratedRoute = useRef<string | null>(null);
  const initialRoute = useRef(activeRoute);
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
  const [accountFieldError, setAccountFieldError] = useState<{
    field: "name" | "balance" | "limit";
    message: string;
  } | null>(null);
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
  const [budgetState, setBudgetState] = useState<BudgetState | null>(null);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [backupMessage, setBackupMessage] = useState("");
  const [backupCandidate, setBackupCandidate] = useState<{
    name: string;
    backup: unknown;
    details: BackupReview;
  } | null>(null);
  const [dataManagementOpen, setDataManagementOpen] = useState(false);
  const [troubleshootingOpen, setTroubleshootingOpen] = useState(false);
  const editAccountRef = useRef<((account?: Account, navigate?: boolean) => void) | null>(null);

  /** Update the active workspace and its URL without mounting another database owner.
   * Browser changes use the History API; native routing receives the same parameters.
   * @param view - Workspace route name.
   * @param accountId - Optional account referenced by the route.
   * @param mode - Optional entry or history mode.
   * @param transactionId - Optional transaction selected for editing.
   * @param replace - Replace the current browser entry instead of pushing one.
   * @param resetStack - When replacing, start a fresh Kuwi route stack.
   */
  const writeRoute = useCallback((view: string, accountId?: string, mode?: string, transactionId?: string, replace = false, resetStack = false) => {
    const nextRoute = { view, accountId, mode, transactionId };
    setActiveRoute(nextRoute);
    if (typeof window === "undefined") {
      router.setParams({
        view,
        ...(accountId ? { accountId } : {}),
        ...(mode ? { mode } : {}),
        ...(transactionId ? { transactionId } : {}),
      });
      return;
    }
    const url = new URL(window.location.href);
    for (const key of ["view", "accountId", "mode", "transactionId"]) url.searchParams.delete(key);
    url.searchParams.set("view", view);
    if (accountId) url.searchParams.set("accountId", accountId);
    if (mode) url.searchParams.set("mode", mode);
    if (transactionId) url.searchParams.set("transactionId", transactionId);
    const state = { ...(window.history.state ?? {}), kuwiRoute: true };
    if (replace) {
      const stack = (state.kuwiStack as AppRoute[] | undefined) ?? [];
      const nextStack = resetStack ? [nextRoute] : stack.length ? [...stack.slice(0, -1), nextRoute] : [nextRoute];
      window.history.replaceState({ ...state, kuwiStack: nextStack, kuwiDepth: nextStack.length - 1 }, "", url);
    } else {
      const stack = (state.kuwiStack as AppRoute[] | undefined) ?? [activeRoute];
      const nextStack = [...stack, nextRoute];
      window.history.pushState({ ...state, kuwiStack: nextStack, kuwiDepth: nextStack.length - 1 }, "", url);
    }
  }, [activeRoute, router]);

  /** Add a browser history entry for the requested workspace.
   * @param view - Workspace route name.
   * @param accountId - Optional account referenced by the route.
   * @param mode - Optional entry or history mode.
   * @param transactionId - Optional transaction selected for editing.
   */
  const pushView = useCallback((view: string, accountId?: string, mode?: string, transactionId?: string) => {
    writeRoute(view, accountId, mode, transactionId);
  }, [writeRoute]);

  /** Replace the current URL after a fallback or completed form.
   * @param view - Workspace route name.
   * @param accountId - Optional account referenced by the route.
   * @param mode - Optional entry or history mode.
   * @param transactionId - Optional transaction selected for editing.
   * @param resetStack - Clear previous Kuwi route references when true.
   */
  const replaceView = useCallback((view: string, accountId?: string, mode?: string, transactionId?: string, resetStack = false) => {
    writeRoute(view, accountId, mode, transactionId, true, resetStack);
  }, [writeRoute]);

  /** Return to the nearest matching prior workspace or replace the URL when none exists.
   * @param view - Workspace to return to.
   * @param accountId - Account that must match the target route, when applicable.
   */
  const backTo = useCallback((view: string, accountId?: string) => {
    if (typeof window === "undefined") return replaceView(view, accountId);
    const stack = window.history.state?.kuwiStack as AppRoute[] | undefined;
    const currentIndex = (stack?.length ?? 0) - 1;
    let targetIndex = -1;
    for (let index = currentIndex - 1; index >= 0; index -= 1) {
      const item = stack?.[index];
      if (item?.view === view && item.accountId === accountId) {
        targetIndex = index;
        break;
      }
    }
    if (targetIndex >= 0 && targetIndex < currentIndex) window.history.go(targetIndex - currentIndex);
    else replaceView(view, accountId);
  }, [replaceView]);
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.history.state?.kuwiRoute) {
      window.history.replaceState(
        { ...(window.history.state ?? {}), kuwiRoute: true, kuwiDepth: 0, kuwiStack: [initialRoute.current] },
        "",
        window.location.href,
      );
    }
    const syncRoute = () => setActiveRoute(routeFromLocation(window.location.search));
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  /** Rehydrate route state after browser Back, Forward, or a supported direct URL. */
  useEffect(() => {
    if (!saved || hydratedRoute.current === routeKey) return;
    hydratedRoute.current = routeKey;
    const currentSaved = saved;
    const frame = requestAnimationFrame(() => {
      const account = currentSaved.accounts.find((item) => item.id === activeRoute.accountId);
      const view = activeRoute.view;
      const supportedViews = [
        "accounts", "account", "new-account", "edit-account", "expense", "income",
        "history", "transaction-edit", "transfer", "budgets", "data-management",
        "troubleshooting", "backup-review",
      ];
      if (!supportedViews.includes(view)) {
        replaceView("accounts");
        return;
      }
      const accountViews = ["account", "edit-account", "expense", "income", "history", "transaction-edit", "transfer"];
      setSelectedAccount(accountViews.includes(view) ? account ?? null : null);
      if (!["accounts", "account", "new-account", "edit-account"].includes(view)) {
        setTransactionMode(null);
      }
      setTransferOpen(false);
      setBudgetOpen(false);
      setDataManagementOpen(false);
      setTroubleshootingOpen(false);

      if (accountViews.includes(view) && !account) {
        replaceView("accounts");
      } else if (["expense", "income", "history", "transaction-edit"].includes(view) && account) {
        const mode = view === "transaction-edit" ? "history" : view as "expense" | "income" | "history";
        setTransactionMode(mode);
        void database<TransactionLedger>("ledger", { accountId: account.id }).then(setTransactionLedger).catch((failure: Error) => setError(failure.message));
      } else if (view === "transfer" && account) {
        setTransferOpen(true);
      } else if (view === "budgets") {
        setBudgetOpen(true);
        void database<BudgetState>("budgetState").then(setBudgetState).catch((failure: Error) => setError(failure.message));
      } else if (view === "data-management") {
        setDataManagementOpen(true);
      } else if (view === "troubleshooting") {
        setTroubleshootingOpen(true);
      } else if (view === "backup-review" && !backupCandidate) {
        setDataManagementOpen(true);
        replaceView("data-management");
      } else if (view === "edit-account" && account && !accountForm) {
        editAccountRef.current?.(account, false);
      } else if (view === "new-account" && !accountForm) {
        editAccountRef.current?.(undefined, false);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [routeKey, saved, activeRoute.accountId, activeRoute.view, accountForm, backupCandidate, replaceView]);

  useEffect(() => {
    if (!saved) return;
    const frame = requestAnimationFrame(() => {
      if (document.activeElement !== document.body && document.activeElement !== document.documentElement) return;
      const heading = document.getElementById("route-heading");
      if (!heading) return;
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [routeKey, saved, selectedAccount, transactionLedger, budgetState, accountForm, backupCandidate, dataManagementOpen, troubleshootingOpen, transferOpen]);

  /** Open a clean creation form or populate the editor from the selected account.
   * @param account - Account to edit; omitted to create an account.
   * @param navigate - Whether to add the corresponding workspace location.
   */
  function editAccount(account?: Account, navigate = true) {
    setError("");
    setAccountFieldError(null);
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
      if (navigate) pushView("edit-account", account.id);
      return;
    }
    setAccountForm({ mode: "create" });
    setAccountName("");
    setAccountType("debit");
    setAccountCurrency(saved?.preferred_currency || "PHP");
    setAccountBalance("0");
    setCreditLimit("0");
    setCreditOwedEnabled(false);
    if (navigate) pushView("new-account");
  }
  useEffect(() => {
    editAccountRef.current = editAccount;
  });

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
      setError("");
      setAccountFieldError({ field: "name", message: "Please enter an account name." });
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[aria-label="Account name"]')?.focus());
      return;
    }
    const balance = amountMinor(accountBalance, accountCurrency);
    const limit = accountType === "credit" ? amountMinor(creditLimit, accountCurrency) : null;
    if (balance === null) {
      const message = "Enter an amount with at most two decimal places (whole numbers for JPY).";
      setError("");
      setAccountFieldError({ field: "balance", message });
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[aria-label^="Opening balance"], [aria-label^="Current balance"]')?.focus());
      return;
    }
    if (accountType === "credit" && limit === null) {
      const message = "Enter an amount with at most two decimal places (whole numbers for JPY).";
      setError("");
      setAccountFieldError({ field: "limit", message });
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[aria-label^="Credit limit"]')?.focus());
      return;
    }
    setAccountFieldError(null);
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
      replaceView(
        accountForm.mode === "edit" && selectedAccount ? "account" : "accounts",
        accountForm.mode === "edit" ? selectedAccount?.id : undefined,
      );
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
      pushView(mode, selectedAccount.id, mode);
    } catch (failure) {
      setError((failure as Error).message);
    }
  }
  /** Read canonical category budgets and derived progress before navigation.
   * @returns Resolves after opening the budget view or displaying a storage error.
   */
  async function openBudgetWorkspace() {
    setError("");
    try {
      const budgets = await database<BudgetState>("budgetState");
      setBudgetState(budgets);
      setBudgetOpen(true);
      pushView("budgets");
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
      setTroubleshootingOpen(false);
      replaceView("accounts", undefined, undefined, undefined, true);
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
  /** Parse and validate one selected file, then stage it for review without changing saved data.
   * @param {File} file - User-selected backup contents; extension and MIME type are ignored.
   * @returns {Promise<void>} Resolves after review is staged or validation failure is shown.
   * @throws Validation failures are caught and displayed beside the recovery action.
   */
  async function reviewBackupFile(file: File) {
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
      const details = await database<BackupReview>("inspectBackup", { backup });
      setBackupCandidate({ name: file.name, backup, details });
      pushView("backup-review");
    } catch (failure) {
      setError(`Backup validation failed: ${(failure as Error).message}`);
    } finally {
      setSaving(false);
    }
  }
  /** Replace the current ledger after confirmation and clear state tied to the old data.
   * A worker failure leaves the prior ledger intact and displays an error in the review.
   */
  async function confirmBackupRestore() {
    if (!backupCandidate || saving) return;
    setSaving(true);
    setError("");
    setBackupMessage("");
    try {
      const restored = await database<Setup | null>("restoreBackup", { backup: backupCandidate.backup });
      clearBudgetDrafts();
      clearTransactionDrafts();
      clearTransferDrafts();
      setSaved(restored);
      setSelectedAccount(null);
      setTransactionLedger(null);
      setTransactionMode(null);
      setBudgetState(null);
      setBudgetOpen(false);
      setAccountForm(null);
      setBackupCandidate(null);
      setDataManagementOpen(false);
      replaceView("accounts", undefined, undefined, undefined, true);
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
    setError("");
    setBackupMessage("");
    setBackupCandidate(null);
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = ".json,.kuwi-backup,application/json";
    picker.onchange = () => {
      const file = picker.files?.[0];
      if (file) void reviewBackupFile(file);
    };
    picker.click();
  }
  /** Render a labeled action with a real disabled state during validation or saving. */
  const button = (
    label: string,
    onPress: () => void,
    disabled = false,
    appearance: "primary" | "secondary" = "primary",
  ) => (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[appearance === "primary" ? s.button : s.secondaryButton, disabled && s.disabled]}
    >
      <Text style={appearance === "primary" ? s.buttonText : s.secondaryButtonText}>{label}</Text>
    </Pressable>
  );
  return (
    <ScrollView
      contentContainerStyle={s.page}
      keyboardShouldPersistTaps="handled"
    >
      <View style={s.shell}>
        <Text style={s.brand}>kuwi</Text>
        {error && !accountForm && !backupCandidate && !dataManagementOpen && !troubleshootingOpen ? (
          <Text accessibilityRole="alert" style={s.error}>
            {error}
          </Text>
        ) : null}
        <Modal
          visible={calculator}
          transparent
          animationType={reduceMotion ? "none" : "slide"}
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
            {!transferOpen && !budgetOpen && !transactionMode && !accountForm
              ? button("Budgets", () => void openBudgetWorkspace())
              : null}
            {budgetOpen && budgetState && routeView === "budgets" ? (
              <BudgetWorkspace
                initialState={budgetState}
                onBack={() => { setBudgetOpen(false); backTo("accounts"); }}
                onStateChange={setBudgetState}
              />
            ) : transferOpen && selectedAccount && routeView === "transfer" ? (
              <TransferWorkspace
                accounts={saved.accounts}
                initialAccount={selectedAccount}
                onBack={() => { setTransferOpen(false); backTo("account", selectedAccount.id); }}
                onTransfer={(result) => {
                  setSaved((current) => current ? { ...current, accounts: result.accounts } : current);
                  setSelectedAccount(result.ledger.account);
                  setTransactionLedger(result.ledger);
                  setTransactionMode(null);
                  setTransferOpen(false);
                  replaceView("account", result.ledger.account.id);
                }}
              />
            ) : transactionMode && transactionLedger && (routeView === transactionMode || routeView === "transaction-edit") ? (
              <TransactionWorkspace
                mode={transactionMode}
                ledger={transactionLedger}
                activeRoute={routeView}
                activeTransactionId={activeRoute.transactionId}
                onNavigate={(view, accountId, transactionId) => {
                  pushView(view, accountId, undefined, transactionId);
                }}
                onBack={() => { setTransactionMode(null); backTo("account", selectedAccount?.id); }}
                onLedgerChange={(next) => {
                  setTransactionLedger(next);
                  setSelectedAccount(next.account);
                  setSaved((current) => current ? {
                    ...current,
                    accounts: next.accounts,
                  } : current);
                }}
              />
            ) : backupCandidate && routeView === "backup-review" ? (
              <View style={s.form}>
                <Text accessibilityRole="header" nativeID="route-heading" style={s.sectionTitle}>Review backup</Text>
                {button("Back to data management", () => backTo("data-management"), false, "secondary")}
                {backupMessage ? <Text accessibilityRole="status" style={s.success}>{backupMessage}</Text> : null}
                {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
                <Text style={s.label}>{backupCandidate.name}</Text>
                <Text style={s.note}>Exported {new Date(backupCandidate.details.exportedAt).toLocaleString()}</Text>
                <Text style={s.note}>Accounts in backup: {backupCandidate.details.accountCount}</Text>
                <Text style={s.warning}>Replacing this browser&apos;s local data deletes its saved accounts, transactions, transfers, and budgets.</Text>
                {button(saving ? "Exporting…" : "Export current backup", () => void exportBackup(), saving, "secondary")}
                {button(saving ? "Replacing…" : "Replace local data", () => void confirmBackupRestore(), saving)}
                {button("Cancel restore", () => {
                  setBackupCandidate(null);
                  setError("");
                  backTo("data-management");
                }, saving, "secondary")}
              </View>
            ) : dataManagementOpen ? (
              <View style={s.dataManagement}>
                <Text accessibilityRole="header" nativeID="route-heading" style={s.sectionTitle}>Data management</Text>
                {button("Back to accounts", () => { setDataManagementOpen(false); backTo("accounts"); }, false, "secondary")}
                {backupMessage ? <Text accessibilityRole="status" style={s.success}>{backupMessage}</Text> : null}
                {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
                <Text style={s.note}>Export a recovery copy or review a backup before it replaces this browser&apos;s local data.</Text>
                {button(saving ? "Exporting…" : "Export backup", () => void exportBackup(), saving)}
                {button(saving ? "Checking…" : "Restore backup", chooseBackupFile, saving, "secondary")}
                {saved.accounts.map((item) => (
                  <Text key={item.id} style={s.note}>{item.name}: {formatMoney(item.balance_minor, item.currency_code)}</Text>
                ))}
              </View>
            ) : troubleshootingOpen ? (
              <View style={s.form}>
                <Text accessibilityRole="header" nativeID="route-heading" style={s.sectionTitle}>Database troubleshooting</Text>
                {button("Back to accounts", () => { setTroubleshootingOpen(false); backTo("accounts"); }, false, "secondary")}
                <Text style={s.note}>Close the local database to release its storage lock. Kuwi will reopen it when you retry.</Text>
                {button("Close database", () => void close(), false, "secondary")}
              </View>
            ) : accountForm && ["new-account", "edit-account"].includes(routeView) ? (
              <View style={s.form}>
                <Text accessibilityRole="header" nativeID="route-heading" style={s.sectionTitle}>
                  {accountForm.mode === "create" ? "New account" : "Edit account"}
                </Text>
                {button(
                  accountForm.mode === "edit" ? "Back to account" : "Back to accounts",
                  () => backTo(accountForm.mode === "edit" ? "account" : "accounts", accountForm.mode === "edit" ? selectedAccount?.id : undefined),
                  false,
                  "secondary",
                )}
                <Text style={s.label}>Account name</Text>
                <TextInput
                  accessibilityLabel="Account name"
                  accessibilityHint={accountFieldError?.field === "name" ? accountFieldError.message : undefined}
                  value={accountName}
                  onChangeText={(value) => { setAccountName(value); if (accountFieldError?.field === "name") setAccountFieldError(null); }}
                  style={s.input}
                />
                {accountFieldError?.field === "name" ? <Text accessibilityRole="alert" style={s.error}>{accountFieldError.message}</Text> : null}
                {accountForm.mode === "create" ? (
                  <>
                    <Text style={s.label}>Account type</Text>
                    <View style={s.typeOptions}>
                      {(["debit", "assets", "credit"] as const).map((type) => (
                        <Pressable
                          key={type}
                          accessibilityRole="radio"
                          aria-checked={accountType === type}
                          accessibilityState={{ checked: accountType === type }}
                          accessibilityLabel={type === "assets" ? "Assets" : type === "credit" ? "Credit" : "Debit"}
                          onPress={() => {
                            setAccountFieldError(null);
                            setAccountType(type);
                            setAccountBalance("0");
                            setCreditOwedEnabled(false);
                          }}
                          style={[s.typeOption, accountType === type && s.typeSelected]}
                        >
                          <Text style={s.label}>{type === "assets" ? "Assets" : type === "credit" ? "Credit" : "Debit"}{accountType === type ? "  ✓" : ""}</Text>
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
                      aria-selected={accountCurrency === code}
                      accessibilityLabel={`${code} ${label}`}
                      accessibilityState={{ selected: accountCurrency === code }}
                      disabled={accountForm.mode === "edit" && Boolean(accountForm.account.has_activity)}
                      onPress={() => {
                        setAccountFieldError(null);
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
                      <Text style={s.label}>{code}{accountCurrency === code ? "  ✓" : ""}</Text>
                    </Pressable>
                  ))}
                </View>
                {accountType === "credit" ? (
                  <>
                    <Text style={s.label}>Credit limit ({accountCurrency})</Text>
                    <TextInput
                      accessibilityLabel={`Credit limit (${accountCurrency})`}
                      accessibilityHint={accountFieldError?.field === "limit" ? accountFieldError.message : undefined}
                      value={creditLimit}
                      onChangeText={(value) => { setCreditLimit(cleanAmountInput(value, accountCurrency)); if (accountFieldError?.field === "limit") setAccountFieldError(null); }}
                      keyboardType="decimal-pad"
                      style={s.input}
                    />
                    {accountFieldError?.field === "limit" ? <Text accessibilityRole="alert" style={s.error}>{accountFieldError.message}</Text> : null}
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
                              accessibilityHint={accountFieldError?.field === "balance" ? accountFieldError.message : undefined}
                              value={accountBalance}
                              onChangeText={(value) => { setAccountBalance(cleanAmountInput(value, accountCurrency)); if (accountFieldError?.field === "balance") setAccountFieldError(null); }}
                              keyboardType="decimal-pad"
                              style={s.input}
                            />
                            {accountFieldError?.field === "balance" ? <Text accessibilityRole="alert" style={s.error}>{accountFieldError.message}</Text> : null}
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
                      accessibilityHint={accountFieldError?.field === "balance" ? accountFieldError.message : undefined}
                      value={accountBalance}
                      onChangeText={(value) => { setAccountBalance(cleanAmountInput(value, accountCurrency)); if (accountFieldError?.field === "balance") setAccountFieldError(null); }}
                      keyboardType="decimal-pad"
                      editable={accountForm.mode === "create" || !accountForm.account.has_activity}
                      style={[s.input, accountForm.mode === "edit" && Boolean(accountForm.account.has_activity) && s.lockedInput]}
                    />
                    {accountFieldError?.field === "balance" ? <Text accessibilityRole="alert" style={s.error}>{accountFieldError.message}</Text> : null}
                  </>
                )}
                {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
                {button(
                  saving ? "Saving…" : accountForm.mode === "create" ? "Save account" : "Save changes",
                  () => void saveAccount(),
                  saving,
                )}
                {button("Cancel", () => {
                  const returnToAccount = accountForm.mode === "edit";
                  setAccountForm(null);
                  setError("");
                  setAccountFieldError(null);
                  setOperation(null);
                  backTo(returnToAccount ? "account" : "accounts", returnToAccount ? selectedAccount?.id : undefined);
                }, saving, "secondary")}
              </View>
            ) : selectedAccount ? (
              <View style={s.accountDetails}>
                <Text accessibilityRole="header" nativeID="route-heading" style={s.sectionTitle}>
                  {selectedAccount.name}
                </Text>
                {button("Back to accounts", () => { setSelectedAccount(null); backTo("accounts"); }, false, "secondary")}
                {backupMessage ? <Text accessibilityRole="status" style={s.success}>{backupMessage}</Text> : null}
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
                  ? button("Add income", () => void openTransactionWorkspace("income"), false, "secondary")
                  : null}
                {selectedAccount.type !== "assets"
                  ? button("Transfer between accounts", () => { setTransferOpen(true); pushView("transfer", selectedAccount.id); }, false, "secondary")
                  : null}
                {button("Transaction history", () => void openTransactionWorkspace("history"), false, "secondary")}
                {button("Edit account details", () => editAccount(selectedAccount), false, "secondary")}
              </View>
            ) : (
              <View style={s.accounts}>
                <Text accessibilityRole="header" nativeID="route-heading" style={s.sectionTitle}>Your accounts</Text>
                {backupMessage ? <Text accessibilityRole="status" style={s.success}>{backupMessage}</Text> : null}
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
                      onPress={() => { setSelectedAccount(account); pushView("account", account.id); }}
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
                {button("Data management", () => { setDataManagementOpen(true); pushView("data-management"); }, false, "secondary")}
                {button("Database troubleshooting", () => { setTroubleshootingOpen(true); pushView("troubleshooting"); }, false, "secondary")}
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
                    aria-selected={currency === code}
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
    backgroundColor: "color-mix(in srgb, var(--kuwi-ink) 40%, transparent)",
  },
  calculator: {
    backgroundColor: cream,
    padding: 24,
    paddingBottom: "max(24px, env(safe-area-inset-bottom))",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    gap: 20,
  },
  keys: { flexDirection: "row", flexWrap: "wrap" },
  key: { width: "33.33%", padding: 16, alignItems: "center" },
  page: { flexGrow: 1, backgroundColor: cream, paddingHorizontal: 24, paddingTop: "max(24px, env(safe-area-inset-top))", paddingBottom: "max(32px, env(safe-area-inset-bottom))", paddingLeft: "max(24px, env(safe-area-inset-left))", paddingRight: "max(24px, env(safe-area-inset-right))" },
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
  note: { fontSize: 14, lineHeight: 22, color: "var(--kuwi-secondary-text)" },
  mascotHint: {
    textAlign: "center",
    color: "var(--kuwi-secondary-text)",
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
    borderColor: "var(--kuwi-border)",
    borderRadius: 14,
    fontSize: 18,
    color: ink,
    backgroundColor: "var(--kuwi-surface)",
  },
  button: {
    padding: 18,
    borderRadius: 14,
    backgroundColor: sage,
    alignItems: "center",
  },
  buttonText: { color: "#ffffff", fontSize: 17, fontWeight: "600" },
  secondaryButton: { padding: 14, borderRadius: 14, borderWidth: 1, borderColor: sage, backgroundColor: "var(--kuwi-surface)", alignItems: "center" },
  secondaryButtonText: { color: ink, fontSize: 16, fontWeight: "600" },
  disabled: { opacity: 0.5 },
  error: {
    backgroundColor: "var(--kuwi-error-bg)",
    color: "var(--kuwi-error-fg)",
    padding: 16,
    marginBottom: 20,
    borderRadius: 12,
  },
  warning: { color: "var(--kuwi-warning-fg)", padding: 14, borderRadius: 12, backgroundColor: "var(--kuwi-warning-bg)", lineHeight: 22 },
  success: { color: "var(--kuwi-success-fg)", padding: 12, borderRadius: 10, backgroundColor: "var(--kuwi-selected)" },
  account: {
    backgroundColor: "var(--kuwi-selected)",
    padding: 18,
    borderRadius: 14,
    gap: 12,
  },
  accounts: { gap: 16 },
  dataManagement: { gap: 14 },
  form: { gap: 14 },
  accountDetails: { gap: 12 },
  sectionTitle: { fontSize: 24, lineHeight: 30, fontWeight: "700", color: ink },
  accountHeading: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  accountCopy: { flex: 1, gap: 5 },
  accountBalance: { maxWidth: "100%", flexShrink: 1, fontSize: 19, fontWeight: "700", color: ink, fontVariant: ["tabular-nums"] },
  editButton: { alignSelf: "flex-start", paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "var(--kuwi-page)" },
  editButtonText: { color: accentText, fontSize: 14, fontWeight: "700" },
  typeOptions: { flexDirection: "row", gap: 8 },
  typeOption: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: "var(--kuwi-border)", backgroundColor: "var(--kuwi-surface)" },
  typeSelected: { borderColor: sage, borderWidth: 2, backgroundColor: "var(--kuwi-selected)" },
  currencyOptions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  currencyOption: { minWidth: 54, alignItems: "center", paddingVertical: 10, paddingHorizontal: 12, borderRadius: 11, borderWidth: 1, borderColor: "var(--kuwi-border)", backgroundColor: "var(--kuwi-surface)" },
  lockedInput: { opacity: 0.65, backgroundColor: "var(--kuwi-selected)" },
  balance: { fontSize: 36, fontWeight: "600", color: ink },
});
