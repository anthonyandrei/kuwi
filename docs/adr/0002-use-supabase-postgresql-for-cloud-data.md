---
status: superseded by ADR-0003
---

# Use PostgreSQL in Supabase for cloud data

Accepted: 2026-11-06

Superseded: 2026-11-06 by [ADR-0003](0003-use-convex-for-cloud-data.md).

Use PostgreSQL in Supabase for Kuwi's cloud data. Anthony selected Supabase if
Tarsi uses SQL and Convex if it uses NoSQL, while expressing a preference for
Convex. Static inspection of Tarsi's deployed web client found application code
querying Supabase profile and snapshot tables and subscribing to PostgreSQL
changes, satisfying the SQL condition for its cloud backend.

This does not establish the storage engine inside Tarsi for iPhone 2.5.9 or
select Kuwi's on-device database. Offline persistence and sync still need a
separate design. See [reference evidence](../tarsi-reference.md#cloud-database).

No Supabase project has been created. The accepted starting operating budget
remains ₱0/month.
