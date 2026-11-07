# PWA storage research

Updated: 2026-11-07. The disposable SQLite/OPFS validation is complete.

The [test results](pwa-storage-test-results.md) cover Chromium, disk-backed
Playwright WebKit, and Anthony's physical iPhone checks. Use the tested
`@sqlite.org/sqlite-wasm@3.54.1-build1` release with OPFS SAHPool for the first
Expo integration, then repeat the checks on the full app.

Kuwi needs offline use without login, strict logical 3NF, and ACID for related
local writes. Convex synchronization has its own transaction boundary.

## Candidates

| Candidate | Fit | Work still required |
| --- | --- | --- |
| SQLite compiled to WebAssembly, persisted in OPFS | SQL constraints and transactions fit the existing relational data requirements. OPFS is the browser's private file storage. | Choose and pin a supported SQLite/VFS release; validate worker startup, file ownership, transaction recovery, and Safari/Home Screen behavior. |
| IndexedDB | Browser object stores support transactions across the stores included in a transaction. Normalized records can reference IDs. | Application code must enforce relationships and data rules that SQL can express as constraints. Verify durability options and transaction completion on the target browsers. |
| localStorage profile JSON | Matches Tarsi's traced web adapter. | The traced sequential key writes do not provide a transaction across related data. It does not meet Kuwi's accepted persistence design without substantial changes. |

SQLite's official [browser persistence documentation](https://sqlite.org/wasm/doc/tip/persistence.md)
describes several storage adapters, called VFSes. The `opfs` adapter requires
SharedArrayBuffer support and COOP/COEP response headers. Its documented Safari
compatibility starts at version 17. The `opfs-sahpool` alternative supports
older Safari versions and avoids those headers, but concurrent tabs need
application-level coordination. `opfs-wl` adds Web Locks and requires
`Atomics.waitAsync()`. It is not an automatic compatibility upgrade.

The documentation also describes data-preservation options and version-specific
locking fixes. In its current tip, `preserveOnInitFailure` defaults to false:
initialization failure can remove underlying SAHPool storage. A persistent
finance app must explicitly resolve that behavior in the exact release it
ships. The tip documentation includes features marked for 3.54; package
availability and behavior must be checked against a selected release before
using them. The test now pins the published `3.54.1-build1` package and verifies
the runtime version. The full Expo app still needs integration validation.

For IndexedDB, the requested
[`strict` durability mode](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/durability)
is a hint to the browser. A successful request is not the same as a committed
transaction; the application must wait for
[transaction completion](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/complete_event).

## Persistence and recovery

[WebKit's storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/)
covers IndexedDB, file storage, service workers, and other site data. Storage
starts in best-effort mode and can be evicted. Home Screen installation affects
the heuristics for granting a persistent-storage request; it does not guarantee
that the request succeeds. Users can still clear site data.

The implementation needs to check persistence status, request persistent
storage, handle quota errors, and provide export/restore. Local use must remain
possible without Clerk or Convex. Cloud sync and backups are separate from the
question of whether a local transaction committed.

## Accepted validation step

Evaluate SQLite WebAssembly with OPFS first in a disposable browser prototype.
Choose the exact adapter after testing the supported iPhone Safari version.
Keep one database owner until concurrent-tab behavior is proved safe. Do not
use a second storage backend as a silent fallback that opens an apparently
empty ledger.

The prototype should demonstrate offline reopening after initial installation,
atomic account/entry/outbox writes, committed-data survival after closing and
reopening, database migration failure recovery, and clear handling of a second
tab or window. It should also export and restore a backup. Desktop browser
checks can precede the physical iPhone check but cannot substitute for it.

This recommendation reopens the implementation in
[ADR-0004](adr/0004-use-sqlite-for-offline-storage.md), as authorized by
[ADR-0007](adr/0007-deliver-kuwi-as-a-pwa.md). It does not change the accepted
Convex, Clerk, normalization, or transaction requirements.
