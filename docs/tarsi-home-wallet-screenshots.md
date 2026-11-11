# Tarsi Home and Wallet screenshot observations

Received from Anthony on 2026-11-07. Four screenshots show Tarsi Home and
Wallet screens. Their app version is unknown; they are separate from the
[observed iPhone 2.5.9 onboarding](tarsi-iphone-onboarding.md).

The originals remain in the local attachment directory:
`/tmp/codex-remote-attachments/01a1b22b-aee3-7581-8918-efa771539b96/4779124B-73F9-49FE-BB98-AACBB8DA3546/`.
Files are numbered `1-Pasted-Image-1.jpg` through `4-Pasted-Image-1.jpg`.
They have not been copied into the repository or uploaded to GitHub.

## Home

Screenshot 2 shows a greeting, mascot message band, category donut, and a
summary card with income and expense figures. The summary has Day, Week,
and Month controls. Transactions appear in a dated timeline with category,
description, amount, account badge, and overflow control.

Screenshot 1 continues the timeline and shows Upcoming planned and recurring
income, Payments due, and Monthly forecast. Forecast controls read 1Y, 3Y,
and 5Y. Monthly cards show expected bills, expected income, projected net,
and a percentage. A floating bar has Home, Wallet, Plan, History, and an
adjacent add button.

## Wallet

Screenshots 3 and 4 show account cards grouped under Cash, Digital Banks,
E-Wallets, Cafe/Restos, Savings, Investments, Crypto, and Arcades. Cards have
an icon, name, account type and currency labels, masked balances with Hidden,
and overflow controls. Group headings have chevrons. Folder and add controls
are visible above the list. Some savings cards include rate text; investment
cards include symbols and USD labels.

## Limits and implementation use

These images establish visible layout and labels. They do not establish
collapse behavior, balance-visibility scope or persistence, account creation
and editing, supported type/currency combinations, or rate calculations.
Home period boundaries, chart inclusion, forecast formulas, percentages,
recurrence, and due-date posting also remain unverified.

Use the Wallet images as discovery evidence for #3 and Home images for the
parent #1. Upcoming and forecast sections inform discovery for #7. The donut
and period controls inform spending discovery for #10; neither is evidence
of a budget creation or progress screen. Recurring automation and forecasting
remain outside the accepted implementation scope until separately specified.
Kuwi retains its cream/sage palette and own quokka artwork.

## Public site inspection, 2026-11-12

The [Tarsi landing page](https://www.tarsi.cloud/) shows a warm brown mascot
with large glossy eyes, strong outlines, shaded fur, and a green outfit. The
page uses a light background and gives the character a wave. Kuwi's quokka is
original artwork that uses those broad finish cues while keeping Kuwi's sage
clothing and round quokka ears. The [features page](https://www.tarsi.cloud/features),
[guide](https://www.tarsi.cloud/guide), and published demo video show the
Home overview and grouped account cards. The video establishes their visible
sequence and motion; it does not establish group persistence or calculation
rules.

The Home Day, Week, and Month controls use the documented Tarsi budget period
boundaries in [the behavior reference](tarsi-behavior-reference.md#category-budgets):
the browser's local day, Monday through Sunday, and the saved monthly cycle
start day clamped to each month's length. The reference verifies those rules
for budgets. Reusing them for Home is a Kuwi product decision, not evidence
that Tarsi Home uses those same formulas. Home totals include posted income
and expenses from the chosen currency. Planned rows remain in the recent
timeline with a Planned label. Category totals use posted expenses, including
linked transfer fees. Transfer principal appears in the timeline without
changing income or expense totals. These inclusion rules follow Kuwi's saved
records and keep currency totals separate; the static reference does not
confirm Tarsi's chart formulas.

Wallet groups are names Anthony chooses. Existing accounts stay in Other
accounts until he moves them. Group names, assignments, collapsed sections,
and balance visibility are local display preferences. They are separate from
finance records and are not included in finance backups. The reference does not
show whether Tarsi persists these controls or how its overflow actions work.
