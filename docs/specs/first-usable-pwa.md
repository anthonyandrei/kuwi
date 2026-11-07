# Kuwi: first usable offline PWA

Prepared: 2026-11-07. Test approach confirmed by Anthony on the same date.

## Problem Statement

Anthony wants a personal finance app with Tarsi's refined interface, animations,
and finance workflows, using Kuwi's own branding. It must work on his iPhone
without weekly native development installation renewals. Daily tracking must
work without internet access or sign-in, and related financial writes must not
leave incomplete records when an operation fails.

The repository currently contains reference research, architecture decisions,
and a disposable storage test. It does not contain the usable finance app.

## Solution

Build an installable, iPhone-first Kuwi PWA. Deliver a first usable stage with
fresh onboarding, initial account setup, accounts, expenses, income, transfers,
budgets, and backup/restore. Reconstruct the reference workflows with Kuwi's
warm cream and sage palette and quokka mascot direction.

Use Tarsi for iPhone 2.5.9 as the comparison target. The recovered shipped web
code is supporting evidence; it does not prove equivalent iPhone behavior.
Verify unresolved reference rules before implementing affected features.

This issue specifies the first usable stage. Full browser experience and
finance logic parity, including assessment of Pro and Cloud workflows, remains
the wider project goal. Completion of this issue must not be reported as full
Tarsi parity.

## User Stories

1. As Anthony, I want to open Kuwi on my iPhone, so that I can track money on the device I use each day.
2. As Anthony, I want to install Kuwi on the Home Screen, so that I can open it as an app without a weekly reinstall.
3. As Anthony, I want to start without creating an online account, so that local tracking does not depend on sign-in.
4. As Anthony, I want to start with fresh data, so that I do not need an existing Tarsi export.
5. As Anthony, I want onboarding to follow Tarsi's relevant first-run flow, so that setup provides the reference experience.
6. As Anthony, I want to enter my preferred name during setup, so that the app can address me consistently.
7. As Anthony, I want to choose my preferred currency, so that amounts use the expected denomination.
8. As Anthony, I want to name my first account and set its opening balance, so that tracking begins from my actual starting position.
9. As Anthony, I want setup defaults and validation to follow the verified reference rules, so that blank or invalid inputs have predictable outcomes.
10. As Anthony, I want completed setup to remain complete after reopening, so that I do not repeat onboarding or create duplicate starting records.
11. As Anthony, I want to create additional accounts, so that I can track money held in different places.
12. As Anthony, I want to see each account's balance, so that I know how much money it contains.
13. As Anthony, I want to update account details, so that account information stays accurate.
14. As Anthony, I want account changes that affect existing financial activity to follow verified reference rules, so that edits do not silently alter my financial history.
15. As Anthony, I want to record an expense quickly, so that I can capture spending while I remember it.
16. As Anthony, I want to assign an expense to an account and category, so that I can see where money came from and what it paid for.
17. As Anthony, I want to record income, so that account activity includes money received.
18. As Anthony, I want to choose transaction dates, so that entries reflect when activity occurred.
19. As Anthony, I want future-dated and planned entries to follow verified reference posting rules, so that balances change at the correct time.
20. As Anthony, I want to review saved transactions, so that I can check what I recorded.
21. As Anthony, I want to correct an expense or income entry, so that mistakes do not remain in my records.
22. As Anthony, I want to delete an entry and see its financial effects reversed correctly, so that balances remain consistent.
23. As Anthony, I want to transfer money between accounts, so that movement between my accounts is recorded as a transfer.
24. As Anthony, I want transfer fees recorded with the transfer, so that the total cost is accounted for.
25. As Anthony, I want invalid transfers rejected without partial changes, so that one account cannot change while the other stays unchanged.
26. As Anthony, I want transfer currency handling to follow verified reference rules, so that source and received amounts remain understandable.
27. As Anthony, I want to create and manage budgets using the verified reference workflow, so that I can plan spending.
28. As Anthony, I want to see budget progress for the correct period and transactions, so that I can compare spending with my plan.
29. As Anthony, I want saved records and balances to remain available offline, so that I can review my money without a connection.
30. As Anthony, I want to add and change supported financial records offline, so that daily tracking continues without internet access.
31. As Anthony, I want committed changes to survive fully closing and reopening the installed app offline, so that I can trust a successful save.
32. As Anthony, I want failed writes and migrations to preserve existing records, so that a failure does not leave an incomplete ledger.
33. As Anthony, I want a repeated submission of the same operation to avoid duplicate records, so that retries do not double-count activity.
34. As Anthony, I want a clear message when another tab owns the database, so that I understand why the current tab cannot open it.
35. As Anthony, I want another tab to open the same data after ownership is released, so that switching tabs does not create a new ledger.
36. As Anthony, I want to export a backup to Files, so that I can keep a copy outside browser storage.
37. As Anthony, I want to restore a valid Kuwi backup, so that I can recover saved data.
38. As Anthony, I want an invalid backup rejected without changing current data, so that choosing the wrong file does not damage my records.
39. As Anthony, I want installed app updates to retain my records and offline access, so that an update does not require starting over.
40. As Anthony, I want layouts and transitions to follow the verified Tarsi reference with Kuwi branding, so that the result has the intended feel on my iPhone.
41. As Anthony, I want the quokka mascot to follow the third supplied image's direction, so that Kuwi has its own identity without limiting later artwork detail.
42. As Anthony, I want storage and saving failures to be visible, so that I do not mistake an unsaved action for a successful one.

