# Tarsi reference evidence

Checked: 2026-11-07

The accepted comparison target is Tarsi for iPhone 2.5.9. The
[App Store listing](https://apps.apple.com/ph/app/tarsi-budget-tracker/id6760278399)
and [Apple lookup response](https://itunes.apple.com/lookup?id=6760278399&country=ph)
identify that version. Current website documentation may describe capabilities
beyond this release; its claims still need comparison with the pinned app.

## AI processing

These are published product claims, not observed execution or network traffic.

| Capability | Published behavior | Remaining unknowns |
| --- | --- | --- |
| Natural-language transaction entry | Runs offline on the device, per the [features page](https://www.tarsi.cloud/features). | Model or rules, languages, accuracy, parsing limits. |
| Voice entry | Spoken transaction entry is supported, per the [features page](https://www.tarsi.cloud/features). | Speech provider and device/language conditions for offline transcription. |
| Receipt scanning | Listed as an offline Pro capability on the [Cloud page](https://www.tarsi.cloud/cloud). | OCR engine, extraction rules, fallback behavior. |
| Financial Q&A and advanced chat | Cloud AI uses tracked financial information and can record transactions, per the [Cloud page](https://www.tarsi.cloud/cloud). | Model version, prompts, context selection, architecture. |
| PDF/photo statement import | Listed as a Cloud AI capability on the [Cloud page](https://www.tarsi.cloud/cloud). | Local/remote split, duplicate handling, reconciliation rules. |

The [privacy policy](https://www.tarsi.cloud/privacy) names Gemini API processing
for optional AI requests. The [terms](https://www.tarsi.cloud/terms) also identify
Gemini-powered Cloud AI and an internet requirement. This establishes a remote
AI service; it does not establish an on-device LLM for offline entry.

## Visual references

- [Mascot hero](https://www.tarsi.cloud/assets/images/tarsi-hero.webp)
- [Logo](https://www.tarsi.cloud/assets/images/tarsi-logo.webp)
- [Home screenshot](https://www.tarsi.cloud/assets/images/app/shot-1.webp)
- [Chat screenshot](https://www.tarsi.cloud/assets/images/app/shot-2.webp)

These URLs returned image content types, but their artwork has not yet been
visually inspected. No comparative claim about mascot detail is established.

## Cloud database

Static inspection of the currently deployed
[web common bundle](https://web.tarsi.cloud/_expo/static/js/web/__common-d31990bcc79fe8c4b0213bb913c4a7e9.js)
found application-specific Supabase queries for the `app_profiles` and
`profile_snapshots` tables, plus `.on('postgres_changes', ...)` subscriptions for
shared accounts in the `public` schema. This is application usage beyond merely
bundling an SDK. The inspected bundle's SHA-256 is
`ccac38fefe6008c3988e03c933635bd4fcd1f19ae52b5179f623197bd7cda943`.

[Supabase documents](https://supabase.com/docs/guides/database/overview) a full
PostgreSQL database in each project. The evidence therefore establishes
Supabase/PostgreSQL usage in Tarsi's shipped web client. It does not establish
the complete schema, successful runtime calls, or the exact backend used by
iPhone 2.5.9. JSON snapshot payloads do not change the underlying SQL engine.

The iPhone app's on-device storage engine remains unknown. Web JSON persistence
does not establish a matching engine on iPhone. No backend was called and no
native app artifact was inspected.

## Hosting options

[Supabase Free](https://supabase.com/pricing) lists 500 MB database storage and
1 GB file storage. Free projects can pause after a week of inactivity; see
[automatic pausing](https://supabase.com/docs/guides/platform/free-project-pausing).
[Neon](https://neon.com/pricing) also offers a free database plan. Kuwi initially
selected Supabase under Anthony's conditional preference, then selected Convex
in [ADR-0003](adr/0003-use-convex-for-cloud-data.md). No cloud project has been
created.

[Convex Free](https://www.convex.dev/pricing) lists 0.5 GB database storage,
1 GB file storage, 1 GB monthly database I/O, 1 GB monthly data egress, and
1 million monthly function calls. Allowances are pooled per team. A bounded
check of official pricing, FAQ, deployment, and limits documentation did not
establish a guarantee against inactivity pausing. Reactive queries are
documented; a general latency advantage over Supabase is not established.

## Investigation status

Tarsi iPhone 2.5.9 was installed and its visible onboarding was observed through
iPhone Mirroring. See [the native observations](tarsi-iphone-onboarding.md).
Anthony also supplied [Home and Wallet screenshots](tarsi-home-wallet-screenshots.md)
whose app version has not been verified.

Static web analysis recovered portions of delivered JavaScript and behavior.
No original buildable repository or native app package has been recovered.
The native storage engine and complete business rules remain unverified.
See [the investigation report](tarsi-reverse-engineering.md) for artifact
provenance and tooling history.
