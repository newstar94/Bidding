---
status: accepted
---

# Package representative is scoped to a plan snapshot

`goi_thau.is_latest` identifies the representative of a package lineage inside one plan snapshot, partitioned by organization, package root, and plan ID. A package under a historical plan may remain that plan's representative, but the aggregate is immutable because mutability also requires the owning plan to be current; global current-package projections therefore order by the owning plan version before the package version.
