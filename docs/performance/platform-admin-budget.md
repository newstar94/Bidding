# Platform Admin performance evidence

This evidence covers the bounded production read paths and the initial frontend payload for the isolated Platform Admin console. It does not change any authorization, record scope, entitlement, masking, or data-visibility contract.

## PostgreSQL large-data benchmark

Run:

```powershell
python scripts/benchmark_platform_admin.py --repetitions 3
```

The command requires `TEST_DATABASE_URL` and deliberately refuses to use `DATABASE_URL`. It opens one transaction, creates temporary tables, seeds 10,000 users, 1,000 organizations, 50,000 audit rows, and 25,000 authoritative invoice-request rows with their orders and verified payment transactions. It calls the real production list handlers and rolls the transaction back in `finally`, including on failures.

The executable limits are:

- page size: 100 items;
- response body: at most 256,000 bytes;
- users: exactly 3 queries;
- organizations: exactly 3 queries;
- audit: exactly 2 queries;
- invoice requests: exactly 2 queries.

## Frontend budget verifier

Build and measure:

```powershell
npm run build:secure
npm run benchmark:platform-admin-frontend
```

The verifier reads the secure-build manifest, follows the Platform Admin entry's complete static import graph, and sums exact on-disk raw bytes. It then serves the real hashed build assets and the production admin HTML template from an isolated loopback server. Each repetition uses a fresh Chromium context, records actual same-origin browser requests, and waits for the authoritative overview response, rendered dashboard content, and loaded fonts. Dashboard load is measured from browser navigation start to that semantic completion point; no fixed sleep is used.

Committed limits are:

| Metric | Limit |
| --- | ---: |
| Reachable admin JavaScript (raw) | 425,000 bytes |
| Reachable admin CSS (raw) | 575,000 bytes |
| Initial same-origin requests | 12 |
| Dashboard semantic load, maximum | 1,500 ms |

The command prints JSON containing each asset, every measured request, individual browser timings, maximum measurements, and PASS/FAIL. File and request measurements are deterministic for a given secure build. Browser timings are point-in-time evidence from the executing machine, not a universal production latency guarantee.
