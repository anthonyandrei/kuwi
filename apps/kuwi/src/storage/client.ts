export type Account = {
  id: string;
  name: string;
  type: "debit" | "assets" | "credit";
  currency_code: string;
  credit_limit_minor: number | null;
  balance_minor: number;
  has_activity: number;
  decimal_places: number;
};

export type Setup = {
  preferred_name: string;
  preferred_currency: string;
  account_id: string;
  account_name: string;
  currency_code: string;
  opening_balance_minor: number;
  accounts: Account[];
};

export type ExpenseCategory = { id: string; label: string };
export type IncomeCategory = { id: string; label: string };
export type TransactionRecord = {
  kind: "expense" | "income";
  id: string;
  account_id: string;
  category_id: string | null;
  category_label: string | null;
  amount_minor: number;
  date: string;
  note: string | null;
  created_at: string;
  planned: number;
  planned_amount_minor: number | null;
  transfer_id: string | null;
};
export type TransactionLedger = {
  account: Account;
  accounts: Account[];
  expense_categories: ExpenseCategory[];
  income_categories: IncomeCategory[];
  transactions: TransactionRecord[];
  transfers: TransferRecord[];
};
export type DashboardTransaction = TransactionRecord & {
  account_name: string;
  currency_code: string;
  decimal_places: number;
};
export type DashboardTransfer = {
  id: string;
  from_account_id: string;
  from_account_name: string;
  to_account_id: string;
  to_account_name: string;
  amount_minor: number;
  received_amount_minor: number;
  exchange_rate: string;
  from_currency_code: string;
  from_decimal_places: number;
  to_currency_code: string;
  to_decimal_places: number;
  date: string;
  note: string | null;
  created_at: string;
  fee_amount_minor: number;
};
export type HomeDashboard = {
  preferred_name: string;
  preferred_currency: string;
  monthly_cycle_start_day: number;
  accounts: Account[];
  expense_categories: ExpenseCategory[];
  income_categories: IncomeCategory[];
  transactions: DashboardTransaction[];
  transfers: DashboardTransfer[];
};
export type TransferRecord = {
  id: string;
  operation_id: string;
  from_account_id: string;
  from_account_name: string;
  to_account_id: string;
  to_account_name: string;
  amount_minor: number;
  received_amount_minor: number;
  exchange_rate: string;
  from_currency_code: string;
  from_decimal_places: number;
  to_currency_code: string;
  to_decimal_places: number;
  date: string;
  note: string | null;
  created_at: string;
  fee_expense_id: string | null;
  fee_amount_minor: number;
  direction: "incoming" | "outgoing";
};
export type BudgetProgress = {
  period: { start: string; end: string };
  available: boolean;
  missingCurrencies: string[];
  limit: number | null;
  spent: number | null;
  remaining: number | null;
  progressPercent: number | null;
  incomeBase: number | null;
};
export type BudgetSummary = Omit<BudgetProgress, "period" | "incomeBase">;
export type BudgetRecord = BudgetProgress & {
  category_id: string;
  category_label: string;
  amount_milli: number;
  type: "fixed" | "percentage";
  percentage_basis_points: number | null;
  interval: "daily" | "weekly" | "bi-weekly" | "monthly" | "annually";
  rollover_enabled: number;
  rollover_started_at: string | null;
  biweekly_start_date: string | null;
  biweekly_end_date: string | null;
};
export type BudgetState = {
  preferredCurrency: string | null;
  monthlyCycleStartDay: number;
  categories: ExpenseCategory[];
  budgets: BudgetRecord[];
  summary: BudgetSummary | null;
};
export type SaveBudgetInput = {
  operationId: string;
  categoryId: string;
  type: "fixed" | "percentage";
  amountMilli: number;
  percentageBasisPoints: number | null;
  interval: BudgetRecord["interval"];
  rolloverEnabled: boolean;
  biweeklyStartDate?: string;
  biweeklyEndDate?: string;
};
export type SaveBudgetResult = { state: BudgetState; replayed: boolean };
export type CreateExpenseInput = {
  operationId: string;
  accountId: string;
  categoryId: string;
  amountMinor: number;
  date: string;
  planned?: boolean;
  note?: string;
};
export type CreateIncomeInput = {
  operationId: string;
  accountId: string;
  categoryId?: string;
  amountMinor: number;
  date: string;
  planned?: boolean;
  note?: string;
};
export type CreateTransferInput = {
  operationId: string;
  fromAccountId: string;
  toAccountId: string;
  amountMinor: number;
  receivedAmountMinor: number;
  exchangeRate: string;
  feeMinor: number;
  date: string;
  note?: string;
};
export type UpdateTransactionInput = {
  operationId: string;
  transactionId: string;
  kind: TransactionRecord["kind"];
  operationType?: "edit" | "log";
  currentAccountId: string;
  accountId: string;
  categoryId?: string;
  amountMinor: number;
  date: string;
  note?: string;
};
export type DeleteTransactionInput = {
  operationId: string;
  transactionId: string;
  kind: TransactionRecord["kind"];
  currentAccountId: string;
};
export type CreateTransactionResult = {
  ledger: TransactionLedger;
  replayed: boolean;
};
export type CreateExpenseResult = { ledger: TransactionLedger; replayed: boolean };
export type CreateTransferResult = {
  accounts: Account[];
  ledger: TransactionLedger;
  replayed: boolean;
};
export type BackupCurrency = { code: string; decimal_places: number };
export type BackupProfile = {
  id: string;
  preferred_name: string;
  preferred_currency: string;
  monthly_cycle_start_day: number;
};
export type BackupAccount = {
  id: string;
  name: string;
  type: Account["type"];
  currency_code: string;
  credit_limit_minor: number | null;
  created_at: string;
};
export type BackupAccountAdjustment = {
  id: string;
  account_id: string;
  amount_minor: number;
  adjustment_type: "initial";
  created_at: string;
};
export type BackupSetup = {
  id: 1;
  profile_id: string;
  first_account_id: string;
  completed_at: string;
};
export type BackupPendingAccountOperation = {
  id: string;
  account_id: string;
  operation_type: "account.create" | "account.update";
  request_fingerprint: string;
  created_at: string;
};
export type BackupCategory = { id: string; label: string; sort_order: number };
export type BackupExpense = {
  id: string;
  account_id: string;
  category_id: string;
  amount_minor: number;
  date: string;
  note: string | null;
  created_at: string;
  transfer_id: string | null;
  planned: number;
  planned_amount_minor: number | null;
};
export type BackupTransfer = {
  id: string;
  from_account_id: string;
  to_account_id: string;
  amount_minor: number;
  received_amount_minor: number;
  exchange_rate: string;
  fee_amount_minor: number;
  date: string;
  note: string | null;
  created_at: string;
};
export type BackupPendingSyncOperation = { operation_id: string; request_fingerprint: string | null };
export type BackupPendingTransferOperation = { operation_id: string; request_fingerprint: string };
export type BackupIncomeCategory = { id: string; label: string; sort_order: number };
export type BackupIncome = {
  id: string;
  account_id: string;
  category_id: string | null;
  amount_minor: number;
  date: string;
  note: string | null;
  planned: number;
  planned_amount_minor: number | null;
  created_at: string;
};
export type BackupPendingIncomeSyncOperation = { operation_id: string; request_fingerprint: string | null };
export type BackupPendingTransactionOperation = {
  operation_id: string;
  transaction_kind: TransactionRecord["kind"];
  transaction_id: string;
  operation_type: "edit" | "delete" | "log";
  request_fingerprint: string;
  created_at: string;
};
export type BackupBudget = {
  category_id: string;
  amount_milli: number;
  type: "fixed" | "percentage";
  percentage_basis_points: number | null;
  interval: BudgetRecord["interval"];
  rollover_enabled: number;
  rollover_started_at: string | null;
  biweekly_start_date: string | null;
  biweekly_end_date: string | null;
};
export type BackupPendingBudgetOperation = {
  operation_id: string;
  category_id: string;
  operation_type: "save" | "clear";
  request_fingerprint: string;
  created_at: string;
};
export type ProductBackupData = {
  currencies: BackupCurrency[];
  profiles: BackupProfile[];
  accounts: BackupAccount[];
  accountAdjustments: BackupAccountAdjustment[];
  setup: BackupSetup[];
  pendingOperations: BackupPendingAccountOperation[];
  categories: BackupCategory[];
  expenses: BackupExpense[];
  transfers: BackupTransfer[];
  pendingSyncOperations: BackupPendingSyncOperation[];
  pendingTransferOperations: BackupPendingTransferOperation[];
  incomeCategories: BackupIncomeCategory[];
  incomes: BackupIncome[];
  pendingIncomeSyncOperations: BackupPendingIncomeSyncOperation[];
  pendingTransactionOperations: BackupPendingTransactionOperation[];
  budgets: BackupBudget[];
  pendingBudgetOperations: BackupPendingBudgetOperation[];
};
export type ProductBackup = {
  format: "kuwi.backup";
  version: 1;
  schemaVersion: 10;
  exportedAt: string;
  integrity: { algorithm: "SHA-256"; digest: string };
  data: ProductBackupData;
};
export type BackupReview = { exportedAt: string; accountCount: number };

