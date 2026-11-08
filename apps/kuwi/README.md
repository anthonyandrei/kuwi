# Kuwi product app

The local finance app is separate from the disposable storage probe. It uses
Expo, React Native Web, Expo Router, Reanimated, and the supplied quokka
reference with cream and sage colors. It supports local setup, accounts,
expenses, income, planned entries, offline cross-currency transfers, category
budgets, and versioned backup/restore. Transaction history supports editing and
deleting entries, with an explicit Log action for planned expenses and income.
Local use requires no sign-in.

From the repository root:

```sh
pnpm install
pnpm check
node apps/kuwi/scripts/serve.mjs
```

Open http://127.0.0.1:4183. The static export includes the worker, pinned SQLite
WASM, manifest, icons, and a service worker that caches startup files. Expo's
development server does not produce the offline installation bundle.

`pnpm check` runs the configured lint, TypeScript, static build, and all product
browser journeys. CI runs the same command on pushes and pull requests. It does
not deploy. On a new machine, install browsers first:

```sh
pnpm exec playwright install chromium webkit
```

After building, rerun the product journeys from the repository root with
`pnpm test`. The server resolves its export relative to its script, so it also
works when launched from the app directory.

Tests use real OPFS, a unique loopback hostname and port for each journey, and
a fresh disk-backed profile for each WebKit journey. The unique host keeps
WebKit's origin-scoped OPFS data isolated across test runs, even after a profile
is removed. A local test server can alter the served worker to inject write or
migration failures, interrupt an active transaction, or lose a save reply.
These controls are absent from the exported production app. The tests assert
visible setup, balances, transaction corrections and deletions, rollback and
retry, ownership handoff, and offline reopening after browser closure.

Upgrade journeys serve prior product shells and workers first, then switch the
same origin to the current app. The setup-era v1 build checks schema migration,
worker ownership handoff, retained balance and history, and an offline write.
The populated v3 build carries an expense and an exported backup through the
shell update, restores that backup, then reopens offline. A separate v1
migration failure injects an error after the migration statements run, so the
transaction must restore the old schema before a retry. The quota journey
checks the visible error and confirms that the saved account remains available
after retry.

