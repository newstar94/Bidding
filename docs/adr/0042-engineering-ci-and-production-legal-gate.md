# ADR 0042: Separate engineering CI from production legal readiness

## Status

Partially superseded by ADR 0047. The separation of engineering CI and manual
production publication remains accepted; the 27-fact approval blocker is
retired.

## Context

The Full CI workflow runs on every pull request and push to `main`. Its package
job previously invoked `package:production:from-build`, which hard-fails while
the 27 production legal facts in `docs/legal-fact-sheet.md` are unapproved.
At that time, those facts required external business evidence; they were not
software defects and could not be fabricated to make engineering CI pass.

At the time of this decision, a production-public artifact was required to
pass the `check:legal:production` fact-approval gate. ADR 0047 changed the
content of that gate to minimal public-page checks.

## Decision

- Pull-request and `main` CI verify source, tests, secure build, database
  integrity, browser workflows, performance, package structure and extracted
  runtime, reproducibility, SBOMs, and dependency security without creating or
  publishing a production-public archive.
- Production publication is an explicit manual `workflow_dispatch` path in the
  same workflow, after every engineering job succeeds.
- The publication job runs `check:legal:production` before constructing and
  uploading `biddingflow-production.zip`. Under ADR 0047 this command checks
  required pages and visible placeholders, without requiring approval of the
  historical 27 facts.
- A failed public-page gate still fails the publication job.

## Compatibility impact

Ordinary engineering CI can be green while the public-page gate or other
production preflight is incomplete. This does not assert production readiness.
The production artifact remains unavailable until engineering and public-page
gates pass in an explicit manual release run.

## Migration strategy

No application or database migration is required. Release operators use the
manual Full CI dispatch when requesting a production-public artifact.

## Regression coverage

Workflow contract tests assert that the ordinary package job cannot invoke the
production command, the release job is manual-only, and the public-page check
runs before production packaging. See ADR 0047 for page-checker regressions.
