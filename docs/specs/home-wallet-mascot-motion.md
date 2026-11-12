## Problem Statement

Kuwi has working local finance workflows, but its main account workspace does not yet provide the Home and grouped Wallet experience Anthony wants from Tarsi. The current quokka is a static image. The interface and mascot need coordinated motion and more finished artwork.

Anthony identified Tarsi's landing page as useful reference material. He accepted Home and Wallet as the next focus and changed the mascot artwork direction: use Tarsi's mascot style, expressed as a quokka. The earlier supplied quokka image no longer defines the design. Kuwi keeps its name and cream and sage palette.

## Solution

Build a Tarsi-informed Home and grouped Wallet around Kuwi's existing local finance workflows. Use the landing page's screenshots and demo videos to guide layout, interactions, artwork, and motion, supplemented by the existing reference investigation. Create original, editable quokka artwork in Tarsi's mascot style and integrate a small set of useful character animations.

Validate layout and motion in phone-size browser viewports using browser inspection tools and the existing product journeys. Anthony will provide feedback when he opens the app on his iPhone. This pass does not require a separate visual or animation acceptance session on an iPhone or iPhone Simulator.

## User Stories

1. As Anthony, I want Home to give me a clear overview of my recorded finances, so that I can understand my current activity without opening each account.
2. As Anthony, I want to move between Home and Wallet through clear navigation, so that I can switch between my overview and accounts.
3. As Anthony, I want the main screens to follow Tarsi's layout and interaction style, so that Kuwi has the experience I asked for.
4. As Anthony, I want Kuwi's cream and sage palette retained, so that the interface keeps its own identity.
5. As Anthony, I want Home to greet me using my saved preferred name, so that the screen reflects my setup.
6. As Anthony, I want a quokka and a brief message on Home, so that the mascot has a useful place in the interface.
7. As Anthony, I want income and expense summaries to reflect saved activity, so that I can trust the amounts shown.
8. As Anthony, I want supported period controls to update the Home summary consistently, so that I can examine activity over the selected period.
9. As Anthony, I want the spending breakdown to identify categories and amounts, so that I can see where my money went.
10. As Anthony, I want chart information available as readable text, so that color and chart shapes are not my only ways to understand it.
11. As Anthony, I want recent transactions presented in a dated timeline, so that I can review what happened.
12. As Anthony, I want each transaction to show its account, amount, currency, and identifying details, so that I can distinguish similar entries.
13. As Anthony, I want the overview to distinguish planned entries from posted activity, so that future plans do not look like money already spent or received.
14. As Anthony, I want Home and Wallet to reflect successful finance changes when I return, so that the screens do not show stale amounts.
15. As Anthony, I want currencies handled explicitly in summaries, so that unrelated currency amounts are not added together without a valid conversion.
16. As Anthony, I want useful empty states when there is no activity, so that I know how to start using the screen.
17. As Anthony, I want Wallet to show account cards in meaningful groups, so that my accounts are easier to scan.
18. As Anthony, I want each account card to show its name, type, currency, and balance, so that I can identify the account and its value.
19. As Anthony, I want existing accounts retained when the grouped Wallet is introduced, so that a visual change does not lose or duplicate my records.
20. As Anthony, I want to open an account from Wallet, so that I can use its existing history and finance actions.
21. As Anthony, I want account creation and editing to remain reachable, so that the new Wallet does not remove existing capabilities.
22. As Anthony, I want group and balance-visibility controls to behave as their labels indicate, so that I can predict the result of using them.
23. As Anthony, I want navigation and entry actions to remain easy to reach on a phone-size screen, so that I can use the app without fighting the layout.
24. As Anthony, I want browser Back and Forward to follow my navigation, so that the new screens fit the app's existing navigation behavior.
25. As Anthony, I want motion to show where content moved or what changed, so that transitions help me follow my actions.
26. As Anthony, I want buttons and controls to respond promptly, so that the interface feels responsive.
27. As Anthony, I want repeated taps and interrupted transitions handled safely, so that animation does not duplicate a finance action or leave the screen stuck.
28. As Anthony, I want reduced motion respected, so that I can use the same screens with less movement.
29. As Anthony, I want the mascot to use Tarsi's artwork style while clearly being a quokka, so that Kuwi has the character direction I selected.
30. As Anthony, I want the mascot's detail and finish to follow that style, so that the old quokka image does not constrain the new artwork.
31. As Anthony, I want the mascot's appearance to stay consistent across poses and expressions, so that it reads as one character.
32. As Anthony, I want small character movements such as blinking and a greeting, so that the mascot feels alive.
33. As Anthony, I want a brief mascot reaction to an appropriate completed action, so that the character responds to the app without delaying my next task.
34. As Anthony, I want the mascot to stay subordinate to financial information, so that it does not obscure amounts or controls.
35. As Anthony, I want the screens and mascot to remain available offline after the app is cached, so that their presentation does not require sign-in or a network connection.
36. As Anthony, I want the interface to remain usable while artwork loads or an animation fails, so that a presentation problem does not prevent finance work.
37. As Anthony, I want long account names, large amounts, and empty or populated screens checked at phone widths, so that important content is not clipped or covered.
38. As Anthony, I want controls to remain accessible by keyboard and assistive technology, so that animation and artwork do not remove existing access.
39. As Anthony, I want my saved accounts, balances, transactions, budgets, and backups preserved, so that this interface pass does not change my finance records.
40. As Anthony, I want phone-size browser previews used during development, so that I can see a considered layout without a separate iPhone visual test session.
41. As Anthony, I want to give feedback after opening Kuwi on my iPhone, so that later adjustments can reflect what I actually see and feel.

