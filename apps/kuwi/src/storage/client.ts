export type Setup = {
  preferred_name: string;
  preferred_currency: string;
  account_id: string;
  account_name: string;
  currency_code: string;
  opening_balance_minor: number;
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
export type Ledger = {
  account: Setup & { balance_minor: number; decimal_places: number };
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
export type CreateExpenseResult = { ledger: Ledger; replayed: boolean };
let worker: Worker | undefined;
let sequence = 0;
const pending = new Map<
  number,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
/** Terminate the owned worker and reject every unfinished call, clearing its timer. */
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
 * Send a serialized storage operation. Reject with the worker's storage or validation error.
 * @param command - Internal state, complete, or close operation.
 * @param args - Completion fields when saving setup; omitted for reads and close.
 * @returns Saved setup, or null before setup and after close.
 * A missing reply terminates the worker after 15 seconds for saves or 60 seconds otherwise.
 * The module owns the worker; callers surface failures. Timed-out calls retry with a fresh worker.
 */
export function database<T = Setup | null>(
  command: string,
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
      stopWorker(
        Error("Database worker failed. Retry to reopen existing storage."),
      );
  }
  return new Promise<T>((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(
      () =>
        stopWorker(
          Error(
            command === "complete"
              ? "Save confirmation timed out. Retry saving to check whether your setup was saved."
              : command === "createExpense"
                ? "Save confirmation timed out. Retry to check whether your expense was saved."
              : "Opening local storage timed out. Retry to reopen existing storage.",
          ),
        ),
      command === "complete" || command === "createExpense" ? 15000 : 60000,
    );
    pending.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
      timer,
    });
    worker!.postMessage({ id, command, args });
  });
}
/** Close files and release ownership before allowing a new worker to retry startup. */
export async function closeDatabase() {
  if (worker) {
    try {
      await database("close");
    } finally {
      stopWorker(Error("Database closed before the operation finished."));
    }
  }
}
