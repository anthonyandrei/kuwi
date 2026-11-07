import {
  database,
  type CreateExpenseInput,
  type CreateExpenseResult,
} from "../storage/client";

/** Commit one expense and its pending sync operation through the worker transaction. */
export function saveExpense(input: CreateExpenseInput): Promise<CreateExpenseResult> {
  return database<CreateExpenseResult>("createExpense", input);
}
