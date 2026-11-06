# Tarsi iPhone onboarding observations

Observed through iPhone Mirroring on 2026-11-07 after Anthony installed Tarsi.
The installed version has not yet been checked. These observations therefore
must not be labelled verified against version 2.5.9.

The visible entry offers Apple, Google, and Continue Offline. Offline opens a
sleeping mascot introduction with Skip. Tapping asks for another tap to wake
the mascot. The subsequent setup sequence observed was:

1. Preferred name, initially empty. Next appeared after entering Anthony.
2. Personalized welcome.
3. Spending introduction.
4. Organizing introduction.
5. Goals introduction.
6. Main currency: PHP selected, with PHP/USD/EUR/GBP/JPY/TWD tiles and a More
   currencies control. That control was not opened.
7. First account: Cash template, Cash name, starting balance zero.
8. Account celebration showing Cash and PHP 1,234.56.

The starting-balance control opens a custom calculator sheet. Hardware typing
had no visible effect. Clicking digits 1, 2, 3, 4, decimal, 5, 6, 7 and Done
produced 1,234.56. This establishes that example's visible result, without
establishing general rounding or negative-balance rules.

Skip on the account celebration opened the dashboard with Anthony's name and
a money-activity coach mark. The remaining introduction states are optional
on this observed path. No Apple or Google authentication was used.

Still unverified: exact version, blank/whitespace validation, negative amounts,
other currencies and precision, full app closure/reopening, and accounting
records behind the displayed balance. Mirroring does not establish the actual
software keyboard layout on the phone. Static web evidence remains separate
in tarsi-behavior-reference.md.
