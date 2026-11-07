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
