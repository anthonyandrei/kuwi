# Local finance storage

Kuwi stores account and transaction facts in strict SQLite tables in OPFS. It
uses ordered `PRAGMA user_version` migrations and derives balances from ledger
rows rather than keeping a mutable balance copy.

## Schema versions

Version 1 stores the profile, first account, currency definitions, and setup.
Version 2 adds account types, opening balance adjustments, and stable account
operation records. The migration carries profile, account, and setup IDs
forward and turns each nonzero opening amount into an initial adjustment.
Version 3 adds expense categories, expenses, pending sync markers, and an
account/date index. Version 4 adds income categories, incomes, pending income
sync markers, and an account/date index. Version 5 adds transaction
edit/delete receipts. Version 6 adds transfers, linked fee references on
expenses, and pending transfer operations.

A new database builds through versions 2, 3, 4, 5, and 6. Version 1 migrates
through the same sequence. Version 2 runs migrations 3 through 6, version 3
runs migrations 4 through 6, version 4 runs migrations 5 and 6, and version 5
runs migration 6. Each migration commits in its own transaction. A failed step
keeps its starting schema and data for a retry.

The v6 migration supports both earlier v4 layouts. Income-only v4 databases
receive transfer relations, and v4 databases that already contain transfers
keep their transfer data. It also upgrades v5 databases that already have
transaction receipts. Populated v4 and v5 fixtures check account, expense,
income, and sync marker identities after upgrade.

## Ledger writes and balances

An expense and its pending sync marker commit together. Income and its pending
sync marker use the same transaction boundary. Transfers write the principal,
optional linked fee expense, fee sync marker, and pending transfer operation in
one immediate transaction. The operation ID remains stable across retries. An
identical retry returns the saved ledger; reusing the ID with different
transfer details fails. A failed write rolls back all transfer effects.

A transfer source must be Debit or Credit, and the destination must be a
different Debit account. Both accounts must use the same currency. The source
must have enough balance or available credit to cover principal plus fee. A
positive fee is stored as an expense in the Fees category and references the
transfer ID. The fee name is `Bank transfer fee to <destination>`. The transfer
uses the selected date, including future dates, and affects balances
immediately.

The app derives Debit and Assets balances from adjustments, expenses, posted
income, and transfer principal. Expenses reduce those balances; posted income
adds to them. Credit expenses increase the amount owed and posted income lowers
it. Transfer principal reduces the source balance or increases its Credit debt,
and increases the Debit destination balance. A fee reduces the source balance
or increases its Credit debt. Planned income does not affect balances.

Editing an expense or income replaces its account, category, amount, date, and
note while preserving its ID and creation time. The replacement and edit receipt
commit together. Deleting a transaction, removing its create sync marker, and
writing its delete receipt also commit together. Receipt IDs provide stable
retries and retain deleted transaction IDs. Editing can move a transaction only
between accounts with the same currency. Planned income can be deleted, while
editing planned income remains blocked pending verification of its posting
transition. Linked transfer fees are controlled by their transfer and cannot
be edited or deleted as ordinary expenses.

## Backup contract

Exports use a JSON envelope with `format: "kuwi.backup"`, backup `version: 1`,
`schemaVersion: 6`, an ISO `exportedAt`, and an integrity object with
`algorithm: "SHA-256"` and a lowercase digest. The digest covers the canonical
JSON form of `format`, `version`, `schemaVersion`, and `data`. Object keys are
sorted recursively before hashing, and array order is retained.

Current v6 data includes currencies, profiles, accounts, adjustments, setup,
pending account operations, expense categories and records, pending expense
sync markers, income categories and records, pending income sync markers,
transfers, pending transfer operations, and transaction edit/delete receipts.
The exported `fee_amount_minor` is derived from the linked fee expense. Joined
labels and balances are also derived.

Restore accepts v3 backups without income or transfer relations, v4 backups
from income-only and transfer-only builds, v4 backups containing both feature
sets, v5 backups with transaction receipts, and current v6 backups. It checks
the digest, exact relation fields,
SQLite value constraints, unique keys, and references before replacing data.
Legacy formats gain canonical empty relations when restored. A transfer backup
must contain eligible same-currency accounts, a positive principal, a matching
linked fee expense when a fee is present, and a pending operation marker.
Replacement runs inside one immediate transaction. A failed write leaves the
previous store intact.

Cloud delivery is outside this local storage stage. Future sync work must keep
stable operation IDs and define how acknowledged transactions remain available
to history.