## Implementation Decisions

- Focus this delivery on Home, grouped Wallet, their shared navigation, interface motion, and the new quokka artwork and animations. Connect existing finance workflows rather than replacing their business rules.
- Treat the supplied URL as Tarsi's landing page. Inspect its relevant screenshots, mascot imagery, and demo videos. The separate Tarsi web app and recovered web code are supporting evidence where useful; finding the landing page does not change the previously selected iPhone 2.5.9 comparison target.
- Before implementing an affected reference detail, record the source, observed layout or interaction, and relevant limitations. Screenshots establish appearance; videos can establish the movements they show; static code establishes only its traced behavior. Do not infer formulas, interaction persistence, or complete workflows from marketing claims or a visible control alone.
- Build Home around the observed greeting and mascot area, income and expense summary, category breakdown, supported period controls, and dated transaction timeline. Establish period boundaries, chart inclusion, planned-entry treatment, and currency handling from verified evidence before implementing those calculations. Keep forecasting, recurrence, and other unimplemented finance systems outside this pass.
- Read canonical local records through the existing storage interface. Derive display summaries and account balances rather than writing parallel financial totals. Transfers between owned accounts must not become ordinary income or expenses merely because Home aggregates activity; retain the existing treatment of linked transfer fees and planned records.
- Use existing verified conversion rules where a display requires conversion. If a valid conversion is unavailable, distinguish currencies or show that a combined value is unavailable. Never silently sum different currencies or fetch live rates merely to make this display work.
- Build Wallet with grouped account cards and routes into existing account details, account creation, editing, and transaction workflows. Inspect reference grouping, collapse, visibility, and overflow interactions before implementing their affected controls. Preserve all existing accounts and provide a visible home for records without group metadata; do not classify them from names or fabricate financial account types.
- Prefer display composition and the current command interfaces. If verified grouping requires new persistent metadata, keep it separate from financial account types and preserve strict logical 3NF, referential integrity, atomic changes, existing data, and backup compatibility. Any necessary migration and backup adjustment are part of this implementation, not permission for a new storage design.
- Integrate with the current static-export-compatible Expo Router navigation and shared database lifetime. Home and Wallet need distinct navigation locations, useful focus on arrival, safe handling of missing account references, and working Back and Forward. Navigation and animation must not submit financial commands. Keep existing budgets, transfers, history, and data management reachable without adding nonfunctional destinations.
- Continue with Expo, React Native Web, Expo Router, and Reanimated. Reuse the existing motion and reduced-motion handling. Recovered Tarsi timings and spring settings are starting evidence; tune their visible result in the browser instead of treating constants as proof of matching motion.
- Use short control feedback and coherent screen, card, and overlay transitions. Financial actions complete through the existing command boundary; animation follows the result and never delays or repeats a save. Support interruption, repeated navigation, and reduced motion. Stop decorative loops when their content is hidden or offscreen.
- Use Tarsi's mascot as the new artwork style reference and make Kuwi a quokka in that style. This supersedes the third supplied quokka image as the design reference. Preserve Kuwi branding and the accepted cream and sage interface palette. Create original artwork; do not ship Tarsi's mascot image or recovered assets as Kuwi's character.
- Inspect the reference artwork before choosing how to produce and animate the quokka. Neither a 2D rig nor a 3D model was selected in this conversation. Choose the representation that preserves the observed finish and works within the PWA's performance constraints; do not simplify the artwork merely to fit a preferred tool.
- Deliver editable artwork and reusable animation source. A generated image can establish appearance, but a single flat image is not a controllable rig or a 3D model. The chosen production method must support consistent poses, expressions, and the required motion.
- Start with a small coherent character set: a resting or idle pose with blinking, a greeting, and a brief reaction to an appropriate completed action. Wire reactions to actual UI events without introducing new financial goals, coaching logic, or a reward system. Keep visual reactions optional and nonblocking under reduced motion.
- Bundle or cache the required artwork, animation data, and runtime dependencies for offline use. Reserve stable layout space, provide a usable static fallback, and preserve the finance interface if an asset fails. Add an animation dependency only when the chosen artwork requires capability the existing stack cannot provide.
- Preserve current accessibility, system appearance handling, readable contrast, safe-area spacing, and form reachability. New charts need textual equivalents; decorative artwork must not add repeated screen-reader announcements. Keep finance errors visible and avoid color-only states.
- Validate this pass in browser developer tools or equivalent phone-size browser automation. Anthony explicitly removed a separate iPhone visual and animation test requirement for this work and will provide feedback during his own use. Do not turn iPhone or Simulator availability into a blocker for this pass.

