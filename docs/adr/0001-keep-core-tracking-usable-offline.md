# Keep core tracking usable offline

Accepted: 2026-11-06

Kuwi will support tracking and quick transaction entry without an internet
connection, with optional cloud AI for advanced features. This follows Tarsi's
documented split between offline entry and cloud assistance, and keeps daily
tracking independent of network access or a paid AI service. The earlier SQLite
selection in [ADR-0004](0004-use-sqlite-for-offline-storage.md) is reopened for
the browser by [ADR-0007](0007-deliver-kuwi-as-a-pwa.md).
The sync implementation remains undecided and must preserve offline usability.

Local use does not require sign-in. An account is required only when enabling
cloud features.
