# ADR 0042: Separate engineering CI from production legal readiness

## Status

Accepted

## Context

The Full CI workflow runs on every pull request and push to `main`. Its package
job previously invoked `package:production:from-build`, which hard-fails while
the 27 production legal facts in `docs/legal-fact-sheet.md` are unapproved.
Those facts require external business evidence; they are not software defects
and must never be fabricated to make engineering CI pass.

At the same time, a production-public artifact must not be published without
the existing `check:legal:production` governance gate.

## Decision

- Pull-request and `main` CI verify source, tests, secure build, database
  integrity, browser workflows, performance, package structure and extracted
  runtime, reproducibility, SBOMs, and dependency security without creating or
  publishing a production-public archive.
- Production publication is an explicit manual `workflow_dispatch` path in the
  same workflow, after every engineering job succeeds.
- The publication job runs `check:legal:production` before constructing and
  uploading `biddingflow-production.zip`.
- A failed legal gate fails the publication job. It is not suppressed, made
  advisory, or replaced with inferred legal facts.

## Compatibility impact

Ordinary engineering CI can be green while legal facts remain unavailable.
This does not assert production readiness. The production artifact remains
unavailable until all engineering gates and the legal readiness gate pass in an
explicit manual release run.

## Migration strategy

No application or database migration is required. Release operators use the
manual Full CI dispatch when requesting a production-public artifact.

## Regression coverage

Workflow contract tests assert that the ordinary package job cannot invoke the
production command, the release job is manual-only, and legal readiness runs
before production packaging.
