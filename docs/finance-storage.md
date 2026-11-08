# Local finance storage

Kuwi stores account, transaction, and budget facts in strict SQLite tables in OPFS. It
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
expenses, and pending transfer operations. Existing v7 stores have one of two
layouts: currency-aware transfer amounts and rates, or category budgets and
budget receipts with same-currency transfers. Version 8 combines the v7 transfer
and budget layouts. It has two populated shapes: currency-aware transfers
without planned fields, and planned entries without currency-aware transfer
columns. Version 9 adds planned expense state and scheduled amounts, planned
income amounts, explicit log receipts, and normalizes transfer columns. Version
10 adds original create-request receipts for expense and income retries and a
profile preference for the monthly budget cycle start day. Each migration
checks existing columns before changing the schema and commits in its own
transaction. A failed step keeps its starting schema and data for a retry.

The v6 migration supports both earlier v4 layouts. Income-only v4 databases
receive transfer relations, and v4 databases that already contain transfers
keep their transfer data. It also upgrades v5 databases that already have
transaction receipts. Populated v4 and v5 fixtures check account, expense,
income, and sync marker identities after upgrade. The currency migration
backfills each existing same-currency transfer with an equal received amount
and rate `1`. It backfills only when the received-amount column is absent, so
reopening a currency-aware store preserves recorded values. Schema and data
changes roll back together on failure. The v7-to-v8 migration adds or preserves
the transfer currency columns before creating any missing budget relations.
The v8-to-v9 migration adds whichever planned or currency columns are absent. If
the receipt table lacks `log`, it rebuilds the table and copies existing receipts.
The v9-to-v10 migration adds the monthly preference and nullable create
receipts; existing marker rows keep null receipts and their existing data.

## Ledger writes and balances

An expense and its pending sync marker commit together. Income and its pending
sync marker use the same transaction boundary. Expense and income form
submissions preserve the normalized original request, planned intent, and local
date at submission after a transaction is logged or corrected. A retry on or
after a future plan's due date can still match its original intent. Same-ID
changed content fails. Migrated records without a create receipt use their
current row for retry checks; linked transfer-fee expenses use the transfer
receipt.
Transfers write the source principal, destination received amount, canonical
rate, optional linked fee expense, fee sync marker, and pending transfer
operation in one immediate transaction. The operation ID remains stable across
retries. An identical
retry returns the saved ledger; reusing the ID with different transfer details
fails. A failed write rolls back all transfer effects.

A transfer source must be Debit or Credit, and the destination must be a
different Debit account. The source must have enough balance or available
credit to cover source principal plus fee. The manual rate uses the direction
`1 source currency = rate destination currency`, and both rate and received
amount entry work offline. Received amounts are truncated to destination
precision before storage. Kuwi parses the rate as a JavaScript number and stores
its canonical decimal string. Rate entry multiplies the source amount using
decimal arithmetic and truncates to destination precision. Received-amount
entry derives and stores the implied JavaScript rate; that rate describes the
manual amount and does not have to reproduce its minor units when multiplied
back. The source principal and fee use source minor units; the
received amount uses destination minor units. A positive fee is stored as an
expense in the Fees category and references the transfer ID. The fee name is
`Bank transfer fee to <destination>`. The transfer uses the selected date,
including future dates, and affects balances immediately.

Budgets store one definition per expense category. A fixed amount uses
thousandths of the preferred currency unit; a percentage uses integer
hundredths of a percent and derives its limit from actual income in the same
interval. Saving zero clears the definition. Saving or clearing a definition
and its pending operation receipt share one SQLite transaction. A retry with
the same operation ID and content returns the committed state; changed content
under that ID fails. Amount edits preserve a rollover start, while changing
the interval or bi-weekly anchors starts a new rollover span.

The profile stores a monthly cycle start day from 1 through 31, defaulting to 1.
In months without that date, the cycle starts on the month's last day. The
preference is editable in the budget workspace and included in backups.

