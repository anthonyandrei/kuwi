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
};
export type TransactionLedger = {
  account: Account;
  expense_categories: ExpenseCategory[];
  income_categories: IncomeCategory[];
  transactions: TransactionRecord[];
};
export type CreateExpenseInput = {
  operationId: string;
  accountId: string;
  categoryId: string;
  amountMinor: number;
  date: string;
  note?: string;
};
export type CreateIncomeInput = {
  operationId: string;
  accountId: string;
  categoryId?: string;
  amountMinor: number;
  date: string;
  note?: string;
};
export type CreateTransactionResult = {
  ledger: TransactionLedger;
  replayed: boolean;
};

export type DatabaseResult =
  | Setup
  | Account[]
  | Account
  | TransactionLedger
  | CreateTransactionResult
  | null;

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
 * Writes time out after 15 seconds so callers can retry with the same operation ID;
 * reads wait up to 60 seconds for OPFS initialization.
 * @param command - A supported setup, account, ledger, transaction, or close command.
 * @param args - Command-specific values sent to the dedicated database worker.
 * @returns The typed command result; the promise rejects on worker errors or timeout.
 */
export function database<T extends DatabaseResult = DatabaseResult>(
  command: "state" | "accounts" | "account.create" | "account.update" | "complete" | "ledger" | "createExpense" | "createIncome" | "close",
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
    const isWrite = command === "complete" || command === "createExpense" || command === "createIncome" || command.startsWith("account.");
    const timer = setTimeout(
      () =>
        stopWorker(
          Error(
            isWrite
              ? command === "createExpense"
                ? "Save confirmation timed out. Retry to check whether your expense was saved."
                : command === "createIncome"
                  ? "Save confirmation timed out. Retry to check whether your income was saved."
                  : "Save confirmation timed out. Retry the account change to check whether it was saved."
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
