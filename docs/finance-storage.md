# Local finance storage

The browser database uses strict SQLite tables and ordered `PRAGMA user_version`
migrations. Version 1 stores the profile, first account, currency definitions,
and setup references. Version 2 adds account types, balance adjustments, and
stable account operation records. Its migration carries profile, account, and
setup IDs forward and turns each nonzero opening balance into an initial
adjustment. Version 3 adds expense categories, expense records, pending sync
markers, and an account/date index.

Opening a version 1 database runs the account migration in one transaction,
then the expense migration in a second transaction. Opening version 2 runs the
expense migration. If version 3 migration fails after version 2 has committed,
all version 2 account data remains available for a later retry. A new database
creates the version 2 account schema before applying version 3.

The version 3 relations are:

```text
setup -> profiles
setup -> accounts -> currencies
account_adjustments -> accounts
pending_operations -> accounts
expenses -> accounts
expenses -> categories
pending_sync_operations -> expenses
```

`expenses.id` is also the stable operation ID in the matching
`pending_sync_operations.operation_id` row. That row references the expense
and marks its create operation for local sync. An identical retry returns the
existing expense; reuse of the ID with different content fails. Expense rows
store account and category IDs, positive minor units, a date, an optional note,
and creation time. Account names, currency precision, and category labels stay
canonical in their own tables.

The app derives an account balance from its adjustment rows and eligible
expenses. Current and past debit or asset expenses reduce the balance. Credit
expenses increase the amount owed. Future dates are rejected in this stage, so
every saved expense affects the derived balance. The app stores no mutable
balance copy. Each expense and its pending sync marker commit in one
`BEGIN IMMEDIATE` transaction. Accounts with expenses count as active, so their
currency and starting balance stay fixed in the account editor.

When the account and expense branches were combined, their migrations were
ordered as v1 to v2 to v3. Keep that sequence and the existing setup
references when changing the schema. Future sync work must retain stable
operation IDs and define how acknowledged expense records remain available to
history.

## Product backup contract

The product exports a JSON envelope with `format: "kuwi.backup"`, backup
`version: 1`, `schemaVersion: 3`, an ISO `exportedAt`, and an integrity object
containing `algorithm: "SHA-256"` and a lowercase digest. The digest covers the
canonical JSON form of `format`, `version`, `schemaVersion`, and `data`. Object
keys are sorted recursively before hashing; array order is retained. The
contract includes the complete v3 source data: currencies, profiles, accounts,
account adjustments, setup, pending account operations, expense categories,
expenses, and pending sync operations. Derived balances and display labels are
not copied because they are calculated from these canonical rows.

Restore checks the format and versions, digest, exact relation fields, SQLite
value constraints, and all foreign-key references before it begins replacement.
It also checks unique keys, the supported currency and category definitions,
account and adjustment values, positive integer expense amounts, and valid
expense dates through the current local day. The current currency and built-in
category definitions are part of v1. A candidate must include each expense's
pending sync marker and preserve its operation ID, account operation IDs, and
request fingerprints. The validator does not change the live database. After
validation, the worker deletes and inserts rows in foreign-key order inside one
immediate transaction. A write error rolls the full replacement back. The app
reloads its visible setup and balances only after commit.

Changes to the supported relations, invariants, or currency/category definitions
need an explicit backup compatibility decision and round-trip journey update.
Backup `version` identifies the backup contract; `schemaVersion` identifies the
source SQLite schema. The importer currently accepts only this v1/v3 pair.

Income remains a separate future workflow. It should add its own finance
command module and worker command handler, with an income record and pending
sync record committed in one transaction. It must extend the normalized schema
through a migration and update the backup contract and real-persistence
journeys. Income facts must not be folded into expense rows or duplicated in
derived account balances.
