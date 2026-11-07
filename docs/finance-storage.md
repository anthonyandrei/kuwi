# Local finance storage

The browser database uses SQLite with `PRAGMA user_version` migrations. Version
1 stores the profile, first account, currency definitions, and setup references.
Opening a version 1 database runs the version 2 migration in one SQLite
transaction. It adds the built-in expense categories, expense records, their
pending sync operation rows, and an account/date index. The migration sets
`user_version=2` inside that transaction. A failed migration rolls back its
schema and version change while preserving version 1 setup data.

Version 2 source data follows these references:

```text
setup -> profiles
setup -> accounts -> currencies
expenses -> accounts
expenses -> categories
pending_sync_operations -> expenses
```

`expenses.id` is also the stable operation ID used by the corresponding
`pending_sync_operations.operation_id` key. The latter references the expense
ID and marks its create operation as pending local sync. Keeping it after local
commit lets a retry return the existing expense when the submitted content
matches; a retry with different content fails. The expense stores only account
and category IDs, an amount in minor units, a date, an optional note, and its
creation time. Account
names, currency precision, and category labels remain canonical in their own
tables.

The account balance is derived from its opening balance minus eligible saved
expense amounts in that account's currency. The first expense stage accepts
current and past dates, so each saved expense affects the derived balance. No
mutable balance copy is maintained. Expenses and pending sync rows are inserted
in one `BEGIN IMMEDIATE` transaction. A future sync implementation must update
this migration chain and preserve stable operation IDs when it adds sync
states.

When merging parallel account work, retain its setup/account changes and place
this schema after its latest migration version. If both branches add migration
versions, combine them into an ordered migration sequence and run the full
populated-database journey from each supported older version. Keep the existing
`setup` references and SQLite `user_version`; do not recreate storage or drop
user records during integration.