## Testing Decisions

- The primary test boundary is complete user journeys through the built PWA, using its real local persistence. Anthony reviewed this proposed boundary and requested phone-size browser layout and motion checks instead of a separate iPhone visual and animation pass.
- Test external behavior: navigation destinations, accessible controls and state, visible records and amounts, committed changes reflected on Home and Wallet, correct empty states, retained data, and usable reduced-motion alternatives. Avoid assertions about component internals, a specific rig structure, or every animation frame.
- Extend the existing setup, account, transaction, planned-entry, transfer, budget, and backup browser journeys. Reuse Chromium and disk-backed WebKit contexts, isolated origins, the current local server, real OPFS storage, and existing failure-injection mechanisms where affected behavior warrants them. Do not add a second mocked-storage or component-test boundary.
- Exercise setup into the new main experience, Home to Wallet to account details and back, entry and correction from the new shell, and access to existing finance and data-management actions. Verify Back and Forward, route reloads, missing-record handling, and that navigation alone creates no financial records.
- Use populated fixtures with expense and income categories, planned records, same-currency and cross-currency transfers, linked fees, and multiple accounts. Assert Home and Wallet agree with verified expected records before and after a successful finance command. Cover period boundaries and currency-unavailable cases using reference examples established during implementation.
- Verify grouped Wallet retains existing accounts and balances. Test group and visibility controls against the observed behavior adopted during reference inspection, including reopening if those preferences persist. If grouping adds storage metadata, extend relevant migration, restore, and offline-retention journeys.
- Exercise interrupted transitions, rapid repeated activation, failed writes, and navigation during pending actions. Require an operable screen, visible failure feedback, retained form or data state as applicable, and no duplicate financial records. Mascot celebrations must follow a successful result, not a rejected save.
- Inspect Home, Wallet, navigation, and mascot rendering at representative phone widths, including 320 CSS pixels and a typical wider phone viewport. Check empty and populated content, long names, large amounts, portrait and landscape layouts, enlarged text, system appearances, and open overlays. Capture browser screenshots and short recordings where motion needs review.
- Verify normal and reduced-motion modes in the browser. Ensure movement does not cover controls or postpone interaction, hidden content stops looping, and static fallbacks preserve the meaning of success and failure. Inspect smoothness using browser performance tools rather than asserting an unmeasured frame-rate target.
- Verify required artwork and animations load after offline reopening. Simulate an unavailable artwork resource and confirm the fallback leaves navigation and finance actions usable.
- Review character previews and motion recordings against Tarsi's mascot artwork for style, detail, finish, consistent quokka anatomy, and expression continuity. Compare the Home and Wallet layout with the captured reference evidence. Browser screenshots and recordings are the visual evidence for this pass.
- Run the repository-required `pnpm check` on the final implementation. Before closure, provide the required acceptance-evidence table covering the user stories and implementation requirements. Distinguish automated browser results, browser visual review, and any later feedback Anthony volunteers from his iPhone.
- Do not require a separate physical-iPhone or iPhone-Simulator visual or animation acceptance session for this issue. Existing durability or device-acceptance requirements belonging to other issues remain with those issues.

