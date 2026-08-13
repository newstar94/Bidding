---
status: accepted
---

# Plan package selection rejects missing rebid ancestors

When a caller selects packages for a new plan snapshot, the selected set must be closed over every `rebidFromPackageId` ancestor. The command fails with `AGGREGATE_REBID_DEPENDENCY_EXCLUDED` when an ancestor is excluded or absent; it does not silently add packages the caller did not select. This keeps the preview and committed target set identical while ensuring no target package points into the source plan.
