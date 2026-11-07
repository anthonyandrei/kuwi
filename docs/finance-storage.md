# Local finance storage

The browser database uses strict SQLite tables and ordered `PRAGMA user_version`
migrations. Version 1 stores the profile, first account, currency definitions,
and setup references. Version 2 adds account types, balance adjustments, and
stable account operation records. Its migration carries profile, account, and
setup IDs forward and turns each nonzero opening balance into an initial
adjustment. Version 3 adds expense categories, expenses, pending sync markers,
and an account/date index. Version 4 adds income categories, income records,
pending income sync markers, and an account/date index.

Opening a version 1 database runs the account migration, expense migration, and
income migration in order. Version 2 runs the expense and income migrations;
version 3 runs the income migration. Each step commits in its own transaction.
A failed step leaves its starting schema and records available for retry. A new
database creates the version 2 account schema before applying versions 3 and 4.

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
no mutable balance copy. Each
transaction and its pending sync marker commit in one `BEGIN IMMEDIATE`
transaction. Accounts with expenses or income count as active, so their
currency and starting balance stay fixed in the account editor.

Migration order is v1 to v2 to v3 to v4. Each migration preserves existing
records and references. Future sync work must retain stable operation IDs and
define how acknowledged transaction records remain available to history.

## Product backup contract

Exports use a JSON envelope with `format: "kuwi.backup"`, backup `version: 1`,
`schemaVersion: 4`, an ISO `exportedAt`, and an integrity object containing
`algorithm: "SHA-256"` and a lowercase digest. The digest covers the canonical
JSON form of `format`, `version`, `schemaVersion`, and `data`. Object keys are
sorted recursively before hashing; array order is retained. The v4 data includes
the source rows for currencies, profiles, accounts, adjustments, setup, pending
account operations, expense categories and records, pending expense sync
markers, income categories and records, and pending income sync markers.
Balances and joined display labels are derived and are not copied.

Restore accepts v4 backups and v3 backups made before income support. It checks
the envelope, digest, exact relation fields, SQLite value constraints, and
foreign-key references before replacing data. It checks unique keys, supported
currency and category definitions, account and adjustment values, positive
expense amounts and dates through the current local day, and income amount,
date, category, account type, planned flag, and sync marker rules. For a v3
backup, restore seeds the current canonical income categories and an empty
income ledger. Restoring replaces the saved data with the selected backup.

After validation, the worker replaces rows in foreign-key order inside one
immediate transaction. A write error rolls the full replacement back. The app
reloads visible setup and balances only after commit. Backup `version` identifies
the backup contract; `schemaVersion` identifies the source SQLite schema.
Exports use v1/v4. The importer also accepts the earlier v1/v3 pair to retain
backups created before income support.
