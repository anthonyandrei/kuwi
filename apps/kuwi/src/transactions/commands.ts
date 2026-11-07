import {
  database,
  type CreateIncomeInput,
  type CreateTransactionResult,
  type CreateExpenseInput,
  type UpdateTransactionInput,
  type DeleteTransactionInput,
} from "../storage/client";

/**
 * Commit an expense and its pending sync marker in one worker transaction.
 * @param input - Stable operation ID, account/category IDs, amount in minor units, date, and optional note.
 * @returns The refreshed account ledger and whether the operation was replayed.
 * @throws Rejects when validation, persistence, or stable-retry checks fail.
 */
export function saveExpense(input: CreateExpenseInput): Promise<CreateTransactionResult> {
  return database<CreateTransactionResult>("createExpense", input);
}

/**
 * Commit an income and its pending sync marker in one worker transaction.
 * @param input - Stable operation ID, account ID, optional category, amount in minor units, date, and optional note.
 * @returns The refreshed account ledger and whether the operation was replayed.
 * @throws Rejects when validation, persistence, or stable-retry checks fail.
 */
export function saveIncome(input: CreateIncomeInput): Promise<CreateTransactionResult> {
  return database<CreateTransactionResult>("createIncome", input);
}

/** Replace a saved transaction with its stable retry receipt in one worker transaction.
 * @param input - Transaction identity and replacement account, category, amount in minor units,
 *   date, and optional note.
 * @returns The refreshed ledger and whether the worker replayed an earlier edit.
 * @throws Rejects when validation, persistence, or stable-retry checks fail.
 */
export function updateTransaction(input: UpdateTransactionInput): Promise<CreateTransactionResult> {
  return database<CreateTransactionResult>("updateTransaction", input);
}

/** Delete a saved transaction and write its retry tombstone in one worker transaction.
 * @param input - Stable operation ID, transaction identity and kind, and current account ID.
 * @returns The refreshed ledger and whether the worker replayed an earlier delete.
 * @throws Rejects when the target is unavailable, persistence fails, or the retry conflicts.
 */
export function deleteTransaction(input: DeleteTransactionInput): Promise<CreateTransactionResult> {
  return database<CreateTransactionResult>("deleteTransaction", input);
}
