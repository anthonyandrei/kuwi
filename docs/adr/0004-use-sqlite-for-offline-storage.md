---
status: superseded by ADR-0007
---

# Use SQLite for offline storage

Accepted: 2026-11-06

Use SQLite for durable on-device data, with changes synchronized to Convex.
Expenses must survive closing and reopening the app without internet access.
This gives local use a persistent store independent of the cloud backend.
Sync ordering, duplicate prevention, and conflict handling remain open.

The PWA decision in [ADR-0007](0007-deliver-kuwi-as-a-pwa.md) reopens this native
storage choice. Browser SQLite remains a candidate; no replacement has been
selected.
