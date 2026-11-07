# PWA client proposal

Updated: 2026-11-07. Anthony accepted the client stack and the disposable
SQLite/OPFS validation slice. The probe passed, including user-reported physical
iPhone checks. Use its pinned SQLite/WASM release and OPFS SAHPool adapter in
the first Expo build; validate that integration before using real finance data.

Use Expo, React Native Web, Expo Router, and Reanimated for the client. That
matches the component and animation stack observed in Tarsi's shipped web
build. It gives us a direct way to express the recovered layout and motion
rules. It does not establish visual fidelity by itself, and the recovered
bundles are not a buildable project.

Build Kuwi's editable source with its own branding and a separate normalized
data layer. Keep third-party bundles in the research cache. Direct source or
asset reuse still depends on establishing permission. Recovering behavior can
continue without committing recovered implementation code to Kuwi.

Expo supports [PWA manifests and service workers](https://docs.expo.dev/guides/progressive-web-apps/),
but its web export does not supply an offline finance application automatically.
We must configure installation metadata, cached startup, updates, and browser
storage. This proposal does not require native builds, Apple membership, EAS
hosting, or a later native app. Hosting remains undecided.

## Storage validation

The disposable PWA with SQLite WebAssembly and OPFS passed the
[test checklist](pwa-storage-test-results.md): offline reopening, retention of a
committed entry after closing, rollback of failed related writes, safe database
ownership, and backup export/restore. Desktop automation ran first, followed by
Anthony's checks on the target iPhone. The selected package is
`@sqlite.org/sqlite-wasm@3.54.1-build1`, using OPFS SAHPool. The
[storage research](pwa-storage-research.md) records the current constraints.

The results support carrying the tested storage rules into Expo. The full app
must pass its own offline and update checks. There is no silent localStorage
fallback. Clerk and Convex remain outside this local storage test.

## First usable finance slice

After storage validation and confirmation of the implementation scope, build
the recovered onboarding flow with Kuwi branding, then accounts, expenses,
income, transfers, and budgets. Confirm their detailed calculation rules from
the reference before implementation. Full browser parity remains the target
beyond this slice.

Use normalized canonical records. Related entry, account-effect, and pending
sync-operation writes must commit together locally. Decide which totals are
derived and document keys and dependencies before accepting the schema. A
copied Tarsi profile snapshot would not establish these requirements.

Keep local use independent of authentication. Add Clerk and Convex when the
sync policy has enough evidence to specify conflicts, deletion, and retries.
Cloud changes will need a confirmed project/account and approval at deployment.

The standalone storage test isolates the browser database and cache behavior
before the Expo finance app is built. Its minimal HTML interface is temporary;
the accepted product client stack remains Expo. Neither accepted decision
chooses an unverified sync policy or AI provider.
