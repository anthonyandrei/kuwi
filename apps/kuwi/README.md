# Kuwi product app

This is the initial PHP setup slice for issue #2, separate from the disposable
storage probe. Issue #2 remains incomplete. Additional currencies, reference
validation, full onboarding/motion fidelity, failure/interruption tests, and
physical Home Screen installation/offline closure checks remain outstanding.

From the repository root:

```sh
pnpm install
pnpm --filter @kuwi/app typecheck
pnpm --filter @kuwi/app build
cd apps/kuwi
node scripts/serve.mjs
```

Open http://127.0.0.1:4183. The static export includes the worker, SQLite WASM,
manifest, icons, and a service worker. HTTPS hosting is required for a phone;
no deployment has been made or hosting provider selected. Development through
Expo does not produce the offline installation bundle.

Run browser journeys after building:

```sh
pnpm exec playwright test --config apps/kuwi/playwright.config.mjs
```

The database uses product-specific OPFS paths and a product-specific Web Lock.
It never opens the probe's files. Startup preserves existing files and displays
errors without a fallback ledger. Close database releases file handles before
the ownership lock. Another tab can then retry opening the saved account.
Safari and the installed Home Screen app have separate stores.

The schema stores currencies, profiles, accounts, and one setup completion
record. Each table has an explicit primary key. Currency precision depends
only on currency code; profile preferences depend on profile ID; opening
balance and currency depend on account ID. Setup references its profile and
first account. No derived display balance, duplicated currency metadata, or
profile snapshot is stored. Related setup inserts share one immediate SQLite
transaction. A repeated completion returns the already committed setup and
never inserts a second opening account. Local setup has no cloud dependency.

Only the observed PHP path is enabled. Its default is Cash with zero opening
balance. The amount input currently rejects more than two decimal places;
Tarsi uses a calculator that ignored a third decimal digit in the observed
example. This is an explicit fidelity gap, not verified equivalent behavior.
The iPhone observations are in ../../docs/tarsi-iphone-onboarding.md.

The quokka image is the third reference supplied by Anthony in the planning
chat. No Tarsi source or artwork is included.

## Validation on 2026-11-07

TypeScript typechecking and JavaScript syntax checks passed. The two-axis
review identified missing acceptance criteria; issue #2 remains open. The
mechanical UI detector reported no findings. Runtime product tests could not
run: both Expo export attempts stalled before producing an HTML entry. The
second attempt used one worker and disabled minification. The host reported a
load average above 200 and 94 MB unused memory during investigation.

The existing disposable probe's 12 Chromium checks passed. WebKit then suffered
repeated timeouts, and that suite was interrupted. Those probe results do not
validate the new product app. Neither a successful product export nor phone
installation/offline reopening has been established. No deployment occurred.
