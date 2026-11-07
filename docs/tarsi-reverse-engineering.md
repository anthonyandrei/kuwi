# Tarsi reverse engineering

Updated: 2026-11-07

## Questions and status

| Question | Status | Evidence and boundary |
| --- | --- | --- |
| Which frontend framework is shipped? | Answered for web; unresolved for iPhone 2.5.9 | Public HTML and bundles identify Expo, React Native Web, and Expo Router. No native package was inspected. |
| Which cloud database is used? | Answered for deployed web client | Application code queries Supabase tables and subscribes to PostgreSQL changes. Runtime calls and exact iPhone backend pairing remain unverified. |
| Is original editable source available? | Partially answered | Delivered JavaScript contains app logic and screen names, but is bundled and minified. Three corresponding source-map URLs returned HTTP 404. |
| Can the frontend be rebuilt after a branding/backend change? | Unresolved | No buildable source repository, dependency manifest, native project, or complete asset inventory has been recovered. |
| Is a public app source repository or reuse license identified? | Unresolved | Bounded searches of official links and the author's public repositories found none for Tarsi. Licenses from unrelated repositories do not establish a Tarsi license. |
| How are conflicting edits from multiple devices resolved? | Unresolved | Anthony requested Tarsi's behavior. No conflict experiment or code trace has established that policy. |
| How does first-run onboarding initialize data? | Partially answered for shipped web | Recovered named states, first-account update/create branches, PHP default, and completion writes. Full visible path and iPhone equivalence need runtime comparison. |
| Can animation details transfer to a PWA? | Partially answered | Shipped web uses Reanimated and retains timing, easing, spring, opacity, and transform settings. These can inform reconstruction; runtime fidelity remains unverified. |
| Does Tarsi's web persistence meet Kuwi's storage requirements? | Implementation traced; guarantees unverified | Profile JSON is written through AsyncStorage's localStorage adapter after a debounce. This does not establish ACID across related writes or strict 3NF. Kuwi needs its own storage design. |

## Shipped frontend evidence