export type DatabaseResult =
  | Setup
  | Account[]
  | Account
  | TransactionLedger
  | HomeDashboard
  | CreateTransactionResult
  | CreateExpenseResult
  | CreateTransferResult
  | BudgetState
  | SaveBudgetResult
  | ProductBackup
  | BackupReview
  | null;
type DatabaseCommand =
  | "state"
  | "accounts"
  | "account.create"
  | "account.update"
  | "complete"
  | "ledger"
  | "dashboard"
  | "createExpense"
  | "createIncome"
  | "createTransfer"
  | "updateTransaction"
  | "deleteTransaction"
  | "budgetState"
  | "saveBudget"
  | "saveMonthlyCycleStartDay"
  | "exportBackup"
  | "inspectBackup"
  | "restoreBackup"
  | "close";
const writeTimeoutMessages: Partial<Record<DatabaseCommand, string>> = {
  complete: "Save confirmation timed out. Retry account setup to check whether it was saved.",
  "account.create": "Save confirmation timed out. Retry the account change to check whether it was saved.",
  "account.update": "Save confirmation timed out. Retry the account change to check whether it was saved.",
  createExpense: "Save confirmation timed out. Retry to check whether your expense was saved.",
  createIncome: "Save confirmation timed out. Retry to check whether your income was saved.",
  createTransfer: "Save confirmation timed out. Retry to check whether your transfer was saved.",
  updateTransaction: "Save confirmation timed out. Reopen transaction history before retrying this change.",
  deleteTransaction: "Save confirmation timed out. Reopen transaction history before retrying this change.",
  saveBudget: "Save confirmation timed out. Retry the budget change to check whether it was saved.",
  saveMonthlyCycleStartDay: "Saving the monthly cycle setting timed out. Retry to check whether it was saved.",
  restoreBackup: "Restore confirmation timed out. Reopen your saved data before retrying the backup.",
};

