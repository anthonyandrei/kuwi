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

## Remaining acceptance work

HTTPS publication requires Anthony's approval under the parent specification.
No product deployment has been made. Installation, phone layout/motion and
keyboard comparison, full app closure, and offline reopening on the physical
iPhone remain required before closing #2. Desktop WebKit passes cannot replace
those checks. This app does not implement backup/restore or later finance
journeys, which belong to subsequent work under the parent issue.

## Validation on 2026-11-07

The product export, TypeScript, JavaScript syntax, and diff checks pass.
The full Chromium/WebKit suite passed 16 checks. After separating the lost-reply
and browser-closure journeys to isolate fault injection from precaching, all
four focused checks passed in both engines. The suite now contains nine
journeys per engine. The PHP keypad example and interruption during an active
transaction passed in both engines in the full run.

Standards review found no actionable code defects. Spec review prompted the
save timeout, visible retry, and interrupted-transaction test. The installed
iPhone checks above remain outstanding. These results do not close issue #2.
