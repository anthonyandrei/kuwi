# Tarsi behavior reference

Checked: 2026-11-07. These are static observations from the delivered web build.
They do not establish runtime behavior or equivalence to iPhone 2.5.9.

Artifact hashes, retained REA Evidence, and local provenance paths are in
[the investigation report](tarsi-reverse-engineering.md). The observations below
come from direct AST and source inspection. Target code was not executed.

Separate evidence: [iPhone 2.5.9 onboarding](tarsi-iphone-onboarding.md) and
[Home/Wallet screenshots of unverified version](tarsi-home-wallet-screenshots.md).

## Onboarding

Source: [onboarding chunk](https://web.tarsi.cloud/_expo/static/js/web/onboarding-944f3e42d4eac0c46f2f98b079a572a8.js),
Metro module 3233. Store module 1685 and account-action module 1731 are in the
[common bundle](https://web.tarsi.cloud/_expo/static/js/web/__common-d31990bcc79fe8c4b0213bb913c4a7e9.js).
Currency helper module 1701 is in the
[index bundle](https://web.tarsi.cloud/_expo/static/js/web/index-32d1e7797d0f640bdef7cc274d2a7443.js).

The state map names these steps in order:

| States | Values |
| --- | --- |
| Profile | 1 |
| Welcome, spending, organizing, and goals benefits | 2 through 5 |
| Currency and first account | 6 and 7 |
| Celebration | 8 |
| Quick logging, receipt logging, chat, and automations | 9 through 12 |
| Mascot, appearance, badges, and feedback | 13 through 16 |
| Founder note | 17 |

A notification state also exists at -1. These values are a code state map,
not evidence that every user sees 17 mandatory screens. The web celebration
branch disables the local notification preference and advances into the
logging introduction. Other branches retain native notification handling.
That target implementation does not determine what Kuwi can do with web push.

The fresh top-level store includes one debit account named Cash, with ID
`default-general`, balance zero, and currency PHP. Financial entry arrays start
empty. Built-in categories come from helper modules; empty custom-category
arrays do not mean the app has no categories. Additional-profile defaults use
a separate helper that marks onboarding complete, so those defaults must not
be mistaken for first-launch behavior.

The onboarding reducer begins at the profile state. It takes the existing name
and first account when available. Currency selection is limited to the first
six common currencies: PHP, USD, EUR, GBP, JPY, and TWD. A preference outside
that subset falls back to PHP in this flow.

The advance handler trims the entered name and requires a nonblank value.
The currency step saves the preferred currency. The account step trims its
name, falls back to Cash, and parses the starting balance in the selected
currency. Blank or nonfinite values become zero. It applies a selected bank
template's metadata or the Cash icon and theme color.

When a first account exists, the handler updates that account as a debit
account. Otherwise it calls account creation. Those paths have different
effects: account creation can add a separate initial balance-adjustment record
for a positive opening balance, while the fresh existing-account update path
changes the account directly. An account with linked financial activity retains
its existing balance and currency during an ordinary account edit.

Completion saves the mascot preference, trimmed preferred name, and completed
flag, then replaces the route with `/(tabs)`. The completion handler has a
Friend fallback even though the earlier name step rejects blank input.
These are separate store calls; the trace does not establish one atomic
initialization transaction.

## Motion

The onboarding chunk retains Reanimated calls and embedded worklet code.
Examples include staggered reveals after 240, 620, and 1000 ms, each using a
440 ms timing animation with cubic ease-out. Animated styles use opacity,
vertical translation, and scale.

Two spring configurations use damping/stiffness/mass values of
16/175/0.72 and 17/165/0.72. Other transitions use a 220 ms duration with a
60 ms alternative branch. The condition for that branch has not been traced,
so it is not identified as an accessibility setting.

The separate motion-default helper, Metro module 1841, defaults reduced effects
off on web and Android. For other platforms it considers available memory;
iOS also checks the major OS version. This is a default-setting rule, not proof
that all animation sites honor the setting or the user's OS preference.

These values can guide a PWA reconstruction. Runtime comparison is still
needed for gesture response, frame pacing, keyboard behavior, and final layout.

## Expense posting and transfers

Source: store module 1685 and account-action module 1731 in the common bundle.
The analyzed expense and wallet screen chunks establish additional screen
code availability; their full interaction paths have not been traced.

Expense creation checks for an existing Shortcut expense through a helper,
generates an ID, sets a creation timestamp, normalizes tags, and rounds amounts
for the account currency. A future-dated entry is marked planned unless it
already has that flag. The precise Shortcut matching rule remains untraced.

Posting updates the account balance only when its date is today or earlier,
the entry is not planned, and `affectsAccountBalance` is not false. Historical
statement entries are excluded through an ID helper. Eligible cashback creates
a linked income and updates its account balance in the same returned state update.
Recurring-entry reconciliation also runs. This is an in-memory state update;
device persistence follows separately.

### Ordinary expense entry

Checked 2026-11-07 from the shipped web `add-expense` chunk, Metro module 2591,
and common-bundle modules 1685, 1701, 1709, and 1728. The lazy chunk has SHA-256
`98677be132d94743c935cf788959c44ff21ffe3829226355dc21f7cdbdeb0c83`; its
provenance is recorded in
`/Users/drei/Library/Caches/kuwi-research/tarsi-web-lazy-20261107/provenance.json`.
The common bundle SHA-256 is
`ccac38fefe6008c3988e03c933635bd4fcd1f19ae52b5179f623197bd7cda943`; extracted
module byte ranges and hashes are in
`/Users/drei/Library/Caches/kuwi-research/tarsi-focused-modules-20261107/provenance.json`.
This is static web code inspection. No target code ran, and it does not verify
iPhone 2.5.9 behavior.

The built-in expense categories are Food (`food`), Transport (`transport`),
Phone (`phone`), Bills (`bills`), Shopping (`shopping`), Fun (`entertainment`),
Health (`health`), Fees (`fees`), and Other (`other`). The form also asks the
store for visible categories, so custom-category behavior is a separate Pro
path. An unset category resolves to `other` at save time.

The ordinary entry initializes its date to today. Its web date picker passes no
minimum or maximum date. The save guard requires a selected account and a
resolved currency conversion, and requires an amount above zero for an ordinary
current or past expense. A future one-time date is classified as planned; a
zero amount is allowed only for a future or recurring entry under that guard.
The quick-entry path falls back to today when its date is not a `YYYY-MM-DD`
string. Date parsing beyond that shape check and the native calendar boundaries
were not traced. Kuwi's first expense stage accepts current and past dates only;
it does not claim Tarsi date-boundary parity.

Currency module 1701 reports zero minor digits for JPY, KRW, and CLP, three for
KWD, BHD, and OMR, and two for other codes. The display-currency set is separate
and includes VND, which still uses two digits in the traced rounding helper.
That helper leaves nonfinite values at zero and otherwise applies
`Math.round((amount + Number.EPSILON) * 10 ** digits) / 10 ** digits`, including
JavaScript's negative-half rounding behavior. Examples: PHP 12.345 becomes
12.35, JPY 12.5 becomes 13, and KWD 12.3456 becomes 12.346. Currency module
1685 rounds the expense in the account currency, falling back to the preferred
currency, and rounds a finite original amount in its original currency.
`parseCurrencyToNumber` removes commas, uses `parseFloat`, maps NaN to zero,
then rounds. The expense chunk's ordinary save guard rejects negative and
nonfinite values and requires a positive amount for a nonfuture one-time entry.
It does not establish one universal textual-input grammar.

For the verified posting example with today 2026-11-07, a regular PHP 10 entry
dated 2026-11-07 posts; one dated 2026-11-08 is marked planned and does not
post; an explicitly planned entry dated 2026-11-07 also does not post. Posting
requires an account, a date no later than today, a non-planned entry, and
`affectsAccountBalance` not set to false. The helper excludes historical
statement IDs. The traced expense path has no separate available-balance
threshold; for a debit account, the balance helper subtracts the expense amount.
An eligible positive cashback value creates a linked income. Cashback, bill splits, recurring
expenses, installments, edits, and deletions are outside Kuwi ticket #4's
ordinary one-time entry and remain unverified for Kuwi.

These findings were checked against the supplied focused extractions and the
original cached bundles identified above. The expense chunk depends on common
category helpers for visible-category filtering, ID resolution, and subcategory
validation; module 1685 contains the account/store posting path, 1701 currency
rounding, 1709 balance adjustment, and 1728 category definitions and category
resolution. Evidence is static and platform-specific. No runtime validation,
native comparison, minimum historical date, or linked-effect rule beyond the
eligible cashback path is claimed.

### Ordinary income entry

Checked 2026-11-07 from the shipped web `add-income` chunk, Metro module 2617,
and common-bundle modules 1685, 1701, 1709, and 1730. The chunk is
`add-income-c54847041456330b5c6bb44f04331180.js`, 75,087 bytes, with SHA-256
`4ae172ffa99f05be1a4a840b8a9368b0f9154656eb686b4b7091aa7c95d5520e`. The cached
index maps `./add-income.tsx` to this chunk. The route map, full direct module
dependency list, source artifact, and REA 6.8.0 Evidence are retained in
`/Users/drei/Library/Caches/kuwi-research/tarsi-income-20261107/`; the REA
Evidence ID is `ev_c54dd834bd8afceaee3b0e5fb9a5e6d8d0c875acbe3618f3b48a0991a4f0bac3`.
This is a completed static parse of one file, with 22,839 AST nodes, 234
findings, and no parse failures. It does not establish runtime behavior or
iPhone 2.5.9 parity.

The ordinary form starts with today's local date, no selected category, and the
profile's preferred currency. It requires an account and a nonnegative amount.
The amount must be positive for a current or past one-time entry. A future
one-time date becomes planned, does not post to the balance, and permits a zero
amount. A note is trimmed and omitted when blank. The category is optional; an
unset category is stored without a category ID. The form's account picker
includes Debit and Credit accounts. It converts from the selected currency to
the account currency when they differ, using the app's available or manual
conversion rate.

The built-in income categories are Salary (`salary`), Bonus (`bonus`),
Freelance (`freelance`), Commission (`commission`), Business (`business`),
Side Hustle (`side-hustle`), Allowance (`allowance`), Gift (`gift`), Refund
(`refund`), Cashback (`cashback`), Interest (`interest`), Dividend
(`dividend`), Rental (`rental`), and Other (`other`). The source also filters
hidden categories and supports custom categories; those paths are outside this
bounded Kuwi entry.

For an eligible ordinary income, the store posts only when the date is today or
earlier and the income is not planned. The balance helper adds income to Debit
and Asset balances and subtracts it from the amount owed on Credit accounts.
The inspected code does not establish whether another process changes a
planned entry to posted when its date arrives.
The ordinary income form itself exposes Debit and Credit accounts. Its currency
rounding helper uses the account currency: PHP 12.345 rounds to 12.35 and JPY
12.5 rounds to 13. As a calculation example, PHP 1,000 plus a same-day income
of 12.35 gives a Debit balance of 1,012.35; a Credit amount owed of 1,000
becomes 987.65. The same entry dated tomorrow is planned and leaves either
balance unchanged. These are calculations from the traced helpers, not
observed runs of Tarsi.

Kuwi's first income entry supports the selected account's currency. The source
currency selector and cross-currency conversion flow need their own verified
rate source and are not included. Recurring income, subcategories, custom or
hidden categories, and native behavior are also outside this stage.

### Same-currency transfer action

Checked 2026-11-07 from common-bundle module 1731, with available-balance logic
from module 1709, currency rounding from module 1701, and the state store in
module 1685. The common bundle SHA-256 is
`ccac38fefe6008c3988e03c933635bd4fcd1f19ae52b5179f623197bd7cda943`; selected
module ranges and dependencies are recorded in
`/Users/drei/Library/Caches/kuwi-research/tarsi-focused-modules-20261107/provenance.json`.
This is static web code inspection. It does not establish runtime behavior or
iPhone 2.5.9 parity.

The action rejects a nonpositive principal, identical account IDs, missing
accounts, and failed eligibility or available-funds checks without changing
the returned state. A Debit or Credit account may send; only a Debit account
may receive. Assets accounts are excluded. The source and destination must
have the same currency for Kuwi issue #8. Tarsi's broader action also accepts
received amounts in another currency, which belongs to issue #9.

The source must cover principal plus fee. Module 1709 defines available funds
as the account balance for non-Credit accounts and `credit limit - amount owed`
for Credit. The transfer action applies currency rounding before checking the
sum. A positive fee becomes an expense on the source account in the `fees`
category, with note `Bank transfer fee to <destination name>` and the same
date and creation timestamp as the transfer. The action moves principal to the
destination and records the principal, fee, and linked fee expense in one
returned store update. It applies the movement immediately, including for a
future date.

Module 1701 uses two decimal places for PHP and zero for JPY. Its examples
include PHP 12.345 rounding to 12.35 and JPY 12.5 rounding to 13. Kuwi's
currently supported account currencies use two decimals except JPY. Kuwi's
transfer form limits typed input to that precision and stores integer minor
units.

Worked examples from the traced helpers:

| Source balance | Transfer | Fee | Result |
| --- | ---: | ---: | --- |
| PHP 1,500.00 Debit | PHP 200.00 | None | Source PHP 1,300.00; destination receives PHP 200.00. |
| PHP 1,000.00 Debit | PHP 975.00 | PHP 25.00 | Source PHP 0.00; destination receives PHP 975.00; linked fee expense is PHP 25.00. |
| PHP 1,024.99 Debit | PHP 1,000.00 | PHP 25.00 | Rejected because principal plus fee exceeds available balance by PHP 0.01. |
| PHP 50.00 owed, PHP 150.00 credit limit | PHP 95.00 from Credit | PHP 5.00 | Available credit is PHP 100.00; result owes PHP 150.00 and the Debit destination receives PHP 95.00. |

The cached index maps `./transfer.tsx` to
`/_expo/static/js/web/transfer-2dbf20b142412a934fd581303887e2c8.js`, but that
lazy chunk is absent from the local cache. The public JavaScript reader rejected
the `application/javascript` response and the browser access host was
unavailable. The action rules above are verified; exact transfer screen
interactions and iPhone comparison remain open.

## Device persistence

Source chain in the common bundle:

| Module | Role |
| --- | --- |
| 1685 | State store and persistence setup |
| 1773 | Profile-split serialization, scheduling, flush, and recovery |
| 3527 | AsyncStorage export |
| 3568 | Web implementation calling `window.localStorage` |

The persistence layer waits 400 ms after scheduling a save. It serializes
changed profiles as JSON and writes each profile key before the top-level
metadata key. The format marker is `profile-split-v1`. Calls are queued, and
an explicit flush waits for queued writes. Save failure retains pending state
for retry and produces a visible failure state.

The reader distinguishes missing, corrupt, recovered, legacy, and split data.
It attempts to retain unreadable payloads. When storage cannot be opened, the
store presents a message that saving is disabled to avoid overwriting existing
device data. These are observed recovery branches, not tested failure outcomes.

No multi-key transaction surrounds the profile and metadata writes in the
traced web adapter. The synchronous localStorage calls are wrapped in Promises;
that wrapper does not make the sequence a database transaction. This trace
does not assess the native app's storage implementation.

Kuwi's accepted 3NF and ACID requirements therefore need a separate data and
persistence design. Copying the profile-snapshot format would not establish
those guarantees. Cross-device conflict behavior remains unresolved.

## Account creation and editing

Source: static inspection of account action module 1731, store module 1685,
currency helper modules 1701 and 1709, and Wallet/account-drawer chunks. The
focused files and their source and extracted hashes are retained in
`/Users/drei/Library/Caches/kuwi-research/tarsi-focused-modules-20261107/`;
the selected account-drawer chunk is recorded in
`/Users/drei/Library/Caches/kuwi-research/tarsi-web-lazy-20261107/provenance.json`.
The additional drawer extraction used for this pass is
`/tmp/kuwi-account-drawer.js`; its checked rule summary is
`/tmp/kuwi-account-rule-verification.md`. These are code traces, not runtime or
iPhone observations.

The account action branches on Debit, Credit, Loans, Assets, Stocks, and Crypto.
Stocks and Crypto require investment access to be unlocked. Ordinary
non-credit, non-investment creation clamps a negative amount to zero. A positive
starting balance creates an initial balance adjustment; zero creates none.
Credit stores a separate limit and current owed balance. A positive owed amount
also creates an initial adjustment. Investment balances use units multiplied
by price, and loan updates rebuild their payment schedule.

The account drawer defaults a new account to Debit, the preferred currency, an
empty name, and zero amount. It trims and rejects a blank name. It has no
duplicate-name comparison in the traced submit handler. Its currency control
opens a separate currency settings route; that route's option list was not
verified. Existing accounts with linked activity have currency locked. For
ordinary debit edits with linked activity, the submit handler retains the
existing balance and the store also protects the currency. Credit limit edits
remain possible with linked activity. Investment purchase history blocks
specific changes to investment identity and units. Loan-specific edit outcomes,
the complete tracked-balance field set, and the exact linked-activity helper
remain unresolved.

Currency amount formatting uses zero decimal places for JPY, KRW, and CLP,
three for KWD, BHD, and OMR, and two for other listed currencies. The account
currency route's supported list and native behavior still need verification.
See [the account data model](account-data-model.md) for the bounded Kuwi
behavior implemented from these findings.

## Ordinary transaction edits and deletions

Checked 2026-11-07 from the expense entry chunk (Metro module 2591), income
entry chunk (module 2617), and store module 1685. The expense chunk is
`add-expense-940caf825558b98d213bfca3fef5e6bd.js` with SHA-256
`98677be132d94743c935cf788959c44ff21ffe3829226355dc21f7cdbdeb0c83`. The
income chunk is `add-income-c54847041456330b5c6bb44f04331180.js` with SHA-256
`4ae172ffa99f05be1a4a840b8a9368b0f9154656eb686b4b7091aa7c95d5520e`. The
income route map and direct dependencies are in
`/Users/drei/Library/Caches/kuwi-research/tarsi-income-20261107/provenance.json`;
the expense chunk provenance is in
`/Users/drei/Library/Caches/kuwi-research/tarsi-web-lazy-20261107/provenance.json`.
Both chunks depend on store module 1685. Currency rounding, balance effects,
and category data come from modules 1701, 1709, 1728, and 1730. These are static
web code traces. The target code was not executed, and iPhone 2.5.9 behavior is
not established.

The store's `updateExpense` path reverses the old posted effect on its original
account, reverses linked cashback income, builds the replacement while keeping
the expense ID and creation time, applies an eligible replacement effect, and
reconciles recurring or installment state. `deleteExpense` reverses a posted effect and
removes the expense. Its extra paths remove linked cashback income and
installments; loan and installment relationships can block deletion. The
ordinary expense entry UI also exposes an `expenseId` edit route and calls the
store's update and delete methods.

The store's `updateIncome` path reverses the old posted effect, builds the
replacement with the same ID and creation time, posts an eligible replacement,
and updates related goal, receipt, and recurring state. `deleteIncome` reverses
the old posted effect, removes the income, clears cashback and receipt
references, and reconciles recurring income. The ordinary income entry UI uses
an `incomeId` edit route and calls these same store methods. These linked
behaviors identify records that need coordinated changes in Tarsi. Kuwi's
bounded one-time ledger has no cashback, receipt, goal, recurring, installment,
or loan child records, so this implementation does not invent those
relationships.

Kuwi replaces an ordinary expense or income row in one SQLite transaction,
preserving its transaction ID and creation time. The same transaction records a
fingerprinted edit receipt. A delete removes the transaction and its create
sync marker while adding a delete tombstone. Identical retries reuse their
operation ID; reusing one with different content fails. Balances are derived
from transaction rows, so replacing an account or amount changes the old and
new account balances at the same commit. The UI permits account moves only
between same-currency accounts and supports category, amount, date, and note
replacement. It accepts current and past expenses and posted income. Planned
income edits are blocked pending the separate date-boundary work in ticket #7.
Transfer editing is outside this ticket.

For a derived expense calculation, begin with Debit accounts A = ₱1,000 and B =
₱200. Posting a ₱12 expense to A gives A = ₱988. Editing it to ₱20 on B gives A
= ₱1,000 and B = ₱180. Deleting it returns B to ₱200. For income, posting ₱25
to A gives A = ₱1,025. Editing it to ₱35 on B returns A to ₱1,000 and gives B =
₱235. Deleting it returns B to ₱200. These are arithmetic examples from the
traced balance rules, not observed Tarsi runs.

The edit/delete trace establishes the shipped web store paths only. It does not
confirm iPhone behavior, transfer corrections, cross-currency replacement, or
how future-dated income changes from planned to posted. Those remain explicit
acceptance blockers.

## Next evidence needed

- Extend the observed iPhone first-run path with validation and currency edge cases.
- Trace built-in category overrides, budget cycles, advanced linked transaction
  corrections, and currency edge cases before defining their acceptance
  criteria.
- Trace cloud snapshot synchronization and observe conflicting edits before
  accepting a conflict policy.
- Inventory the remaining screens, gestures, and mascot assets. No complete
  project or asset set has been recovered.
