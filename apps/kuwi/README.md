# Kuwi product app

The local finance app is separate from the disposable storage probe. It uses
Expo, React Native Web, Expo Router, Reanimated, and the supplied quokka
reference with cream and sage colors. It supports local setup, accounts,
expenses, ordinary income, offline cross-currency transfers, category budgets,
and versioned backup/restore. Transaction history supports editing or deleting
posted expenses and income; planned-income editing remains blocked pending
rule verification. Local use requires no sign-in.

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
offline reopen followed by another write. Export and restore through Files in
the installed iPhone app still need physical-device acceptance.

The database uses product-specific OPFS paths and a Web Lock acquired before
opening files. It never opens the probe's files. Startup preserves existing
files and displays failures without a fallback ledger. Closing the database
releases file handles before the ownership lock. Another tab can then retry
opening the same saved account. Safari and the installed Home Screen app have
separate stores.

The strict SQLite schema normalizes currencies, profiles, accounts, setup,
adjustments, categories, expenses, incomes, transfers, budgets, and pending
operations. Balances and budget progress derive from canonical records rather
than stored totals. Transfer principal is excluded from spending; its linked
fee expense counts once. Setup, finance writes, budget saves or clears, and
their pending operation records commit atomically. Stable operation IDs let a
retry find the committed change or reject changed content under the same ID.
A missing save reply terminates the worker after 15 seconds so a retry can
check whether the write committed. Schema versions and migration paths are
documented in [local finance storage](../../docs/finance-storage.md). Local use
has no Clerk or Convex dependency.

The recovered budget and transfer rules come from static Tarsi WEB code. Tarsi
iPhone 2.5.9 acceptance remains pending. Kuwi's budget screen covers built-in expense
categories; custom and hidden categories, subcategory budgets, and Pro
entitlements are outside the current app. Cross-currency progress stays
unavailable because Kuwi has no exchange-quote source. Monthly periods start
on day 1; Kuwi does not expose the WEB reference's configurable start day. A
real-persistence budget journey passes in Chromium and disk-backed WebKit.
Physical iPhone acceptance for transfers, budget screens and calculations, and
backup round trips remains pending.

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
the static build, five budget calculation tests, and 122 Playwright journeys
against real OPFS storage: 61 in Chromium and 61 in WebKit. WebKit retained
OPFS data for the same origin after a persistent context closed and a second
profile opened. Each journey uses a unique `.localhost` hostname so a reused
port cannot expose another journey's database.

Coverage includes budget creation, corrected-ledger progress, percentage
income limits, transfer fees, zero clears, version 7 backup export and restore,
atomic failure recovery, stable retries, and offline reopen. The wider suite
also checks income posting, transaction corrections and deletion, backup
validation, migration recovery, and another offline write. Physical iPhone
Files, budget, and income acceptance remain pending.

These browser results predate the current cross-currency transfer changes. The
transfer journeys still need the sequential integration run.

Physical iPhone installation, offline reopening, and populated Safari ownership
handoff passed as described below. The iPhone 18 Pro simulator on iOS 27.2
(build 24B8117) completed the deployed Safari setup using the software keyboard.
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
Physical iPhone Files export and restore, income entry, and later finance
journeys remain outstanding. Browser journeys do not establish installed-app
picker or download behavior.

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

Use a physical iPhone for Add to Home Screen installation and a full app closure
followed by offline reopening from its icon. Preserve existing saved accounts.
Try the available Mirroring controls before requesting user action; explain the
specific check that requires the phone when a manual step remains necessary.
Restore connectivity after an offline check. Simulator observations do not
replace this physical installation evidence.

## Checks after the session retro

Lint now uses a committed Expo flat configuration and pinned dependencies,
invoked directly through ESLint. Startup uses its existing initial loading state;
explicit retries reset loading and error state in the button handler. This
removes the synchronous state reset from the startup effect. The earlier lint
gap above records the original issue-closure state.