Progress comes from eligible expense and income rows each time it is read.
Expenses count across accounts by category and inclusive period. Monthly periods
use the configured cycle start day. Actual income across all accounts and
categories forms the percentage base; planned income is excluded. Planned
expenses stay out of spending progress until logged. Transfers do not contribute
their principal to spending. A transfer fee is already stored once as a linked
Fees expense and counts once when it meets the budget date and eligibility rules.
Kuwi currently has no FX quote source, so progress is unavailable when
qualifying expenses or income use a currency different from the profile's
preferred currency.

The app derives Debit and Assets balances from adjustments, posted expenses,
posted income, and transfer principal. Expenses reduce those balances; posted
income adds to them. Credit expenses increase the amount owed and posted income
lowers it. Transfer principal reduces the source balance or increases its
Credit debt, and the received amount increases the Debit destination balance. A
fee reduces the source balance or increases its Credit debt. Planned expenses
and income do not affect balances.

A future date creates a planned entry using the browser's local calendar date.
Closing the app across its due date does not post it. History keeps due entries
marked Overdue until the user chooses Log. Expense logging asks for confirmation;
income logging asks for the actual positive amount. A still-future plan logs with
today's date, while a due or overdue plan keeps its scheduled date. Logging
stores the scheduled amount and clears planned state in the same transaction as
the stable log receipt.

Editing a planned entry preserves its planned state while it remains due or
overdue. Moving a future plan to today or earlier posts it; moving a posted entry
to the future makes it planned. Deleting a planned entry has no balance effect.
Editing or deleting a posted entry changes its derived balance through the saved
row. Edits, deletes, and logs write their receipts atomically with the ledger
change. Editing can move a transaction only between accounts with the same
currency. Linked transfer fees remain controlled by their transfer and cannot
be edited or deleted as ordinary expenses.

## Backup contract

Exports use a JSON envelope with `format: "kuwi.backup"`, backup `version: 1`,
`schemaVersion: 10`, an ISO `exportedAt`, and an integrity object with
`algorithm: "SHA-256"` and a lowercase digest. The digest covers the canonical
JSON form of `format`, `version`, `schemaVersion`, and `data`. Object keys are
sorted recursively before hashing, and array order is retained.

Current v10 data includes currencies, profiles with the monthly cycle
preference, accounts, adjustments, setup, pending account operations, expense
categories and records, planned flags and scheduled amounts, pending expense
sync markers with immutable create receipts, income categories and records,
planned flags and scheduled amounts, pending income sync markers with immutable
create receipts, transfers with source and received minor-unit amounts and
their rate, pending transfer operations, transaction edit/delete/log receipts,
canonical budget definitions, and pending budget operation receipts.
The exported `fee_amount_minor` is derived from the linked fee expense. Joined
labels and balances are also derived.

Restore accepts v3 backups without income or transfer relations, v4 backups
from income-only and transfer-only builds, v4 backups containing both feature
sets, v5 backups with transaction receipts, v6 backups with transfer data, and
both v7 layouts. Version 8 backups with the current relation set are accepted
in either populated shape: currency-aware transfer rows without planned
amounts, or planned rows without currency-aware transfer fields. Older backups
gain empty budget relations. Version 9 backups default the monthly cycle day to
1 and leave old create receipts empty. Budget-only v7 and planned v8 backups gain
same-currency transfer amounts and rate `1`; currency-aware backups retain
their recorded amounts and rates. It checks
the digest, exact relation fields,
SQLite value constraints, unique keys, and references before replacing data.
Legacy formats gain canonical empty relations when restored. A transfer backup
must contain eligible accounts, positive source and received amounts, a
canonical positive rate, a matching linked fee expense when a fee is present,
and a pending operation marker.
Replacement runs inside one immediate transaction. A failed write leaves the
previous store intact.

Cloud delivery is outside this local storage stage. Future sync work must keep
stable operation IDs and define how acknowledged transactions remain available
to history.
