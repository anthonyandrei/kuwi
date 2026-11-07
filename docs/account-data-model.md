# Account data model

Updated: 2026-11-08

This document records the local SQLite model and the account behavior currently
implemented in `apps/kuwi`. It is the review point for later account and finance
work.

## Reference basis and limits

Account actions and the web drawer were inspected in recovered Tarsi web code.
The source files and source/extract hashes are listed in
[`tarsi-reverse-engineering.md`](tarsi-reverse-engineering.md). The checks for
this implementation are summarized in
[`tarsi-behavior-reference.md`](tarsi-behavior-reference.md#account-creation-and-editing).
That evidence establishes code paths, not runtime behavior or iPhone 2.5.9
parity. iPhone acceptance remains pending.

The current Kuwi form supports Debit, Assets, and Credit. Loans need their
verified payment schedule rules before they can be represented safely. Stocks
and Crypto are gated on Tarsi investment access, whose Pro behavior is outside
this local stage. Kuwi account currency choices use the six currencies already
supported by onboarding: PHP, USD, EUR, GBP, JPY, and TWD. This is an app
boundary, not a claim about Tarsi's unverified account-currency picker.

The account form trims names and rejects blank values. New accounts default to
the profile's preferred currency and a zero balance. Debit and Assets balances
use the account currency's integer minor units. Credit stores its limit
separately from the amount owed. For currencies available here, JPY has zero
decimal places and the other five have two. Amount entry removes nonnumeric
characters and limits the fractional part to the currency precision, matching
the recovered formatter behavior.

Positive starting balances become initial adjustment rows. A zero opening
balance has no adjustment row. When an account has an adjustment, expense,
income, or transfer, its starting balance and currency cannot be changed in the
account editor; the name remains editable. Credit limit changes remain
editable. Expenses reduce Debit and Assets balances and increase the amount
owed on Credit accounts. Income adds to Debit and Assets balances and reduces
the amount owed on Credit accounts. Kuwi currently accepts income on Debit and
Credit accounts; the recovered income form does not offer Assets accounts.

## Relations and dependencies

| Relation | Primary key | Stored facts and references |
| --- | --- | --- |
| `currencies` | `code` | `decimal_places` for each supported currency. |
| `profiles` | `id` | `preferred_name`, `preferred_currency` → `currencies.code`. |
| `accounts` | `id` | `name`, `type`, `currency_code` → `currencies.code`, optional `credit_limit_minor`, `created_at`. |
| `account_adjustments` | `id` | `account_id` → `accounts.id`, signed `amount_minor`, `adjustment_type`, `created_at`. |
| `setup` | `id` (fixed at 1) | `profile_id` → `profiles.id`, `first_account_id` → `accounts.id`, `completed_at`. |
| `pending_operations` | `id` | `account_id` → `accounts.id`, `operation_type`, SHA-256 `request_fingerprint`, `created_at`. |
| `categories` | `id` | Canonical label and display order for built-in expense categories. |
| `expenses` | `id` | `account_id` → `accounts.id`, `category_id` → `categories.id`, optional `transfer_id` → `transfers.id`, positive minor units, date, optional note, `created_at`. |
| `pending_sync_operations` | `operation_id` | `operation_id` → `expenses.id`; marks an expense creation for local sync. |
| `income_categories` | `id` | Canonical label and display order for built-in income categories. |
| `incomes` | `id` | `account_id` → `accounts.id`, optional `category_id` → `income_categories.id`, nonnegative minor units, date, optional note, planned flag, `created_at`. |
| `pending_income_sync_operations` | `operation_id` | `operation_id` → `incomes.id`; marks an income creation for local sync. |
| `transfers` | `id` | Account references, positive source principal and received amount in their respective minor units, canonical parsed rate, date, optional note, `created_at`. |
| `expenses.transfer_id` | nullable foreign key | `transfer_id` → `transfers.id`; identifies the linked transfer-fee expense. The fee amount and category are stored on the expense. |
| `pending_transfer_operations` | `operation_id` | `operation_id` → `transfers.id`, SHA-256 request fingerprint; marks the transfer for local sync and stable retries. |
| `pending_transaction_operations` | `operation_id` | Transaction kind and ID, edit/delete type, request fingerprint, and creation time. Delete receipts retain IDs after their transaction row is removed. |
| `budgets` | `category_id` | One normalized definition per expense category: fixed amount or percentage basis points, interval, optional rollover tracking, and optional bi-weekly anchor dates. |
| `pending_budget_operations` | `operation_id` | Category ID, save/clear type, SHA-256 request fingerprint, and creation time for stable retries and future local sync. |

The non-key dependencies are `code → decimal_places`, `profile id → preferred
name, preferred currency`, `account id → name, type, currency, credit limit,
creation time`, `adjustment id → account id, amount, kind, creation time`,
`operation id → account id, operation type, request fingerprint, creation
time`, `category id → label, display order`, `expense id → account, category,
optional transfer reference, amount, date, note, creation time`, and
`income id → account, optional category, amount, date, note, planned state,
creation time`. Transaction
operation IDs determine the kind, transaction ID, edit/delete type, fingerprint,
and creation time. This relation has no foreign key because delete receipts must
outlive their transaction rows. `setup.id` identifies one profile and its first
account.

`transfer id → source account, destination account, source principal, received
amount, exchange rate, date, note, and creation time`. Source and destination
currencies and precision come from their account references. A fee is an
expense in the `fees` category whose `transfer_id`
points to the transfer. The transfer does not store a second fee amount. The
backup contract exposes a derived fee amount for compatibility.

`budgets.category_id → amount_milli, type, percentage_basis_points, interval,
rollover_enabled, rollover_started_at, biweekly_start_date, biweekly_end_date`.
`pending_budget_operations.operation_id → category_id, operation_type,
request_fingerprint, created_at`. A percentage budget stores its percentage in
integer hundredths of one percent and a zero amount. A fixed budget stores an
amount in thousandths of the preferred currency unit. Zero-save deletes the
definition and records a clear receipt. Progress is derived from current
expense and income rows; no spending total is stored in the budget relation.

Backups include a derived `fee_amount_minor` field from the linked expense.

Balances combine `account_adjustments`, posted expense and income effects, and
transfer source and received amount effects; the app does not store another
mutable balance on `accounts`. A debit source loses the transfer principal and any linked fee,
while a debit destination receives the separate received amount. A credit
source owes the principal and fee. Transfer fees use the source currency.
Account name and currency are stored once and referenced by ID from linked
facts. Credit limits are account terms, while credit balances come from
adjustment and transaction facts.

Budgets cover all accounts. The calculator selects ordinary expenses by
category and inclusive period, then derives fixed or income-based limits and
progress. Transfer principal lives only in `transfers` and is excluded. A
positive transfer fee is the linked `fees` expense, so it contributes once.
Percentage bases include actual incomes across accounts and categories, with
planned income excluded. Kuwi has no FX quote source; a qualifying entry in a
different currency makes progress unavailable until quotes exist.

## Write and retry contract

`account.create`, `account.update`, and first-run setup run inside SQLite
transactions. Account creation, a positive opening adjustment, and the pending
operation row commit together. A failure rolls all of them back. Account edits
and their pending operation row also commit together.

Each account write has a caller-supplied operation ID. Repeating an ID with the
same normalized content returns the saved account without adding rows. Reusing
it with different content fails. The queue row keeps an account reference and a
fixed-size content fingerprint rather than copying the account fields. Local
storage remains usable without sign-in; cloud delivery is outside this stage.

Expense and income edits keep the transaction ID and creation time, replace the
account/category/amount/date/note fields, and write an edit receipt in one
transaction. Delete removes the transaction and its create sync marker while
writing a delete receipt in the same transaction. The receipt fingerprint
supports stable retries and rejects an operation ID reused with different
content. Balances are derived from the resulting rows, so a move between
accounts updates both balances from one committed replacement. Account changes
in this form require the same currency. Planned income can be deleted, while
its edit remains blocked pending verification of its posting transition.

## Migration

Schema version 1 stored `opening_balance_minor` directly on `accounts`.
Version 2 replaces that column with account type metadata and adjustment rows.
The v1 migration rebuilds the related account and setup tables in one
transaction, carries profile/account/setup IDs forward, turns each nonzero
opening amount into an `initial` adjustment, and leaves zero balances without a
ledger row. A migration failure rolls back the schema version and copied data.

Version 3 adds categories, expenses, pending sync markers, and an account/date
index. The expense migration runs in one transaction after the account
migration and preserves version 2 data if it fails.

Version 4 adds income categories, incomes, and pending income sync markers.
Version 5 adds transaction edit/delete receipts. Version 6 adds transfers,
linked fee references on expenses, and pending transfer operations. Version 7
adds received-currency minor units and the canonical parsed exchange-rate
string. Existing same-currency transfers migrate with equal source and received
amounts and rate `1`. The currency migration is transactional and preserves
populated v6 stores when a backfill fails.

Version 8 adds normalized category budgets and pending budget operation
receipts. Some v7 stores already have budgets and same-currency transfers,
while others have currency-aware transfers without budgets. Opening either
layout adds only the missing relations or transfer columns, then advances to
v8. Transfer fees stay as linked expenses, and transfer principal remains a
separate ledger fact.

The adjustment table currently accepts initial balances only. Manual balance
adjustments, account deletion, loan schedules, investments, and cloud-sync
delivery need their own verified rules and schema changes before implementation.
