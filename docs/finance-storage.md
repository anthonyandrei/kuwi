# Local finance storage

The browser database uses strict SQLite tables and ordered `PRAGMA user_version`
migrations. Version 1 stores the profile, first account, currency definitions,
and setup references. Version 2 adds account types, balance adjustments, and
stable account operation records. Its migration carries profile, account, and
setup IDs forward and turns each nonzero opening balance into an initial
adjustment. Version 3 adds expense categories, expenses, pending sync markers,
and an account/date index. Version 4 adds income categories, income records,
pending income sync markers, and an account/date index. Version 5 adds a durable
receipt table for transaction edits and deletions.

Opening a version 1 database runs the account, expense, income, and transaction
operation migrations in order. Version 2 runs the expense, income, and
transaction operation migrations; version 3 runs the income and transaction
operation migrations; version 4 runs the transaction operation migration. Each
step commits in its own transaction. A failed step leaves its starting schema
and records available for retry. A new database creates the version 2 account
schema before applying versions 3, 4, and 5.

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
pending_transaction_operations (operation receipts and delete tombstones)
```

`expenses.id` is also the stable operation ID in the matching
`pending_sync_operations.operation_id` row. That row references the expense
and marks its create operation for local sync. An identical retry returns the
saved expense; reuse of the ID with different content fails. Expense rows
store canonical account and category IDs, positive minor units, date, optional
note, and creation time.

`incomes.id` is the stable operation ID in the matching
`pending_income_sync_operations.operation_id` row. Income rows store an account
ID, nullable category ID, nonnegative minor units, date, optional note, planned
flag, and creation time. Only future-dated entries may be planned at entry time,
and a zero amount is allowed only for a planned entry. Income categories keep
built-in labels and display order canonical. An identical retry returns the
saved income; reusing its ID with changed content fails.

The app derives balances from adjustments, expenses, and posted income. Current
and past Debit or Assets expenses reduce the balance; Credit expenses increase
the amount owed. Posted income adds to Debit balances and reduces Credit debt.
Planned income does not affect balances, including after its scheduled date
passes. Income entry is available for Debit and Credit accounts. The app stores
no mutable balance copy.

Each transaction and its create sync marker commit in one `BEGIN IMMEDIATE`
transaction. Editing an expense or income replaces its account, category,
amount, date, and note in place while preserving its ID and creation time. The
replacement row and its edit receipt commit together. Deleting a transaction,
removing its create sync marker, and writing its delete tombstone also happen in
one immediate transaction. An identical retry of an edit or delete returns the
current ledger; reusing an operation ID with different transaction details
fails. A rolled-back write leaves the prior transaction and sync marker intact.

`pending_transaction_operations` stores an operation ID, transaction kind and
ID, edit/delete type, SHA-256 request fingerprint, and creation time. It has no
foreign key because deletion receipts must retain the deleted ID. Expense and
income rows keep their create sync markers during edits; edit receipts record
local retry identity. Remote delivery is not implemented.

Balances come from the current transaction rows, so an edit changes the old and
replacement account effects after the same SQLite commit. Editing is limited
to current or past expenses and posted income. Planned income can be deleted,
but editing it is blocked because its posting transition is not verified.
Account replacement is limited to accounts in the same currency. Transfer
editing and cross-currency replacement are outside this boundary. Accounts
with expenses or income count as active, so their currency and starting
balance stay fixed in the account editor.

Migration order is v1 to v2 to v3 to v4 to v5. The v5 migration adds an empty
operation receipt table and preserves all earlier transaction identities.
Future sync work must retain stable operation IDs and define how acknowledged
transaction records remain available to history.

## Product backup contract

Exports use a JSON envelope with `format: "kuwi.backup"`, backup `version: 1`,
`schemaVersion: 5`, an ISO `exportedAt`, and an integrity object containing
`algorithm: "SHA-256"` and a lowercase digest. The digest covers the canonical
JSON form of `format`, `version`, `schemaVersion`, and `data`. Object keys are
sorted recursively before hashing; array order is retained. The v5 data includes
the source rows for currencies, profiles, accounts, adjustments, setup, pending
account operations, expense categories and records, pending expense sync
markers, income categories and records, pending income sync markers, and
transaction edit/delete receipts. Balances and joined display labels are
derived and are not copied.

Restore accepts v5 backups, v4 backups made before transaction edit/delete
receipts, and v3 backups made before income support. It checks the envelope,
digest, exact relation fields, SQLite value constraints, and foreign-key
references before replacing data. It checks unique keys, supported currency and
category definitions, account and adjustment values, positive expense amounts
and dates through the current local day, and income amount, date, category,
account type, planned flag, and sync marker rules. For v3 backups, restore seeds
the current canonical income categories and an empty income ledger. For v3 and
v4 backups, it also creates an empty transaction operation table. Restoring
replaces the saved data with the selected backup.

After validation, the worker replaces rows in foreign-key order inside one
immediate transaction. A write error rolls the full replacement back. The app
reloads visible setup and balances only after commit. Backup `version` identifies
the backup contract; `schemaVersion` identifies the source SQLite schema.
Exports use v1/v5. The importer accepts v1/v3 and v1/v4 files created before
income or transaction edit/delete support.
