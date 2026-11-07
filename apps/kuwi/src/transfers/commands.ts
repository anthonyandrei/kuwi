import {
  database,
  type CreateTransferInput,
  type CreateTransferResult,
} from "../storage/client";

/** Commit a transfer, optional linked fee expense, and retry record together.
 * @param input - Stable operation ID, eligible accounts, minor-unit values, date, and optional note.
 * @returns Refreshed account balances and the source ledger.
 * @throws Rejects when validation, persistence, available funds, or retry checks fail.
 */
export function saveTransfer(input: CreateTransferInput): Promise<CreateTransferResult> {
  return database<CreateTransferResult>("createTransfer", input);
}
