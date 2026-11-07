# Disposable browser storage test

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm storage:dev
```

Open <http://127.0.0.1:4173>. It starts a separate prototype Cash account with
₱1,000.00. Use scratch entries only. No authentication, cloud synchronization,
or Tarsi code is included. The temporary HTML interface does not replace the
accepted Expo client stack.

The page exposes the current database state and manual checks. Wait for
`Offline ready` before disconnecting. The reset button deletes scratch entries
from this prototype database only. Closing the database releases its lock;
reopening uses the same origin's data. Opening a competing tab reports a busy
database instead of creating a fresh ledger.

```sh
pnpm exec playwright install chromium webkit
pnpm storage:test
pnpm storage:build
```

The build command copies the test and pinned SQLite assets into `.local/dist/`.
It also writes content hashes. Serve that directory at the root of a dedicated
HTTPS origin for physical iPhone testing. The development server binds to
loopback only. An HTTP LAN address on the phone is not a substitute for HTTPS.
Anthony approved the scratch test deployment on 2026-11-07. The test is live at
[kuwi-storage-probe.pages.dev](https://kuwi-storage-probe.pages.dev), hosted in
his verified personal Cloudflare account. This chooses a test host only;
production hosting remains undecided. Scratch entries stay in the browser.

For iPhone checks, open that address in Safari, wait for `Offline ready`, and
follow the page's **iPhone checks** checklist. Check Safari and the installed
Home Screen app separately. The Mac browser results do not cover the phone.

## What the test stores

`accounts` contains the account's name, currency, and opening amount. `expenses`
references the account by ID and stores integer centavos. `outbox` references
each expense once as a pending operation. Account balances are a SQL view
computed from the opening amount and expenses; no second mutable balance is
stored. Expense creation and its pending operation use one SQLite transaction.

SQLite runs in a dedicated worker with the SAHPool OPFS adapter. A Web Lock
covers initialization and the whole database lifetime. The pool uses a scratch
directory, preserves existing storage after initialization failure, and never
clears files on startup. Foreign keys are enabled. The rollback journal and
`synchronous=FULL` are explicit. There is no fallback store.

Backup export produces a SQLite file. Restore reads the candidate in a separate
file, checks its version and integrity, then copies records into the existing
schema in one transaction. Invalid candidates leave existing records intact.
The test does not accept general SQLite files as production imports.

The restore picker shows all files because iOS can disable backups when an
extension/MIME filter is present. Select the exported prototype backup; the
worker still validates its contents. After the v2 update, an existing installed
test may need an online opening followed by closing and reopening to display
the new shell. The restore help text starts with `All files are shown`.

`window.storageProbe` is an intentional browser-test API. Its unfinished-write
command is used only to terminate the worker or tab and check recovery. This
API and fault controls must not ship in the finance app.

## Validation limits

See [the results](../../docs/pwa-storage-test-results.md) for browser versions,
checks, and user-reported physical iPhone results. This prototype does not establish a full
finance schema, a sync protocol, general power-loss durability, or permanent
protection from browser storage eviction.