let worker: Worker | undefined;
let sequence = 0;
const pending = new Map<
  number,
  {
    resolve: (value: DatabaseResult) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

/**
 * Stop the current worker and reject every pending request with the supplied error.
 * @param error - Failure to report to all calls waiting on this worker.
 */
function stopWorker(error: Error) {
  worker?.terminate();
  worker = undefined;
  for (const call of pending.values()) {
    clearTimeout(call.timer);
    call.reject(error);
  }
  pending.clear();
}

/**
 * Send a worker command and surface its result or failure to the caller.
 * Writes time out after 15 seconds so the caller can retry with its stable operation ID;
 * reads wait up to 60 seconds for OPFS initialization.
 * @param command - A supported setup, account, ledger, transaction, transfer, budget, backup, or close command.
 * @param args - Command-specific values sent to the dedicated database worker.
 * @returns The typed command result; the promise rejects on worker errors or timeout.
 */
export function database<T extends DatabaseResult = DatabaseResult>(
  command: DatabaseCommand,
  args: object = {},
): Promise<T> {
  if (!worker) {
    worker = new Worker("/db-worker.js", { type: "module" });
    worker.onmessage = ({ data }) => {
      const call = pending.get(data.id);
      pending.delete(data.id);
      if (call) clearTimeout(call.timer);
      if (data.error) call?.reject(Error(data.error));
      else call?.resolve(data.result);
    };
    worker.onerror = () =>
      stopWorker(Error("Database worker failed. Retry to reopen existing storage."));
  }
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const isWrite = command === "complete" || command === "createExpense" || command === "createIncome" || command === "createTransfer" || command === "updateTransaction" || command === "deleteTransaction" || command === "saveBudget" || command === "saveMonthlyCycleStartDay" || command === "restoreBackup" || command.startsWith("account.");
    const timer = setTimeout(
      () =>
        stopWorker(
          Error(
            isWrite
              ? writeTimeoutMessages[command] ?? "Save confirmation timed out. Retry the change to check whether it was saved."
              : "Opening local storage timed out. Retry to reopen existing storage.",
          ),
        ),
      isWrite ? 15000 : 60000,
    );
    pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
    worker!.postMessage({ id, command, args });
  });
}

/**
 * Close the database before releasing ownership for another tab.
 * @returns A promise that resolves after ownership is released; a close failure rejects it.
 */
export async function closeDatabase() {
  if (worker) {
    try {
      await database("close");
    } finally {
      stopWorker(Error("Database closed before the operation finished."));
    }
  }
}
