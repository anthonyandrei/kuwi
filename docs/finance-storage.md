# Local finance storage

The browser database uses strict SQLite tables and ordered `PRAGMA user_version`
migrations. Version 1 stores the profile, first account, currency definitions,
and setup references. Version 2 adds account types, balance adjustments, and
stable account operation records. Its migration carries profile, account, and
setup IDs forward and turns each nonzero opening balance into an initial
adjustment. Version 3 adds expense categories, expense records, pending sync
markers, and an account/date index. Version 4 adds normalized income
categories, income records, pending income sync markers, and an account/date
index.

Opening a version 1 database runs the account migration in one transaction,
then the expense and income migrations in separate transactions. Opening
version 2 runs the expense and income migrations; opening version 3 runs the
income migration. If a migration fails, that step rolls back and the prior
schema and data remain available for retry. A new database creates the version
2 account schema before applying versions 3 and 4.

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
existing expense; reuse of the ID with different content fails. Expense rows
store account and category IDs, positive minor units, a date, an optional note,
and creation time. Account names, currency precision, and category labels stay
canonical in their own tables.

`incomes.id` is the stable operation ID in the matching
`pending_income_sync_operations.operation_id` row. Income rows store an account
ID, optional category ID, nonnegative minor units, date, optional note, planned
flag, and creation time. A zero amount is allowed only for a planned income.
The separate category relation keeps built-in labels and display order
canonical. The category reference is nullable because the verified form allows
an uncategorized entry.

The app derives balances from adjustment rows, expenses, and posted income.
Current and past debit or asset expenses reduce the balance; credit expenses
increase the amount owed. Posted income adds to debit or asset balances and
reduces credit debt. Future income is stored as planned and does not affect the
balance. The entry workflow accepts income on Debit and Credit accounts. The
app stores no mutable balance copy. Each transaction and its
pending sync marker commit in one `BEGIN IMMEDIATE` transaction. Repeating an
income ID with the same normalized content returns the saved ledger; reuse
with different content fails. Accounts with expenses or income count as active,
so their currency and starting balance stay fixed in the account editor.

Migration order is v1 to v2 to v3 to v4, preserving each step's existing
records and references. Future sync work must retain stable operation IDs and
define how acknowledged transaction records remain available to history.
