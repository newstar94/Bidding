---
status: accepted
---

# Procurement ALL is atomic per source revision

An `ALL` import commits each source revision atomically and records an ordered, durable, idempotent operation cursor. A committed revision survives failure of the next revision, and resume starts at the first unfinished disposition without replaying a committed revision; business rows, provenance, sync version, and invalidation event for one materialized revision share its transaction.
