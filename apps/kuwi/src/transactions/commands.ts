import {
  database,
  type CreateIncomeInput,
  type CreateTransactionResult,
  type CreateExpenseInput,
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
