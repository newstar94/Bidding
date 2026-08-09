# Private client symbolication

Secure builds keep client source maps outside `dist` and outside the production ZIP. The build writes one content-addressed archive under `release/private-symbols/`; CI uploads that directory as the separate `biddingflow-private-client-symbols-<commit>` artifact with 30-day retention.

The archive contains original frontend source content. Restrict download access to incident responders with repository Actions access. Do not publish it, attach it to customer tickets, copy it into the application image, or serve it from the web tier.

Match an `/api/client-errors` diagnostic to the artifact whose commit/release ID is exactly the diagnostic `releaseId`, then run:

```text
npm run symbolicate:client -- \
  --archive release/private-symbols/<release-id-sha256>.symbols.json \
  --release <exact-release-id> \
  --file /dist/assets/<bundle>.js \
  --line <generated-line> \
  --column <generated-column>
```

The command emits only the repository-relative source path, line, column and optional symbol name. It never emits source content. A release mismatch, unknown bundle, unsafe path or unmapped position fails closed.

For immutable release IDs, the build refuses to replace an existing archive with different content. The local `development` archive is replaceable and must not be used to symbolicate production incidents.
