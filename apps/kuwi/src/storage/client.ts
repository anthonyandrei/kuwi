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
export type ExpenseRecord = {
  id: string;
  operation_id: string;
  account_id: string;
  category_id: string;
  category_label: string;
  amount_minor: number;
  date: string;
  note: string | null;
  created_at: string;
};
export type ExpenseLedger = {
  account: Account;
  categories: ExpenseCategory[];
  expenses: ExpenseRecord[];
};
export type CreateExpenseInput = {
  operationId: string;
  accountId: string;
  categoryId: string;
  amountMinor: number;
  date: string;
  note?: string;
};
export type CreateExpenseResult = { ledger: ExpenseLedger; replayed: boolean };

export type DatabaseResult =
  | Setup
  | Account[]
  | Account
  | ExpenseLedger
  | CreateExpenseResult
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
 * Send one serialized database command and surface worker failures to the caller.
 * Writes time out after 15 seconds so the UI can offer the same operation ID for retry;
 * reads wait up to 60 seconds for OPFS initialization.
 * @param command - A supported worker command.
 * @param args - Command-specific values passed to the dedicated worker.
 * @returns The command result, or a rejected promise when the worker reports or encounters an error.
 */
export function database<T extends DatabaseResult = DatabaseResult>(
  command: "state" | "accounts" | "account.create" | "account.update" | "complete" | "ledger" | "createExpense" | "close",
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
    const isWrite = command === "complete" || command === "createExpense" || command.startsWith("account.");
    const timer = setTimeout(
      () =>
        stopWorker(
          Error(
            isWrite
              ? command === "createExpense"
                ? "Save confirmation timed out. Retry to check whether your expense was saved."
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
 * Any call still waiting when the worker stops rejects with a close error.
 * @returns A promise that resolves after the worker releases database ownership.
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
