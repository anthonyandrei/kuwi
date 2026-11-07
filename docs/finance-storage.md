# Local finance storage

The browser database uses strict SQLite tables and ordered `PRAGMA user_version`
migrations. Version 1 stores the profile, first account, currency definitions,
and setup references. Version 2 adds account types, balance adjustments, and
stable account operation records. Its migration carries profile, account, and
setup IDs forward and turns each nonzero opening balance into an initial
adjustment. Version 3 adds expense categories, expenses, pending sync markers,
and an account/date index. Version 4 adds income categories and records, same
currency transfers, linked transfer fees, and their pending operation records.

Opening a version 1 database runs the account migration, expense migration,
and version 4 migration in order. Version 2 runs the expense and version 4
migrations; version 3 runs version 4. Each migration commits in its own
transaction. Income and transfer relations are added together in the version 4
transaction. A failure leaves its starting schema and records available for
retry. A new database creates the version 2 account schema before applying
versions 3 and 4.

The current relations are:

```text
setup -> profiles
setup -> accounts -> currencies
account_adjustments -> accounts
pending_operations -> accounts
expenses -> accounts
expenses -> categories
pending_sync_operations -> expenses
incomes -> accounts
incomes -> income_categories
pending_income_sync_operations -> incomes
transfers -> accounts (source and destination)
expenses.transfer_id -> transfers
pending_transfer_operations -> transfers
```

`expenses.id` is the stable expense operation ID in its
`pending_sync_operations.operation_id` row. A linked transfer fee is an
ordinary expense in the canonical `fees` category. Its nullable `transfer_id`
references the transfer that caused it. The amount is stored once, on the fee
expense. Both rows have their own pending sync record.

`incomes.id` is the stable operation ID in its
`pending_income_sync_operations.operation_id` row. Income rows store an account
ID, nullable category ID, nonnegative minor units, date, optional note, planned
flag, and creation time. Only future dated entries may be planned at entry
time, and a zero amount is allowed only for a planned entry. Income categories
keep built in labels and display order canonical. An identical retry returns
the saved income; reusing its ID with changed content fails.

`transfers.id` is also the operation ID in `pending_transfer_operations`.
That row stores a SHA-256 fingerprint of the normalized request. A transfer
stores its source, destination, principal, date, note, and creation time. The
source must be Debit or Credit, the destination must be a different Debit
account, and both accounts must use the same currency. The source must cover
the principal plus any fee. A transfer and its optional fee expense, both sync
markers, and the stable retry record commit in one immediate transaction.
An identical retry has one effect; reuse of its ID with changed content fails.

Balances derive from adjustments, expenses, posted income, and transfer
principal. Current and past ordinary expenses reduce Debit and Assets balances
and increase Credit debt. Posted income adds to Debit and Assets balances and
reduces Credit debt. A transfer immediately reduces the source by its principal
and increases the debit destination by the same amount. A linked fee reduces
the source as an expense, including when the selected transfer date is in the
future. A Credit source owes both principal and fee. Planned income does not
affect balances. The app stores no mutable balance copy. Accounts with
expenses, income, or transfers count as active, so their currency and starting
balance stay fixed in the account editor.

Migration order is v1 to v2 to v3 to v4. Each migration preserves existing
records and references. The populated v3 upgrade fixture checks that account
and expense history survive a failed version 4 migration and become available
again after retry. Cloud sync delivery must retain operation IDs and define how
acknowledged transaction records remain available to history.

## Product backup contract

Exports use a JSON envelope with `format: "kuwi.backup"`, backup `version: 1`,
`schemaVersion: 4`, an ISO `exportedAt`, and an integrity object containing
`algorithm: "SHA-256"` and a lowercase digest. The digest covers the canonical
JSON form of `format`, `version`, `schemaVersion`, and `data`. Object keys are
sorted recursively before hashing; array order is retained. The current v4
data includes currencies, profiles, accounts, adjustments, setup, pending
account operations, expense categories and records, pending expense sync
markers, income categories and records, pending income sync markers, transfer
records, and pending transfer operations. The exported `fee_amount_minor` is
derived from the linked fee expense; joined labels and account balances are
also derived.

Restore accepts the original v3 contract, the earlier income only and transfer
only v4 contracts, and the current combined v4 contract. It checks the
integrity digest, exact relation fields, SQLite value constraints, and
references before replacing data. For v3 backups, restore adds canonical income
categories and empty income and transfer ledgers. For an income only v4 backup,
restore adds empty transfer relations. For a transfer only v4 backup, restore
adds canonical income categories and an empty income ledger. Transfer backups
require same currency, eligible accounts, a positive principal, a matching
linked fee expense when a fee is present, and a pending operation marker.

After validation, the worker replaces rows in foreign key order inside one
immediate transaction. A write error rolls the full replacement back. The app
reloads visible setup and balances only after commit. Backup `version`
identifies the backup contract; `schemaVersion` identifies the source SQLite
schema. Current exports use v1/v4. The importer keeps the earlier v1/v3 and
single feature v1/v4 formats readable.