Backup export downloads the versioned JSON contract described in
[`finance-storage.md`](../../docs/finance-storage.md#backup-contract).
Restore uses the browser's file picker and validates contents regardless of the
file extension or reported MIME type. Candidate data is checked before an
atomic replacement; failure leaves the existing local ledger available. The
Chromium and disk-backed WebKit journeys cover real downloads, file selection,
rejected candidates, valid round trips, rollback after replacement begins, and
offline reopen followed by another write. In the simulator, the first restore
attempt showed a blank picker. A later retry listed the exported JSON in Files
and accepted it.

The database uses product-specific OPFS paths and a Web Lock acquired before
opening files. It never opens the probe's files. Startup preserves existing
files and displays failures without a fallback ledger. Closing the database
releases file handles before the ownership lock. Another tab can then retry
opening the same saved account. Safari and the installed Home Screen app have
separate stores.

The strict SQLite schema normalizes currencies, profiles, accounts, setup,
adjustments, categories, expenses, incomes, transfers, budgets, and pending
operations. Planned entries stay out of balances and budget progress until
they are logged. Balances and budget progress derive from canonical records
rather than stored totals. Transfer principal is excluded from spending; its
linked fee expense counts once. Setup, finance writes, budget saves or clears,
and their pending operation records commit atomically. Stable operation IDs let
a retry find the committed change or reject changed content under the same ID.
A missing save reply terminates the worker after 15 seconds so a retry can
check whether the write committed. Schema versions and migration paths are
documented in [local finance storage](../../docs/finance-storage.md). Local use
has no Clerk or Convex dependency.

The recovered planned-entry, budget, and transfer rules come from static Tarsi
WEB code. Kuwi keeps future-dated entries planned across reopening and requires
an explicit Log action. The native Tarsi iPhone 2.5.9 reference was unavailable
for this work. Kuwi's budget screen covers built-in expense categories; custom
and hidden categories, subcategory budgets, and Pro entitlements are outside
the current app. Cross-currency progress stays unavailable because Kuwi has no
exchange-quote source. Monthly budget cycles use a saved start day from 1 to 31,
defaulting to day 1. Short months use their last day when the selected day does
not exist.

The iPhone simulator is the development acceptance target for planned entries,
transfers, budgets, and backup round trips.

The six observed currency tiles are PHP, USD, EUR, GBP, JPY, and TWD. PHP, Cash,
and zero are the defaults. JPY uses whole units; the other enabled currencies
use two fractional digits. The number pad ignores a third fractional digit,
matching the observed PHP 1,234.56 example. Invalid pasted decimal text is
rejected. Native observations and separate shipped-web evidence are recorded
in [the onboarding notes](../../docs/tarsi-iphone-onboarding.md).

## Vercel hosting

Anthony selected Vercel on 2026-11-07. The Kuwi project belongs to
`anthonyandreitan-7469s-projects` and is linked locally through ignored
`.vercel/project.json`. The app is available at https://kuwi-ten.vercel.app.
The first deployment became production despite an explicit preview target;
no existing deployment was replaced. Later deployments should use preview
unless promotion is explicitly intended.

Before any deployment, verify the authenticated Vercel account, the selected
scope, and the linked project against the values above. Confirm that the user's
approval covers that destination and preview or production target. Check the
returned deployment metadata for its actual target before sharing the URL.
If the target differs, report it and stop further publication until resolved;
a successful upload alone does not prove that a preview was created.

`vercel.json` defines the workspace build and output directory. To upload
only a locally built static export:

```sh
pnpm --filter @kuwi/app build
node apps/kuwi/scripts/prepare-vercel.mjs
vercel deploy --prebuilt --target=preview --scope anthonyandreitan-7469s-projects
```

The packaging script replaces only its generated `.vercel/output/static`
directory and carries the service-worker revalidation header into Vercel's
Build Output configuration. Local Vercel credentials and environment files
are ignored. The earlier Cloudflare storage probe remains a separate test.
No Cloudflare product deployment or storage migration was needed.

## Validation on 2026-11-08

`npm exec --yes --package=pnpm@11.25.0 -- pnpm check` passed lint, TypeScript,
the static build, ten unit tests, and 176 Playwright journeys: 88 in Chromium
and 88 in disk-backed WebKit. WebKit retained OPFS data for the same origin
after a persistent context closed and a second profile opened. Each journey
uses a unique `.localhost` hostname so a reused port cannot expose another
journey's database.

Coverage includes both v7-to-v8 migration layouts and both populated v8-to-v9
layouts, planned-entry logging and date rules, overdue edits and deletion,
backup validation, retries and rollback, and offline reopening. Cross-currency
checks preserve source and received minor-unit amounts, canonical decimal
rates, transfer receipts, and budget definitions. The verified WEB rules for
planned entries are accepted for this stage. The simulator finance checks below
cover planned entries, transfers, budgets, income, and Files backup flows.

A prior physical iPhone run verified installation and offline reopening. A
populated Safari ownership handoff also passed, as described below. The iPhone
18 Pro simulator on iOS 27.2 (build 24B8117) completed the deployed Safari
setup using the software keyboard.
The name field remained visible, and the keyboard's Next key advanced to the
introduction. Its page Next button sat under the keyboard accessory bar;
keyboard Next or dismissal provided a working route forward. The currency list
scrolled to Next and Back. The decimal keyboard accepted input, its dismissal
restored the form, and the custom number pad fit with Done reachable. Saving
showed Anthony's Cash account at PHP 0.00. No transition became stuck.

Kuwi uses the observed sequence and defaults with its own cream/sage layout and
quokka artwork. This verifies usable setup transitions, not identical Tarsi
animation timing or artwork. Blank-name validation and non-PHP precision still
come from the separate shipped-web evidence, not new native observations.
The simulator finance checks below record income entry and Files behavior.
Browser journeys do not establish installed-app picker or download behavior.

### iPhone 18 Pro simulator finance acceptance on 2026-11-08

On the booted iPhone 18 Pro simulator running iOS 27.2, Safari opened the
local app at `http://127.0.0.1:4183/`. The test ledger began with Cash at
NT$100,000 and USD wallet at US$5,000. Renaming Cash to Cash test and creating
a Cash 2 debit account with a zero TWD opening balance both saved successfully.

A Food expense dated 2026-11-12 remained planned and left the balance at
NT$100,000. Logging it on 2026-11-08 reduced the balance by NT$1,200. Editing
the entry to NT$1,300 updated the balance to NT$98,700; deleting it restored
NT$100,000. A NT$5,000 income was changed to Salary at NT$5,500, appeared in
history with the corrected category and amount, then was deleted. The balance
returned to NT$100,000.

A Food monthly budget of NT$5,000 for November showed NT$1,200 spent, 24%, and
NT$3,800 remaining after a new NT$1,200 expense. A same-currency transfer of
NT$1,000 from Cash test to Cash 2 saved, leaving NT$97,800 and NT$1,000 in the
respective accounts. A TWD-to-USD transfer also saved with NT$1,000 sent,
US$1,000 received, and a manually entered 1:1 exchange rate. This exercised
the cross-currency flow; it did not check rate accuracy. The resulting account
list showed Cash test at NT$96,800 and USD wallet at US$6,000.

Safari downloaded `kuwi-backup-2026-11-08.kuwi.json`. The simulator Files app
listed the JSON file at about 9 KB. The first Restore attempt opened a blank
picker. On retry, Files showed the backup in Recents; selecting it returned to
Kuwi. The account list showed Cash test at NT$96,800, USD wallet at US$6,000,
and Cash 2 at NT$1,000 after the restore flow.

A further iPhone restore attempt selected a 23-byte unsupported backup JSON
(`{"not":"a Kuwi backup"}`) from Files. Kuwi returned to the account list,
where Cash test remained at NT$96,800, USD wallet at US$6,000, and Cash 2 at
NT$1,000. No visible rejection message appeared in the account or backup view,
so invalid-backup failure feedback failed this simulator check.

Adding Kuwi to the Home Screen with Open as Web App enabled succeeded. With the
local server stopped, the app displayed its offline welcome screen and
"Continue offline" opened setup. The welcome copy says Safari and the Home
Screen app keep separate local data. Setup as QA with the default PHP Cash
account at ₱0.00 succeeded. After force-closing Kuwi from the iOS app switcher
and reopening it from Spotlight while the server was still stopped, the app
showed a blank white screen during startup, then loaded Welcome, QA and Cash at
₱0.00. This verifies that the Home Screen app reopened offline with its saved
account.

In Safari, numeric input worked after a field received focus, account
navigation worked, and the page scrolled vertically. The keyboard covered
lower form controls until the page was scrolled, and the Safari bar overlapped
the form at its top scroll position. No motion-specific comparison was
completed. The native Tarsi iPhone 2.5.9 reference was unavailable, so motion
timing and parity remain unverified.

A native Expo Release build also installed and launched in the simulator. It
showed `Property 'Worker' doesn't exist` and an "Unable to open your data"
screen. Native app acceptance is blocked because the database startup expects
the browser Worker API.

Simulator checks are the development acceptance target. Issues #1 and #3
through #11 remain open with their statuses unchanged; a read-only GitHub
review on 2026-11-08 confirmed their current state. `pnpm check` was not run
per instruction, so the issue closure checklist remains incomplete. Anthony
plans to try the deployed app and report any issues after deployment; that
device feedback does not block development.

## Vercel verification on 2026-11-07

The HTTPS deployment passed setup, saved-account, and offline-reload smoke
checks in Chromium and disk-backed WebKit, with no JavaScript page errors.
Nine published shell, worker, WASM, manifest, and image files matched the local
build byte for byte. The service worker returns `Cache-Control: no-cache` and
SQLite WASM returns `application/wasm`. An ephemeral WebKit context could not
open storage; the disk-backed check uses the established test approach.

Earlier iPhone Mirroring attempts timed out. After reconnection, the app was
installed from Safari using Add to Home Screen with Open as Web App enabled.
The standalone app opened, accepted the preferred name Anthony, allowed
skipping the introduction, and showed PHP/Cash/zero defaults. Its custom
number pad displayed 1234.56 after entering 1234.567. The amount was returned
to zero before saving, and the app showed Anthony's Cash account at PHP 0.00.
No sign-in was used. Fast text injection through Mirroring scrambled input;
individual key presses entered the intended name. This does not verify the
phone's software keyboard. Anthony then confirmed a successful full closure
and Home Screen reopening
in Airplane Mode with Wi-Fi off: the account remained at PHP 0.00 and setup
did not repeat. After connectivity was restored, Mirroring visibly showed the
retained account.

In Safari, duplicating the Kuwi tab showed Database busy. Closing the owner
tab and selecting Retry opening in the second tab succeeded. The first handoff
used a fresh Safari store, separate from the initialized Home Screen store.
A subsequent run saved Anthony and Cash at PHP 0.00 in Safari, duplicated the
tab, verified Database busy, closed the owner tab, and retried. The second tab
opened the saved account without repeating setup. Populated Safari handoff
therefore passed.

## iOS testing

Before requesting manual phone work, check the local tools and runtimes:

```sh
xcode-select -p
xcrun simctl list runtimes
xcrun simctl list devices available
```

Use an existing iOS runtime and device when available. If none is installed,
inspect `xcodebuild -help` for the supported download options,
then select one compatible runtime explicitly with
`xcodebuild -downloadPlatform iOS -buildVersion <version> -architectureVariant arm64`. Inspect the result before retrying;
a usable runtime does not need another download. Boot the selected device with
`xcrun simctl boot <device-UDID>` and wait with
`xcrun simctl bootstatus <device-UDID> -b`.

Discover the installed simulator application under the selected Xcode bundle.
On the verified Xcode 27.2 installation it was DeviceHub.app under
`Contents/Applications`, rather than the older Simulator.app path. Use the UI
control tool for interaction. In the device Keyboard menu, enable the software
keyboard with a focused input; check Keyboard Capture and Simulate Hardware
Keyboard when typing or clicks behave unexpectedly. Let the screen settle
before judging a transition.

Use a fresh Simulator Safari store for the setup journey. Check the name field
with the software keyboard open, keyboard Next and dismissal, currency-list
scrolling, the decimal keyboard, and the custom number pad's Done button.
Save and reopen the account. Record the runtime/build, device, URL, and observed
results against the issue criteria. Chromium/WebKit automation covers storage
recovery and persistence but does not establish iOS keyboard behavior.

Use the booted simulator for routine acceptance. When feasible, add Kuwi to the
Home Screen and check keyboard input, navigation, layout, motion, close and
reopen, offline use, and Files. Preserve existing saved accounts. If the
simulator blocks a check, record it as unverified and continue development.
Restore connectivity after an offline check. Device feedback after deployment
is follow-up and does not block development.

## Checks after the session retro

Lint now uses a committed Expo flat configuration and pinned dependencies,
invoked directly through ESLint. Startup uses its existing initial loading state;
explicit retries reset loading and error state in the button handler. This
removes the synchronous state reset from the startup effect. The earlier lint
gap above records the original issue-closure state.
