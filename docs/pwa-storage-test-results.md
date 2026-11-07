# PWA storage test results

Checked: 2026-11-07

The disposable test uses `@sqlite.org/sqlite-wasm@3.54.1-build1`, pinned in the
pnpm lockfile. Its runtime reports SQLite 3.54.1. The selected test adapter is
OPFS SAHPool, with `clearOnInit=false` and `preserveOnInitFailure=true`. This is
the adapter selected for the first Expo integration after the checks below.
Product app checks are recorded in the final section.

## Automated checks

Command: `pnpm storage:test` with Playwright 1.65.0 on this Mac.

| Check | Chromium 158.0.8127.18 | Playwright WebKit 27.2 |
| --- | --- | --- |
| Opens OPFS without cross-origin isolation; verifies version, foreign keys, and full synchronization | Passed | Passed |
| Commits expense and pending operation; derives balance; prevents duplicate retry | Passed | Passed |
| Rolls back an injected failure between related writes | Passed | Passed |
| Rejects an unknown account and invalid centavo amounts | Passed | Passed |
| Rolls back failed migration and schema version change | Passed | Passed |
| Recovers after worker termination during an unfinished write | Passed | Passed |
| Recovers after tab closure during an unfinished write | Passed | Passed |
| Blocks a competing tab; releases ownership without changing data | Passed | Passed |
| Downloads a SQLite backup, resets, and restores through the file chooser | Passed | Passed |
| Rejects an invalid backup without replacing current data | Passed | Passed |
| Reopens offline from cached files and commits another expense | Passed | Passed |
| Recovers an on-disk browser profile after killing its browser process with SIGKILL | Passed | Not run; the test uses Chromium's process-identification API |

Final suite result: 23 passed, 1 explicitly skipped, zero failures.

The packaged static build also passed a Chromium smoke check at a 393 × 852 px
viewport: ten packaged file hashes matched, an expense survived an offline
reload, no JavaScript page errors occurred, and the page fit the viewport.

The first WebKit run failed at storage startup. A separate bare OPFS probe
failed at `navigator.storage.getDirectory()` in an ephemeral automation context,
before SQLite was involved. A persistent WebKit context opened it successfully.
Distinct profile directories alone also did not isolate OPFS data in this
WebKit build. The final fixture therefore uses disk-backed WebKit contexts and
a unique loopback origin for every test. It does not skip failed assertions,
reset data between operations, or change storage engines.

Playwright WebKit is an automated WebKit build. Passing these checks does not
establish that Safari or a Home Screen app on the physical iPhone behaves the
same way. The suite does not simulate device power loss or storage eviction.

## Physical iPhone checks

The Mac reports a paired iPhone 16 Pro running iOS 27.2. Anthony performed
the physical checks; the agent has not operated the phone. The prototype's
checklist covers installation, Airplane Mode reopening, failed writes,
backup/restore through Files, and competing copies where storage is shared.

The phone can use [the deployed test](https://kuwi-storage-probe.pages.dev).
The local development server remains loopback-only.

On 2026-11-07 Anthony reported Safari at ₱975 and a fresh Home Screen install
at ₱1,000. This matches the separate storage described in
[WebKit's web-app documentation](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/).
Safari and the installed app therefore have independent local ledgers.

Anthony confirmed the following results on 2026-11-07. These are user-reported
physical checks, separate from the automated browser results.

| Check | Result |
| --- | --- |
| Restore the exported backup in the installed PWA, fully close it, and reopen offline | Passed; the same imported data remained |
| Fail a write | Passed; balance and saved expenses stayed unchanged |
| Interrupt a write | Passed; balance and saved expenses stayed unchanged |
| Fail a migration | Passed; balance and saved expenses stayed unchanged |
| Open two Safari tabs, then close the first database and reopen the second | Passed; the second initially reported Database busy, then opened with the same Safari data |

At step 7, the backup was initially hard to locate, then appeared disabled in
the restore picker. Anthony later found it in iCloud Drive and successfully
restored it in the installed PWA. Version 2 removed the input's extension/MIME
filter while retaining validation of the selected SQLite bytes. The exact
cause of the disabled file was not isolated: file location, iCloud availability,
and picker filtering were involved in the investigation. Desktop automation
did not reproduce the native iOS picker. The update refreshed the shell cache
without changing the OPFS database or lock name.

Validation for this fix: six focused Chromium/WebKit checks passed, covering
export/restore with an unrecognized filename extension, invalid-file rejection
through the input, and offline reopening. A separate upgrade check in both
engines retained a saved expense through the v1-to-v2 cache update and an
offline reload. The changed page fit a 393 px viewport. Earlier upgrade probes
checked cache activation too early; the final probe waits for completion.
The subsequent physical check confirmed that restore completed and the imported
data survived closing and reopening offline.

The picker fix is deployed at the stable test address, with immutable deployment
<https://680d545a.kuwi-storage-probe.pages.dev>. All ten published asset hashes
match the updated build. The deployed page opens the database, prepares its
offline cache, and exposes the unfiltered input and its help text.

## Approved HTTPS test deployment

Anthony approved creation of `kuwi-storage-probe` and publication of the
prepared static test on 2026-11-07. The target is his verified personal
Cloudflare account. No custom domain, analytics, backend binding, or cloud
finance database was configured. This does not choose production hosting.

The Pages project was created with `cf@1.0.0-beta.20`. That CLI directs Pages
asset uploads to Wrangler; `wrangler@4.158.0` uploaded the prepared directory
to branch `main`. Existing Cloudflare authentication was supplied only in the
upload process environment. No credential was stored in the repository.

- Stable test address: <https://kuwi-storage-probe.pages.dev>
- Deployment address: <https://2900e052.kuwi-storage-probe.pages.dev>
- Deployment verification: all ten published asset hashes match the build.
- Chromium and WebKit each opened the HTTPS test, saved a scratch expense,
  and retained it through an offline reload without JavaScript page errors.

The physical checks above used the stable test origin. Changing origins creates
a separate local store; keep the same origin when repeating them.

## Outcome

The disposable storage validation is complete. Desktop automation and the
user-reported physical iPhone checks support using the pinned SQLite/WASM
release with OPFS SAHPool for the first Expo build. Preserve the tested worker
ownership, explicit data-preservation settings, and atomic-write rules during
integration. Keep the prototype's scratch data and fault controls out of the
finance app.

The product app's browser suite covers account and transaction storage, backup
restore, and populated shell updates. These results do not establish permanent
protection from storage eviction, device power-loss durability, or a cloud sync
protocol.

## Product app income checks

Checked 2026-11-07 with
`npm exec --yes --package=pnpm@11.25.0 -- pnpm check`. Lint, TypeScript,
static build, and all 80 Playwright journeys passed: 40 each in Chromium and
Playwright WebKit. Eight income persistence journeys run in both engines:
income posting and history, PHP/JPY rounding, Credit debt reduction, a zero
future planned entry, v3-to-v4 migration rollback with existing expense
history, outbox rollback, lost-reply stable retry with changed-content rejection,
and interrupted-write recovery. Backup coverage now round-trips income facts and
their pending operations, imports v3 backups with empty income records, and
checks rollback when a restore write fails. The offline closure journey reopens
income and expense history and saves another income while offline.

The shipped-web income form's physical iPhone acceptance is still pending.
Playwright WebKit results do not establish physical Safari or Home Screen
storage behavior.
