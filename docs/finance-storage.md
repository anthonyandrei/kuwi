# Local finance storage

The browser database uses strict SQLite tables and ordered `PRAGMA user_version`
migrations. Version 1 stores the profile, first account, currency definitions,
and setup references. Version 2 adds account types, balance adjustments, and
stable account operation records. Its migration carries profile, account, and
setup IDs forward and turns each nonzero opening balance into an initial
adjustment. Version 3 adds expense categories, expense records, pending sync
markers, and an account/date index. Version 4 adds same-currency transfers,
their stable retry records, and an optional transfer reference on fee expenses.

Opening a version 1 database runs the account migration in one transaction,
then the expense and transfer migrations in separate transactions. Opening
version 2 runs the expense migration followed by the transfer migration;
opening version 3 runs the transfer migration. If a migration fails, its
transaction restores its starting schema and records for a later retry. A new
database creates the version 2 account schema before applying versions 3 and 4.

The version 4 relations are:

```text
setup -> profiles
setup -> accounts -> currencies
account_adjustments -> accounts
pending_operations -> accounts
expenses -> accounts
expenses -> categories
expenses.transfer_id -> transfers
pending_sync_operations -> expenses
transfers -> accounts (source and destination)
pending_transfer_operations -> transfers
```

`expenses.id` is also the stable operation ID in the matching
`pending_sync_operations.operation_id` row. That row references the expense
and marks its create operation for local sync. An identical retry returns the
existing expense; reuse of the ID with different content fails. Expense rows
store account and category IDs, positive minor units, a date, an optional note,
and creation time. Account names, currency precision, and category labels stay
canonical in their own tables.

`transfers.id` is also the stable operation ID in
`pending_transfer_operations.operation_id`; that row stores the normalized
request fingerprint used to distinguish an identical retry from a conflicting
reuse. A transfer stores source and destination account IDs, principal and fee
in minor units, date, optional note, and creation time. The worker accepts
debit or credit sources and debit destinations with matching currency. It
checks that the source can cover principal plus fee inside the same
`BEGIN IMMEDIATE` transaction that writes the transfer, optional fee expense,
and pending markers.

The optional fee is a regular expense in category `fees`, linked by its unique
`expenses.transfer_id` reference. The fee amount is also stored on the transfer
so validation can require one matching expense for a positive fee and no
expense for a zero fee. The expense and its pending sync marker commit with the
transfer and pending transfer operation. Balance queries derive outgoing
principal from the transfer row, incoming principal from the same row, and
outgoing fees from the linked expense. Debit sources lose principal and fee;
credit sources owe both. The destination is debit-only and gains principal.
No mutable balance is stored.

For example, a PHP 1,000 transfer from a debit account with PHP 1,500 and a PHP
25 fee leaves the source at PHP 475 and credits the destination by PHP 1,000.
The source's ledger also contains a PHP 25 Fees expense. Without the fee, the
source ends at PHP 500 and no fee expense is present. A source with PHP 1,024.99
available cannot save the PHP 1,025 total deduction; neither account changes.
Same-currency transfer amounts and fees use the account's stored minor-unit
precision: two decimals for PHP, USD, EUR, GBP, and TWD, and whole units for
JPY. The transfer date is a real `YYYY-MM-DD` date; the recovered web action
applies transfers immediately even when their date is in the future.

The app derives account balances from adjustments, eligible expenses, and
transfers. Current and past debit or asset expenses reduce the balance; credit
expenses increase the amount owed. Ordinary expense dates after today are
rejected. Transfer principal and its linked fee affect balances as soon as the
transfer is saved, including when its date is in the future. Each expense and
its pending sync marker commit in one `BEGIN IMMEDIATE` transaction. Accounts
with expenses or transfers count as active, so their currency and starting
balance stay fixed in the account editor.

The account and expense migrations run in order from v1 to v2 to v3, followed
by the transfer migration to v4. Keep that sequence and the existing setup
references when changing the schema. Future sync work must retain stable
operation IDs and define how acknowledged expense records remain available to
history.

## Product backup contract

The product exports a JSON envelope with `format: "kuwi.backup"`, backup
`version: 1`, `schemaVersion: 4`, an ISO `exportedAt`, and an integrity object
containing `algorithm: "SHA-256"` and a lowercase digest. The digest covers the
canonical JSON form of `format`, `version`, `schemaVersion`, and `data`. Object
keys are sorted recursively before hashing; array order is retained. The
contract includes the complete v4 source data: currencies, profiles, accounts,
account adjustments, setup, pending account operations, expense categories,
expenses including their optional transfer reference, pending expense sync
operations, transfers including fee amounts, and pending transfer operations. Derived balances and
display labels are not copied because they are calculated from these canonical
rows.

Restore checks the format and versions, digest, exact relation fields, SQLite
value constraints, and all foreign-key references before it begins replacement.
It also checks unique keys, supported currency and category definitions,
account and adjustment values, transfer eligibility, fee linkage, and valid
dates. Ordinary expenses must be dated through the current local day; a
transfer fee may share a future date with its transfer. The current currency
and built-in category definitions are part of v1. A candidate must include
each expense and transfer pending marker and preserve account operation IDs
and request fingerprints. The validator does not change the live database. After
validation, the worker deletes and inserts rows in foreign-key order inside one
immediate transaction. A write error rolls the full replacement back. The app
reloads its visible setup and balances only after commit.

Changes to the supported relations, invariants, or currency/category definitions
need an explicit backup compatibility decision and round-trip journey update.
Backup `version` identifies the backup contract; `schemaVersion` identifies the
source SQLite schema. Restore accepts the current v1/v4 shape and the earlier
v1/v3 shape. A v1/v3 restore creates no transfers, adds a null transfer
reference to each old expense, and creates empty transfer-operation relations.
Re-export writes the current v1/v4 shape. The importer verifies the original
digest before adapting the older relation shape.

### Schema merge with income work

The separate income change also advances version 3 to version 4. Before either
version 4 schema is released, combine the income and transfer relations in one
version 4 migration and set `user_version` once. The combined backup v1/v4
shape includes income tables and pending income sync rows alongside transfers,
transfer retry rows, and `expenses.transfer_id`. Keep v1/v3 restore support by
supplying empty income and transfer relations, empty pending transfer
operations, and a null transfer reference.
If a version 4 schema is released first, the second feature needs a version 5
migration and a v1/v5 backup shape; do not redefine a released schema version.

Income is a separate transaction kind. Its facts stay outside expense rows;
both income and transfer effects feed derived account balances through their
canonical records.
