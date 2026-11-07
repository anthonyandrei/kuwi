# Require 3NF and ACID

Accepted: 2026-11-06

Use strict third normal form (3NF) for Kuwi's logical source-data schema in
the local store and Convex, and ACID transactions for related writes within each
database. Anthony chose these constraints to reduce inconsistent duplicate
facts and keep the data model maintainable as features and roles are added.
Document storage does not enforce normalization automatically; define keys,
dependencies, and reference validation explicitly.

ACID applies within each database transaction. Offline local writes and later
Convex synchronization are separate operations. Sync needs duplicate prevention
and a conflict policy; match Tarsi's observed behavior once verified. Role
permissions require explicit authorization checks independent of 3NF.

The PWA choice in [ADR-0007](0007-deliver-kuwi-as-a-pwa.md) reopens the local
storage implementation without relaxing these data requirements.

Convex's [database mutations](https://docs.convex.dev/functions/mutation-functions)
commit related database writes together or roll them back, with
[serializable isolation](https://docs.convex.dev/database/advanced/occ).