## Implementation Decisions

- Deliver the client with Expo, React Native Web, Expo Router, and Reanimated.
  Use pnpm. Do not introduce a native installation requirement.
- Build editable Kuwi source. Use recovered Tarsi behavior and motion settings
  as evidence. No original buildable source or reuse permission has been
  established; recovered bundles and Tarsi artwork are not product source.
- Keep the product interface separate from the disposable storage test. Its
  fault buttons, browser-test API, scratch account, and scratch data must not
  ship as product functionality.
- Organize responsibilities around the PWA shell and routes, onboarding,
  accounts and financial commands, budget calculation, local persistence,
  and backup/restore. Keep UI code from making independent related writes.
- Use the tested SQLite/WASM package version 3.54.1-build1 with OPFS SAHPool
  in a dedicated worker for the first integration. Preserve existing data on
  initialization failure and do not clear storage during startup.
- Acquire one database ownership lock before initializing OPFS. Retain it for
  the database lifetime. A competing tab must report that the database is busy;
  it must not create an apparently empty replacement store. Release ownership
  when the database closes. Do not add a silent fallback storage engine.
- Treat Safari and the Home Screen app as separate local stores. Their
  differing balances alone are not a synchronization defect. This stage does
  not promise automatic data sharing between those containers.
- Define keys, dependencies, and references for the logical source-data schema
  before implementing it. Require strict 3NF locally and in the later Convex
  model. Keep mutable facts canonical and reference them by ID. Derive balances
  and totals rather than maintaining inconsistent mutable copies.
- Apply ACID transactions within the local database. Commit a financial
  operation, its linked records, and its pending sync operation together.
  For a transfer, include both account effects and any fee in the same commit.
  A failed operation must leave the pre-operation ledger intact.
- Use stable operation IDs for retries. The prototype established that
  repeating the same operation with the same content creates one expense and
  one pending operation; reuse of that ID with different content is rejected.
  Carry that externally visible contract into the applicable finance commands.
- Use exact currency-aware amounts. The PHP prototype used integer centavos;
  verify each supported currency's precision and rounding before extending
  the schema. Do not assume every currency has two decimal places.
- Initialize from fresh data through onboarding. Current static evidence shows
  PHP as the default, a zero-balance Cash account, name trimming and nonblank
  validation, and currency choices PHP, USD, EUR, GBP, JPY, and TWD. Compare the
  actual visible first-run flow with the pinned reference before treating every
  recovered state as a required screen.
- Preserve verified first-account initialization semantics while making each
  related local change atomic. Reopening completed setup must not duplicate
  accounts or opening-balance records. The probe's starting PHP 1,000 is test
  data and is not the product default.
- Reference posting evidence distinguishes current/past, future, and planned
  entries. Complete the missing date, edit, deletion, category, transfer,
  income, and budget rules before coding their affected operations. Do not
  infer business rules from route names or substitute conventional defaults.
- Before implementing each affected workflow, record its reference inputs,
  visible outcomes, validation, calculation examples, and known platform
  differences. Unresolved eligibility, currency conversion, available-balance
  limits, budget cycles, or reversal rules block that workflow until verified
  or explicitly decided. Independent specified work can continue.
- Implement explicit installation metadata, offline startup caching, and
  application updates. Shell updates must retain the local database. Failed
  schema migrations must preserve the previous schema and records.
- Adapt the validated export/restore approach to a versioned Kuwi backup
  contract. Validate candidate data separately and replace application records
  atomically. An invalid or unsupported backup must preserve the current data.
  The prototype's minimal schema and restore size limit are not an approved
  complete product backup format.
- Keep local use independent of Clerk and Convex. Clerk remains the chosen
  future cloud authentication provider; Convex remains the chosen cloud data
  service. A local commit and later cloud synchronization are separate
  transaction boundaries. Do not invent a cloud conflict policy.
- Use Kuwi's accepted warm cream and sage palette. Develop the quokka from the
  third supplied image. Final mascot detail, expressions, animation, typography,
  and tagline remain design work; the full brand brief is not an accepted
  checklist of product features.