## Out of Scope

- Rebuilding or publishing Tarsi's landing page, changing the comparison version, or claiming complete Tarsi parity.
- Forecasting, recurring-payment automation, investment pricing, debts, shared accounts, savings goals, AI coaching, receipt scanning, cloud services, authentication, or synchronization.
- Changes to existing posting, fee, precision, exchange-rate, budget, retry, or atomicity rules beyond composing their verified outcomes for the new screens.
- Copying Tarsi's original artwork or shipped application code into Kuwi, recovering its original repository, or requiring a native app package.
- A mandated 2D or 3D production pipeline, a broad mascot wardrobe, gamification, new branding, a new palette, or a desktop dashboard redesign.
- Native delivery, widgets, Apple integrations, deployments, hosting changes, paid service activation, and production-data operations.
- A separate iPhone or Simulator visual and animation acceptance pass, or closure of existing finance and durability issues based solely on this interface work.

## Further Notes

Prepared on 2026-11-12 from the accepted conversation decisions, including Anthony's testing correction. This is a specification; no Home or Wallet implementation, new mascot artwork, or animation validation is claimed complete.

Reference sources: [Tarsi landing page](https://www.tarsi.cloud/), [published features](https://www.tarsi.cloud/features), and [guides](https://www.tarsi.cloud/guide). The existing repository investigation and Home/Wallet screenshot observations provide supporting evidence. Any mismatch between current public material and the pinned comparison version must be recorded rather than silently changing the target.

Related work: [first usable offline PWA](https://github.com/anthonyandrei/kuwi/issues/1), [accounts](https://github.com/anthonyandrei/kuwi/issues/3), and [accessibility, navigation, and backup recovery](https://github.com/anthonyandrei/kuwi/issues/15). Reuse their implemented behavior and test approaches. This issue adds Home, grouped Wallet, and the new mascot work; it does not require those issues to close first. The earlier accessibility issue excluded new mascot artwork from its own scope; this spec authorizes that separate follow-up.

The artwork direction here supersedes the earlier supplied-image direction in the first-stage specification and project context. Final quokka artwork and the rendering technique are implementation deliverables, not decisions already made by Anthony.

The test boundary follows Anthony's instruction to use browser tools at phone size. He will give feedback when he opens Kuwi on his iPhone; that later feedback can produce further adjustments.
