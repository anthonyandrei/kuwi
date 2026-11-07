import {
  database,
  type CreateExpenseInput,
  type CreateExpenseResult,
} from "../storage/client";

/**
 * Commit an expense and its pending sync marker in one worker transaction.
 * @param input - Stable operation ID, account/category IDs, amount in minor units, date, and optional note.
 * @returns The refreshed account ledger and whether the operation was replayed.
 * @throws Rejects when validation, persistence, or stable-retry checks fail.
 */
export function saveExpense(input: CreateExpenseInput): Promise<CreateExpenseResult> {
  return database<CreateExpenseResult>("createExpense", input);
}
