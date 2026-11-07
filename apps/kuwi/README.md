# Kuwi product app

Issue #2's local setup app is separate from the disposable storage probe.
It uses Expo, React Native Web, Expo Router, Reanimated, and the supplied third
quokka reference with cream and sage colors. Local use requires no sign-in.

From the repository root:

```sh
pnpm install
pnpm --filter @kuwi/app typecheck
pnpm --filter @kuwi/app build
cd apps/kuwi
node scripts/serve.mjs
```

Open http://127.0.0.1:4183. The static export includes the worker, pinned SQLite
WASM, manifest, icons, and a service worker that caches startup files. Expo's
development server does not produce the offline installation bundle.

After building, run the product journeys from `apps/kuwi`:

```sh
pnpm exec playwright test --config playwright.config.mjs
```

Tests use real OPFS, an independent loopback origin for each journey, and disk
profiles for WebKit. A local test server can alter the served worker to inject
write/migration failures, interrupt an active transaction, or lose a save reply. These controls are absent from
the exported production app. The tests assert visible setup, balances,
rollback/retry, ownership handoff, and offline reopening after browser closure.

The database uses product-specific OPFS paths and a Web Lock acquired before
opening files. It never opens the probe's files. Startup preserves existing
files and displays failures without a fallback ledger. Closing the database
releases file handles before the ownership lock. Another tab can then retry
opening the same saved account. Safari and the installed Home Screen app have
separate stores.

The schema stores currencies, profiles, accounts, and one setup completion
record. Each table has an explicit primary key. Currency precision depends
only on currency code; profile preferences depend on profile ID; opening
balance and currency depend on account ID. Setup references its profile and
first account. No derived display balance, duplicated currency metadata, or
profile snapshot is stored. Related setup inserts share one immediate SQLite
transaction. Stable local profile/account keys and a singleton completion
record make retries return the committed setup without another opening record.
A missing save reply terminates the worker after 15 seconds and exposes a retry.
Retrying checks canonical setup before inserting. Local setup has no Clerk or
Convex dependency.

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

## Validation on 2026-11-07

TypeScript, JavaScript syntax, and diff checks pass. All 18 Chromium/WebKit
journeys passed, including interruption during an active transaction. The
interruption test exercises visible Retry opening while Chromium releases the
terminated worker's ownership lock, then verifies a single saved account.
Standards and spec reviews found no actionable findings in the final test change.
The app had no ESLint configuration. Expo's automatic lint setup failed its own
version check; running the generated configuration directly reported the
existing synchronous state reset in the startup effect (`index.tsx:54`). The
automatically generated configuration and dependency changes were removed.
Lint is not a passing check.

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
Backup/restore and later finance journeys remain work under the parent issue.

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
