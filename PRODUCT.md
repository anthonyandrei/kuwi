# Kuwi

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Anthony is the first user, tracking his own money on an iPhone. Invited testers
may follow. Broader audiences and shared-account roles are not yet defined.

## Product purpose

Kuwi is an installable personal finance PWA for daily tracking and quick entry.
It should provide Tarsi's refined workflows, interactions, animations, and
finance logic with Kuwi's own branding. Success requires reliable saves,
offline reopening, and a usable experience on the physical iPhone.

This record applies across the repository. The detailed accepted scope and
implementation status live in [docs/product-scope.md](docs/product-scope.md);
the first usable stage is defined in
[docs/specs/first-usable-pwa.md](docs/specs/first-usable-pwa.md). Read those
documents and the relevant [ADRs](docs/adr/) before changing product behavior
or architecture.

## Positioning

The product is built for Anthony's use first. Its reference is Tarsi for iPhone
2.5.9, with core tracking available offline and without an online account.
No broader market differentiation or commercial offer has been established.

## Operating context

- Prioritize iPhone Safari and installation on the Home Screen. Native Apple
  widgets, Watch apps, and other OS integrations are outside this delivery;
  no future native app is committed.
- Start with fresh data. Anthony has no existing Tarsi records to migrate.
  Onboarding collects a preferred name, main currency, first account, and
  opening balance.
- Daily local use requires no sign-in. Require an account only when enabling
  cloud features.
- Safari and the installed Home Screen app have separate local stores. Treat
  this distinction as part of setup and data continuity.
- Begin with a ₱0/month operating budget. Evaluate paid AI separately before
  enabling it.

## Capabilities and constraints

The first usable stage covers onboarding, accounts, expenses, income,
transfers, budgets, and backup/restore. Wider browser parity includes
assessment of Tarsi Pro and Cloud workflows, with browser limitations made
explicit. These are delivery goals, not claims that the features already ship.

The app in `apps/kuwi` implements local onboarding, accounts, expenses,
ordinary income, offline cross-currency transfers, category budgets, and
backup/restore. These workflows use local SQLite storage. Browser validation
for the current transfer changes remains pending. Physical iPhone acceptance
for finance workflows also remains pending. Home, grouped Wallet, and the
remaining finance workflows are outstanding. Clerk and Convex are not
provisioned.

Use the accepted Expo, React Native Web, Expo Router, and Reanimated client.
Keep durable local data in SQLite/WASM with OPFS SAHPool. Convex is the selected
cloud data service, and Clerk is the selected cloud authentication service.
The disposable storage probe in `prototypes/storage-pwa` is separate from the
product.

Preserve strict third normal form for logical source data and ACID transactions
for related writes within each database. Local writes and later cloud sync
have separate transaction boundaries. Saves, retries, migrations, and failures
must preserve existing data and avoid partial or duplicate financial records.

### Open decisions and acceptance

- Inspect Tarsi's conflicting-device edits before choosing a sync conflict
  policy. The detailed sync protocol remains open.
- AI implementation and provider remain open. Published Tarsi capabilities
  do not establish Kuwi's implementation or offline AI behavior.
- Verify unresolved reference flows, initialization rules, finance behavior,
  and motion before implementing the affected features.
- Physical iPhone installation, full closure and offline reopening, storage
  ownership, layout, motion, and keyboard checks remain outstanding. Desktop
  browser results do not complete this acceptance.

## Brand commitments

Use the Kuwi name. Follow Tarsi's screen layouts and interactions closely with
Kuwi's accepted warm cream and sage palette. The third supplied mascot image
is the starting direction for a quokka; its simplicity does not limit further
detail. Final artwork, expressions, animation, typography, tagline, and mascot
placement remain undecided. Other suggestions in the supplied brand brief
have not been accepted as requirements.

## Evidence on hand

- [Observed iPhone onboarding](docs/tarsi-iphone-onboarding.md) records the
  verified 2.5.9 setup sequence and distinguishes native observations from
  recovered web behavior.
- [Home and Wallet screenshots](docs/tarsi-home-wallet-screenshots.md) establish
  visible layouts and labels; their version and interactions are unverified.
- [Recovered behavior](docs/tarsi-behavior-reference.md) and
  [artifact investigation](docs/tarsi-reverse-engineering.md) provide supporting
  evidence. Recovered bundles and Tarsi artwork are reference material;
  original buildable source and reuse permission have not been established.
- The current Kuwi mascot and app icons are in `apps/kuwi/public/`. Their
  presence does not settle the final mascot artwork.
- [Storage probe results](docs/pwa-storage-test-results.md) and the
  [app README](apps/kuwi/README.md) record validation and its limits. Full visual
  and behavioral parity remains outstanding.

## Product principles

- Keep everyday tracking usable offline and independent of cloud sign-in.
- Make successful saves trustworthy and failures visible.
- Preserve the pinned reference's verified behavior while giving Kuwi its own
  accepted identity.
- Deliver usable stages and distinguish implemented behavior from parity goals.
