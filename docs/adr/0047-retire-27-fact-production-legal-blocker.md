# ADR 0047: Retire the 27-fact production legal blocker

## Status

Accepted — supersedes only the 27-fact approval requirement in ADR 0042.

## Context

ADR 0042 separated engineering CI from production publication and required
approval of all 27 entries in `docs/legal-fact-sheet.md` before creating a
production artifact. The product owner decided on 29 September 2026 to remove
that blocker and keep minimal public legal pages.

## Decision

- Do not require approval, evidence, date or approver for the historical
  `LEGAL-01`–`LEGAL-27` entries as a CI or production packaging condition.
- Keep public terms, privacy and security pages. The production checker still
  fails when a required page is missing, has no visible copy, or contains
  `[TODO: ...]` or `legal-placeholder` copy.
- Keep the explicit manual production publication workflow and all engineering,
  artifact integrity, deployment security, database, backup, restore, smoke and
  rollback checks. This decision does not waive any of them.
- Treat a passing page checker as evidence of page presence and copy hygiene
  only. It is not a legal opinion or assertion of regulatory compliance.

## Compatibility impact

An artifact can now pass the public page gate without 27 approved fact records.
Public page URLs and navigation remain available. No change is authorized to
role, entitlement, tenant, assignment, record scope, masking or the content an
authorized user may read.

## Migration strategy

Replace the former fact-approval check with required-page, non-empty-copy and placeholder
checks in the existing command. Keep the former fact sheet as an explanatory
reference to the retired requirement. Do not create a schema or data migration.
Operators continue to run the same command before production packaging.

## Regression coverage

Checker tests cover a valid minimal three-page set, a missing or empty page and
a visible placeholder. The production workflow continues to invoke the checker
before packaging, and the artifact inventory retains the three public pages.

