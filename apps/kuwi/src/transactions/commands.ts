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
 * @param input - Stable operation ID, account/category IDs, positive minor units, date,
 *   captured planned intent for retries across a due date, and optional note.
 * @returns The refreshed account ledger and whether the operation was replayed.
 * @throws Rejects when validation, persistence, or stable-retry checks fail.
 */
export function saveExpense(input: CreateExpenseInput): Promise<CreateTransactionResult> {
  return database<CreateTransactionResult>("createExpense", input);
}

/**
 * Commit an income and its pending sync marker in one worker transaction.
 * @param input - Stable operation ID, account ID, optional category, nonnegative minor units, date,
 *   captured planned intent for retries across a due date, and optional note.
 * @returns The refreshed account ledger and whether the operation was replayed.
 * @throws Rejects when validation, persistence, or stable-retry checks fail.
 */
export function saveIncome(input: CreateIncomeInput): Promise<CreateTransactionResult> {
  return database<CreateTransactionResult>("createIncome", input);
}

/** Edit or explicitly log a saved transaction with its stable receipt in one worker transaction.
 * @param input - Transaction identity and either replacement details or log type and actual amount.
 *   Replacement accounts must use the original currency; expense logging uses its saved amount,
 *   and income logging requires a positive actual amount.
 * @returns The refreshed ledger and whether the worker replayed an earlier operation.
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
