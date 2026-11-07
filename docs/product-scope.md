# Kuwi scope

Updated: 2026-11-07

## Confirmed direction

- Build for Anthony's personal use first, then consider invited testers.
- Deliver Kuwi as an installable PWA, with iPhone Safari and Home Screen use
  first. This replaces the proposed native iPhone installation route. See
  [the PWA decision](adr/0007-deliver-kuwi-as-a-pwa.md).
- Match Tarsi's refined UI/UX, animations, and finance logic in the PWA. This
  clarifies the earlier unqualified full-parity target. Native Apple widgets,
  Watch apps, and other OS-specific integrations are not required for this
  delivery. No future native app is committed.
- Use Tarsi as the reference for functionality. Anthony's instruction was "just copy tarsi."
- Use Kuwi as the project name.
- Use Expo, React Native Web, Expo Router, and Reanimated for the PWA client.
  See [the client-stack decision](adr/0008-use-expo-for-the-pwa-client.md).
- Use the validated SQLite/WASM release with OPFS SAHPool for the first Expo
  build. The disposable probe passed desktop checks and Anthony's physical
  iPhone checks. Repeat validation on the integrated finance app before using
  real data. See [the results](pwa-storage-test-results.md).
- Freeze the comparison target at Tarsi for iPhone version 2.5.9.
- Include Tarsi Pro and Cloud workflows in the browser parity assessment;
  identify platform constraints explicitly.
- Keep tracking and quick entry usable offline, with optional cloud AI for
  advanced features. The specific AI implementation and provider remain open.
- Start with a ₱0/month operating budget. Evaluate paid AI separately before
  enabling it.
- Allow local use without signing in. Require an account only when enabling
  cloud features.
- Keep durable local storage in SQLite/OPFS and synchronize changes to Convex.
  The local database and Convex have separate transaction boundaries.
- Use Clerk for authentication when enabling cloud features.
- Require strict third normal form (3NF) for the logical source-data schema
  and ACID transactions for related database writes. See
  [the data integrity decision](adr/0006-require-3nf-and-acid.md).
- Match Tarsi's behavior when devices make conflicting edits. Inspect that
  behavior before choosing a conflict policy.
- Use Convex for cloud data, following Anthony's preference for its reactive
  workflow and concern about Supabase Free inactivity pausing. See
  [the database decision](adr/0003-use-convex-for-cloud-data.md).
- Deliver working stages, beginning with accounts, transactions, transfers, and
  budgets. Browser experience and finance logic parity remain the target.
- Start with fresh data. Anthony has no existing Tarsi data to migrate.
- Include onboarding and initial data setup in the first usable build, matching
  Tarsi's flow with Kuwi branding. Inspect the reference flow before defining
  its screens, defaults, and initial records. Import remains part of eventual
  browser parity but is not needed for Anthony's initial setup.
- Follow Tarsi's screen layouts and interactions closely, with Kuwi's warm cream
  and sage palette.
- Use the third supplied mascot image as the starting direction. Develop its
  detail further; the reference image's simplicity is not a constraint.

## Decisions still open

- Storage acceptance for later finance workflows, sync behavior, and AI services.
- Continue inspecting Tarsi's shipped artifacts to establish behavior and
  determine whether any frontend code or assets can be reused.
- Detailed screen flows, animation behavior, initialization rules, and any
  gaps between shipped web code and iPhone 2.5.9.
- Final mascot artwork, detail, expressions, and animation.
- Remaining brand brief suggestions, including typography, tagline, and mascot
  appearances throughout the product.

The supplied brand brief and three mascot images are design references. Only the
choices recorded above have been accepted as requirements.

## Reference and evidence

- [Tarsi official features](https://www.tarsi.cloud/features)
- [Tarsi guide](https://www.tarsi.cloud/guide)
- [Tarsi Cloud](https://www.tarsi.cloud/cloud)
- [Tarsi for iPhone](https://apps.apple.com/us/app/tarsi-budget-tracker/id6760278399)

Public product documentation establishes advertised capabilities. Static traces
now cover parts of onboarding, initial account setup, expense posting, transfers,
and animation settings. See [the recovered behavior reference](tarsi-behavior-reference.md).
The [visible iPhone 2.5.9 onboarding](tarsi-iphone-onboarding.md) has now been
observed. Additional [Home and Wallet screenshots](tarsi-home-wallet-screenshots.md)
establish layout and labels, with version and interactions unverified.
Full behavior and visual parity remain outstanding.

The configured REA connection could not start. The check
`mcporter --config /Users/drei/.mcporter/mcporter.json list rea --json`
reported `offline` with `spawn rea ENOENT`; its launcher is `rea mcp`.
The investigation now uses a CLI fallback; see
[reverse-engineering findings](tarsi-reverse-engineering.md).

## Current implementation

The app in `apps/kuwi` implements local onboarding, accounts, expenses,
ordinary income, same-currency transfers, category budgets, and backup/restore.
Recovered Tarsi budget rules come from static web code, and iPhone acceptance
for finance workflows remains pending. Anthony selected Vercel and authorized
deployment on 2026-11-07. The deployed app is https://kuwi-ten.vercel.app.
Browser persistence journeys and HTTPS setup/offline checks passed; see [the
app README](../apps/kuwi/README.md) for coverage and limits. Physical iPhone
installation, full offline reopening, and populated Safari ownership handoff
passed for setup. An iOS 27.2 iPhone simulator completed setup with the
software keyboard and custom number pad. Setup transitions worked; identical
Tarsi animation timing is not established. Home, grouped Wallet, wider currency
transfer, and the remaining finance workflows are outstanding. The Cloudflare
storage probe remains separate. Clerk and Convex have not been provisioned for
the app.

## Data rules

Keep each current fact in one canonical record and refer to it by ID. For
example, transactions can reference an account and category without copying
their editable names into every transaction. Convex supports references through
[document IDs](https://docs.convex.dev/database/document-ids).

Use strict 3NF for the logical source-data schema locally and in Convex. Define
keys and dependencies explicitly. Convex references can represent these
relationships, but document storage does not enforce 3NF automatically.
Role permissions still require separate authorization rules.

Normalization reduces inconsistent copies but does not prevent duplicate
transaction creation during retries. Sync also needs stable operation IDs,
reference validation, and atomic writes. Convex
[mutations](https://docs.convex.dev/functions/mutation-functions) commit their
database changes together or roll them back. The precise sync protocol remains
undecided. The local store and Convex have separate transaction boundaries; a local
write and its later cloud synchronization are not one ACID transaction.