- Keep the initial operating budget at PHP 0/month. No paid AI service or
  production hosting provider is selected by this issue.

## Testing Decisions

- Anthony confirmed this test approach on 2026-11-07 before publication.
- Prefer one primary test boundary: complete user journeys through the built
  PWA. Assert visible records, balances, validation, navigation, and retained
  data. Do not make tests depend on component internals or mirror helper code.
- Cover onboarding through the first saved account; account creation and edits;
  expense and income creation, correction, and deletion; transfers with fees;
  and budget progress. Use verified reference calculation examples as the
  expected results. Complete those examples before accepting affected features.
- Exercise the product's real persistence boundary through those journeys.
  Failure injection may use a test-only control at that boundary to interrupt
  a write or fail a migration. The assertions remain external: no partial
  records, unchanged balances after failure, and successful subsequent reopening.
- Reuse the disposable probe's Playwright approach as prior art: Chromium and
  disk-backed WebKit contexts, independent origins for isolation, real OPFS,
  real downloads and file selection, offline reloads, and competing tabs. Avoid
  database mocks for durability and atomicity checks.
- Repeat the probe's critical guarantees after Expo integration: failed write
  rollback, interrupted write recovery, failed migration recovery, duplicate
  retry prevention, ownership handoff, valid restore, invalid restore rejection,
  and offline close/reopen followed by another successful write.
- Test shell and schema updates from a populated older build. Verify retained
  records, successful reopening, and continued offline use. Test migration
  failure without resetting or silently replacing the database.
- Repeat installation, Files export/restore, full closure and offline reopening,
  and ownership checks on the physical iPhone. Desktop WebKit results alone do
  not establish behavior in Safari or the installed Home Screen app.
- Compare relevant screens and transitions with the pinned reference on the
  target device. Include keyboard behavior, small-screen layout, gesture
  response, and motion. Static animation constants alone do not establish
  equivalent interaction quality.
- The existing probe passed 23 automated checks with one explicit Chromium-only
  process-kill check skipped on WebKit. Six focused picker/restore/offline checks
  also passed. Anthony confirmed restored-data persistence, all three failure
  controls, and Safari tab ownership on the physical iPhone. These results
  establish prior art, not acceptance of the future Expo implementation.
- Finish this stage only when the implemented journeys and integrated storage
  checks pass. Report incomplete reference verification separately from passing
  Kuwi tests; passing an internally consistent implementation does not prove
  Tarsi parity.

## Out of Scope

- Native iPhone packaging, weekly development provisioning, Apple Watch apps,
  Apple widgets, and other native-only integrations.
- Public launch, invited tester rollout, subscriptions, payments, and spending
  beyond the accepted starting budget.
- Clerk or Convex project provisioning, cloud synchronization, sharing,
  permissions, and cross-device conflict resolution in this first local stage.
  These remain later work under the accepted provider decisions.
- AI chat, natural-language parsing, voice entry, receipt scanning, and
  statement import implementation in this stage. Their browser parity and
  processing requirements need separate evidence and specifications.
- A complete implementation of every Tarsi Pro or Cloud workflow, every route
  found in shipped code, or unsupported native integrations. This stage does
  not reduce the overall browser parity target.
- Migration of existing Tarsi user data. Anthony is starting fresh. General
  imports remain part of the eventual parity assessment.
- Promises of permanent browser storage retention or device power-loss
  durability. Backup and recovery remain necessary.
- Reusing proprietary source or artwork without established permission, and
  treating a recovered minified bundle as an original editable project.

## Further Notes

This is still the specification phase. The storage probe was a technical
validation step within it. This issue is ready for an agent to complete the
identified reference checks and implement specified work in stages; it is not
a claim that every first-stage business rule or full-parity workflow is known.
Do not begin an affected feature while its rule verification remains open.

No production hosting decision follows from the approved Cloudflare Pages
storage test. Publishing this issue does not authorize provisioning cloud
projects or deploying the finance app.

The repository's product scope, accepted architecture decisions, Tarsi behavior
reference, reverse-engineering findings, and storage test results contain the
supporting evidence. The first build uses the browser storage approach selected
after the successful probe; the earlier native storage decision was reopened
by the PWA decision. No glossary exists yet; terms follow the current scope
and behavior reference.

The main remaining evidence gaps are the visible pinned iPhone first-run path,
built-in category behavior, income rules, budget cycles and calculations,
edit/delete reversal, currency and transfer edge cases, and the difference
between the current shipped web build and iPhone 2.5.9. Cloud conflicts remain
unresolved and outside this stage. Verification should produce examples that
can become acceptance tests, rather than another unbounded discovery pass.
