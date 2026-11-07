export type Account = {
  id: string;
  name: string;
  type: "debit" | "assets" | "credit";
  currency_code: string;
  credit_limit_minor: number | null;
  balance_minor: number;
  has_activity: number;
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

export type DatabaseResult = Setup | Account[] | Account | null;

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
 * Terminate the worker and reject every unfinished call.
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
 */
export function database(
  command: "state" | "accounts" | "account.create" | "account.update" | "complete" | "close",
  args: object = {},
): Promise<DatabaseResult> {
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
    const isWrite = command === "complete" || command.startsWith("account.");
    const timer = setTimeout(
      () =>
        stopWorker(
          Error(
            isWrite
              ? "Save confirmation timed out. Retry the account change to check whether it was saved."
              : "Opening local storage timed out. Retry to reopen existing storage.",
          ),
        ),
      isWrite ? 15000 : 60000,
    );
    pending.set(id, { resolve, reject, timer });
    worker!.postMessage({ id, command, args });
  });
}

/**
 * Close the database before releasing ownership for another tab.
 * Any call still waiting when the worker stops rejects with a close error.
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
