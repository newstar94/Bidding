# Prometheus metrics with multiple Uvicorn workers

## Contract

`backend.observability.metrics` uses repository-owned counters rather than the
`prometheus_client` package.  With `UVICORN_WORKERS > 1`, every worker therefore
publishes an atomic JSON shard under the systemd runtime directory and `/metrics`
aggregates all shards for the current service invocation.

- Counters and histogram count/sum/buckets are summed across live workers and
  archived worker generations.
- Active gauges are summed only across live workers.
- Event-loop lag is the maximum among live workers.
- Database phase maxima and latest audit verification values survive worker
  recycling for the current service invocation.
- A dead worker shard is atomically converted to a lifetime archive. It is not
  read as both a worker and an archive, preventing double-counting.
- `INVOCATION_ID`, supplied by systemd, isolates one service start from older
  files. `RuntimeDirectoryPreserve=no` removes the directory when the unit is
  stopped.

The service template sets:

```ini
RuntimeDirectory=biddingflow-metrics
RuntimeDirectoryMode=0750
RuntimeDirectoryPreserve=no
Environment=BIDDING_METRICS_MULTIPROCESS_DIR=/run/biddingflow-metrics
```

Do not point multiple independent BiddingFlow systemd units at the same runtime
directory. Do not manually copy shard files between invocations.

Systemd references:

- https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html
- https://www.freedesktop.org/software/systemd/man/latest/sd_id128_get_machine.html

## Deploy and verify

After installing the unit and environment file:

```bash
systemd-analyze verify /etc/systemd/system/biddingflow.service
systemctl daemon-reload
systemctl restart biddingflow
systemctl show biddingflow -p InvocationID -p RuntimeDirectory
curl --fail --silent http://127.0.0.1:8000/metrics > /tmp/biddingflow.metrics
grep '^biddingflow_metrics_multiprocess_enabled 1$' /tmp/biddingflow.metrics
grep '^biddingflow_metrics_multiprocess_collection_success 1$' /tmp/biddingflow.metrics
grep '^biddingflow_metrics_worker_shards ' /tmp/biddingflow.metrics
```

During steady state, `biddingflow_metrics_worker_shards` should equal the number
of live Uvicorn workers. It may change briefly during bounded worker recycling.
`biddingflow_metrics_multiprocess_collection_success` must remain `1`.

Exercise the deterministic repository verification before release:

```bash
pytest -q tests/test_metrics_multiprocess.py
```

The test proves two-worker counter/gauge aggregation, dead-worker archival,
invocation isolation, atomic publication, and integration with the Prometheus
renderer.

## Failure handling

If collection success becomes `0`:

1. Check `journalctl -u biddingflow` for permission, capacity, or malformed-shard
   errors.
2. Confirm the runtime directory is owned by `biddingflow:biddingflow`, mode
   `0750`, and resides on a local filesystem.
3. Confirm every worker inherited the same `INVOCATION_ID` and
   `BIDDING_METRICS_MULTIPROCESS_DIR`.
4. Restart the unit only after preserving relevant logs. Systemd creates a fresh
   invocation boundary; no manual recursive deletion is required.

The renderer fails open to its local worker snapshot when aggregation storage is
unavailable and exposes collection success `0`; this keeps `/metrics` diagnosable
without claiming that the process-local values are cluster totals.
