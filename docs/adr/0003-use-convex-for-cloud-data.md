---
status: accepted
---

# Use Convex for cloud data

Accepted: 2026-11-06

Use Convex for cloud data, following Anthony's
preference for Convex and concern about Supabase Free inactivity pausing.
Convex's reactive queries fit the planned cloud synchronization experience.
Matching Tarsi's user-visible features does not require matching its database
provider. This decision is based on development preference and the reactive
workflow; comparative speed and larger free allowances are not established.

Durable on-device persistence and reconciliation still need a separate design;
reactive cloud queries alone do not establish offline usability. Keep the
accepted ₱0/month starting budget and do not create a cloud deployment yet.

This supersedes [ADR-0002](0002-use-supabase-postgresql-for-cloud-data.md).

References: [Convex pricing](https://www.convex.dev/pricing),
[Convex reactivity](https://docs.convex.dev/realtime),
[Supabase automatic pausing](https://supabase.com/docs/guides/platform/free-project-pausing).