The [web entry](https://web.tarsi.cloud/) loads Expo Metro runtime files and
sets `globalThis.__EXPO_ROUTER_HYDRATE__`. The
[common bundle](https://web.tarsi.cloud/_expo/static/js/web/__common-d31990bcc79fe8c4b0213bb913c4a7e9.js)
contains the React Native Web asset registry and Expo Router implementation.
The [index bundle](https://web.tarsi.cloud/_expo/static/js/web/index-32d1e7797d0f640bdef7cc274d2a7443.js)
retains screen route names for expense entry, income entry, and Apple Pay
integration. These observations establish the shipped web framework; they do
not prove the framework or native modules inside the pinned iPhone build.

A separate text extraction found 139 unique `.tsx` route filenames in the
index bundle. Examples include transaction entry, budgets, shared groups,
receipt scanning, statement imports, and Shortcuts. The count includes layouts
and other route files. It does not establish 139 active screens or their
presence in iPhone 2.5.9.

The common, index, and top layout files have no observed source-map directive
or SourceMap response header. Their exact corresponding `.js.map` URLs returned
HTTP 404. This check does not establish that no source maps exist elsewhere.

## Local artifact provenance

Five scripts explicitly linked by the public web entry were downloaded for
static analysis. The files are in
`/Users/drei/Library/Caches/kuwi-research/tarsi-web/`; `provenance.json` records
source URLs, byte lengths, and SHA-256 values. The third-party scripts are kept
outside the Kuwi repository.

| Artifact | SHA-256 |
| --- | --- |
| Expo Metro runtime | `80e3ab02b3bac22608cdf29a2e3cc1270616a695bbe479f7f500941e8d2bbe41` |
| Top layout | `59e10ee6283c64c5c7d77ac83e909c0a92eace8bc7823db4986bb1ad06906397` |
| Second layout | `6139a57dcb1f24df1c9c783d266a3f7964d4e2b026a1e765db1040d9c573cb71` |
| Common bundle | `ccac38fefe6008c3988e03c933635bd4fcd1f19ae52b5179f623197bd7cda943` |
| Index bundle | `af48ccda28347e9f31f388fe85a3f75d72526384d8a69771b56abc51b801c726` |

## Analysis tools

The configured MCP launcher still points to an unavailable `rea` command.
A CLI fallback uses the npm-cached REA 6.8.0 public launcher. Its first launch
failed under Node 22.14.0. An existing cached Node 24.22.2 runtime started the
five-file analysis without changing registration.

Anthony then requested a Node update. The official macOS package upgraded
`/usr/local/bin/node` to 26.13.0 LTS and npm/npx to 11.20.0. The downloaded
package matched the published SHA-256 and had a trusted Apple installer
signature. REA 6.8.0 starts under the updated default runtime.

The five-file REA pass reached its 300-second per-source deadline on the common
bundle. Its returned partial Evidence is
`ev_6bd9caaae68084d1a4301680d4164270246fc9ed3c3498974556fdfaaba63fbb`,
saved at
`/Users/drei/Library/Caches/kuwi-research/tarsi-web-partial-evidence-20261106.json`.
It parsed the runtime and two layouts, with 246 static findings; the common
and index bundles remained unexamined by that pass. The partial result cannot
establish whole-application behavior.

The focused index-only pass also reached the 300-second source deadline. Its
partial Evidence is
`ev_14cf13f2ffd90342e2f21695ebeced4b945717d04fd9d830e0d30edf31f088ee`,
saved at
`/Users/drei/Library/Caches/kuwi-research/tarsi-index-partial-evidence-20261106.json`.
It retains artifact identity and the timeout boundary, with zero completed
source parses and zero findings. It adds no semantic conclusions about the
index bundle. Both CLI processes exited; no analysis remains running.

## Focused screen analysis

The saved index references 137 distinct lazy JavaScript chunk paths. Three
selected public chunks were downloaded on 2026-11-07. Their URLs use
`https://web.tarsi.cloud/_expo/static/js/web/` followed by these filenames:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `onboarding-944f3e42d4eac0c46f2f98b079a572a8.js` | 120361 | `5f27df8d8c7bdd9416605f5f85b1e8108fdee4802a7dfc2e38348b137fe3cdee` |
| `add-expense-940caf825558b98d213bfca3fef5e6bd.js` | 141132 | `98677be132d94743c935cf788959c44ff21ffe3829226355dc21f7cdbdeb0c83` |
| `wallet-5dbe5e8175165ef23d1cf3e6371beaff.js` | 147695 | `526d5e4fee2dbbcd5b287bab7acb4d66e8b5ee5f41f300e9328594102d3a43cd` |

The files and `provenance.json` are in
`/Users/drei/Library/Caches/kuwi-research/tarsi-web-lazy-20261107/`.
This selection avoids repeating the timed-out shared-bundle passes.

Both focused REA passes completed under the updated default Node runtime:

| Scope | Retained source Evidence | Completed coverage |
| --- | --- | --- |
| Onboarding | `ev_6554c66a64731577bca22e68086db816fc6a6880de20a463390a51d930dcc78e` | One parsed file, 34000 AST nodes, 68 findings, zero parse failures |
| Expense entry and wallet | `ev_5c044eb54f9b31e6d257f18605f0585bff9b44e1e0040fe9a748b480432528fc` | Two parsed files, 84907 AST nodes, 458 findings, zero parse failures |

The selected files have complete syntax parses. Both application and semantic
graphs remain partial. Each pass capped semantic nodes and semantic unknowns
at 1000 per file. The onboarding pass retains 1024 semantic unknowns; the
expense/wallet pass retains 2012. Unselected dependencies and dynamic calls
remain unresolved. Finding counts are static observations, not verified
features or runtime tests.

The Evidence bundles and summary views are saved outside the repository:

- `/Users/drei/Library/Caches/kuwi-research/tarsi-onboarding-evidence-20261107.json`
- `/Users/drei/Library/Caches/kuwi-research/tarsi-onboarding-summary-20261107.json`
- `/Users/drei/Library/Caches/kuwi-research/tarsi-entry-wallet-evidence-20261107.json`
- `/Users/drei/Library/Caches/kuwi-research/tarsi-entry-wallet-summary-20261107.json`

Direct Babel AST inspection separately followed literal Metro module references
into the original common and index files. It recovered inert module wrappers
for the state store, account actions, currency helpers, motion defaults, and
storage adapter. Their original source hashes, character ranges, and extracted
hashes are retained in the provenance files under
`/Users/drei/Library/Caches/kuwi-research/tarsi-focused-modules-20261107/`.
These direct traces are independent of REA's capped semantic graph.

The [behavior reference](tarsi-behavior-reference.md) records the resulting
onboarding, motion, posting, and persistence observations. No complete asset
inventory, editable project, or dependency manifest has been recovered.

## Remaining boundaries

Native decompilation still requires a Tarsi IPA or APK. None has been obtained
or inspected. Original source recovery, buildability, and permission to reuse
the delivered code or artwork remain unresolved.

No target JavaScript was executed, no native app was installed, and no Tarsi
backend or account data was requested. The framework and route-name findings
above come from direct inspection of the delivered files, independently of
REA's partial coverage.
