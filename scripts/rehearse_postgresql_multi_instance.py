"""Run a disposable two-instance PostgreSQL HTTP/WebSocket rehearsal.

This is a local/performance evidence tool. It creates a scratch database and
roles, starts multiple Uvicorn processes against the same PostgreSQL database,
uses distinct sessions, and removes every scratch object on exit.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
from pathlib import Path
import platform
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
import uuid

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.auth.session_store import create_session
from backend.db.postgresql import PostgreSQLDatabase
from backend.db.postgresql_migrations import initialize_postgresql_database
from scripts.provision_postgresql_roles import provision_roles
from scripts.rehearse_postgresql_fresh_install import (
    _create_database,
    _database_url,
    _drop_database_and_roles,
)
from scripts.load_profile import load_profile


SCRATCH_PREFIX = "bidding_multi_instance_"


def _require_loopback_admin_url(admin_url: str) -> None:
    parsed = urlsplit(admin_url)
    if parsed.scheme.casefold() not in {"postgres", "postgresql"}:
        raise ValueError("--admin-url must be a PostgreSQL URL")
    host = str(parsed.hostname or "").casefold()
    if host not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError(
            "Multi-instance rehearsal only accepts a loopback PostgreSQL target; "
            "use the k6 staging harness for remote environments."
        )


def _percentile(values, percentile):
    ordered = sorted(float(value) for value in values)
    if not ordered:
        return 0.0
    rank = max(0, min(len(ordered) - 1, int((len(ordered) - 1) * percentile + 0.999999)))
    return round(ordered[rank], 3)


def _latency_summary(values):
    return {
        "count": len(values),
        "p50Ms": _percentile(values, 0.50),
        "p95Ms": _percentile(values, 0.95),
        "p99Ms": _percentile(values, 0.99),
        "maxMs": round(max(values), 3) if values else 0.0,
    }


def evaluate_evidence(evidence, thresholds):
    total = int(evidence["http"]["totalRequests"])
    failures = int(evidence["http"]["unexpectedFailures"])
    server_errors = int(evidence["http"]["server5xx"])
    checks = {
        "distinctSessions": evidence["sessions"]["distinct"]
        >= evidence["sessions"]["target"],
        "allInstancesReady": evidence["instances"]["ready"]
        == evidence["instances"]["target"],
        "unexpectedFailureRate": (failures / max(1, total))
        < float(thresholds["unexpectedFailureRate"]),
        "server5xxRate": (server_errors / max(1, total))
        < float(thresholds["server5xxRate"]),
        "readP95": evidence["latency"]["read"]["p95Ms"]
        < float(thresholds["readP95Ms"]),
        "readP99": evidence["latency"]["read"]["p99Ms"]
        < float(thresholds["readP99Ms"]),
        "syncP95": evidence["latency"]["sync"]["p95Ms"]
        < float(thresholds["syncP95Ms"]),
        "syncP99": evidence["latency"]["sync"]["p99Ms"]
        < float(thresholds["syncP99Ms"]),
        "recoveryP95": evidence["latency"]["recovery"]["p95Ms"]
        < float(thresholds["recoveryP95Ms"]),
        "recoveryP99": evidence["latency"]["recovery"]["p99Ms"]
        < float(thresholds["recoveryP99Ms"]),
        "websocketConnections": evidence["websocket"]["authenticatedConnections"]
        >= evidence["sessions"]["target"],
        "websocketBroadcast": evidence["websocket"]["broadcastDeliveries"]
        >= evidence["sessions"]["target"],
        "mutationUniqueness": evidence["database"]["uniqueMutations"]
        == evidence["database"]["expectedMutations"],
        "brokerEventUniqueness": evidence["database"]["brokerEvents"]
        == evidence["database"]["expectedBrokerEvents"],
    }
    return checks, all(checks.values())


def _reserve_ports(count):
    sockets = []
    ports = []
    try:
        for _index in range(count):
            holder = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            holder.bind(("127.0.0.1", 0))
            sockets.append(holder)
            ports.append(holder.getsockname()[1])
        return ports
    finally:
        for holder in sockets:
            holder.close()


def _http_request(base_url, path, *, method="GET", headers=None, payload=None, timeout=30):
    body = None
    request_headers = dict(headers or {})
    if payload is not None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        request_headers.setdefault("Content-Type", "application/json")
    request = Request(
        f"{base_url}{path}",
        data=body,
        headers=request_headers,
        method=method,
    )
    started = time.perf_counter()
    try:
        with urlopen(request, timeout=timeout) as response:
            response_body = response.read()
            status = response.status
    except HTTPError as exc:
        response_body = exc.read()
        status = exc.code
    return status, response_body, (time.perf_counter() - started) * 1000


def _wait_ready(base_url, process, timeout_seconds=90):
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Uvicorn instance exited with code {process.returncode}")
        try:
            status, _body, _latency = _http_request(
                base_url, "/health/ready", timeout=2
            )
            if status == 200:
                return
        except OSError:
            pass
        time.sleep(0.1)
    raise RuntimeError("Uvicorn instance did not become ready")


def _metrics_value(base_url, metric_name, token):
    status, body, _latency = _http_request(
        base_url,
        "/metrics",
        headers={"Authorization": f"Bearer {token}"},
        timeout=5,
    )
    if status != 200:
        return 0
    prefix = f"{metric_name} "
    for line in body.decode("utf-8", errors="replace").splitlines():
        if line.startswith(prefix):
            return int(float(line[len(prefix) :].strip()))
    return 0


def _revision():
    try:
        commit = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=PROJECT_ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        dirty = bool(
            subprocess.run(
                ["git", "status", "--porcelain"],
                cwd=PROJECT_ROOT,
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
        )
        return {"commit": commit, "dirty": dirty}
    except (OSError, subprocess.SubprocessError):
        return {"commit": "unavailable", "dirty": None}


def _seed_sessions(database, count):
    connection = database.get_connection()
    try:
        user_id = connection.execute("SELECT id FROM tai_khoan LIMIT 1").fetchone()[0]
        organization_id = connection.execute(
            "SELECT organization_id FROM thanh_vien_to_chuc WHERE user_id = ? LIMIT 1",
            (user_id,),
        ).fetchone()[0]
        tokens = []
        now = int(time.time())
        for index in range(count):
            token = secrets.token_urlsafe(32)
            create_session(
                connection.cursor(),
                user_id=user_id,
                token=token,
                absolute_expires_at=now + 7200,
                idle_timeout_seconds=7200,
                device_info=f"multi-instance-rehearsal-{index}",
                now=now,
            )
            tokens.append(token)
        connection.commit()
        return str(user_id), str(organization_id), tokens
    finally:
        connection.close()


def _stop_processes(processes):
    for process in processes:
        if process.poll() is None:
            process.terminate()
    deadline = time.time() + 10
    for process in processes:
        remaining = max(0.1, deadline - time.time())
        try:
            process.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def _remove_runtime_root(runtime_root):
    if runtime_root is None:
        return
    resolved = Path(runtime_root).resolve()
    temp_parent = Path(tempfile.gettempdir()).resolve()
    if resolved.parent != temp_parent or not resolved.name.startswith(
        "bidding-multi-instance-"
    ):
        raise RuntimeError("Refusing to remove an unexpected rehearsal directory")
    shutil.rmtree(resolved, ignore_errors=True)


def run_rehearsal(
    admin_url,
    *,
    instance_count=2,
    session_count=100,
    read_requests=500,
    sync_requests=100,
):
    _require_loopback_admin_url(admin_url)
    if instance_count < 2 or instance_count > 4:
        raise ValueError("instance_count must be between 2 and 4")
    if session_count < 2 or session_count > 500:
        raise ValueError("session_count must be between 2 and 500")
    profile = load_profile(PROJECT_ROOT / "load" / "profiles" / "mixed-100.json")
    thresholds = profile["thresholds"]
    suffix = uuid.uuid4().hex[:8]
    database_name = f"{SCRATCH_PREFIX}{suffix}"
    roles = {
        "migration": f"bf_multi_m_{suffix}",
        "application": f"bf_multi_a_{suffix}",
        "monitor": f"bf_multi_o_{suffix}",
    }
    passwords = {
        "migration": f"Migration-{suffix}-rehearsal!",
        "application": f"Application-{suffix}-rehearsal!",
        "monitor": f"Monitor-{suffix}-rehearsal!",
    }
    processes = []
    database = None
    runtime_root = None
    started = time.perf_counter()
    try:
        _create_database(admin_url, database_name)
        target_admin_url = _database_url(admin_url, database_name)
        provision_roles(
            target_admin_url,
            roles,
            passwords,
            require_verified_tls=False,
            connection_limits={
                "migration": 2,
                "application": instance_count * 5 + 5,
                "monitor": 3,
            },
        )
        migration_url = _database_url(
            admin_url,
            database_name,
            username=roles["migration"],
            password=passwords["migration"],
        )
        application_url = _database_url(
            admin_url,
            database_name,
            username=roles["application"],
            password=passwords["application"],
        )
        bootstrap_environment = {
            "ADMIN_PASSWORD": "Multi-instance-rehearsal-only-2026!",  # pragma: allowlist secret
            "ADMIN_USERNAME": "multiinstanceadmin",
            "ADMIN_NAME": "Multi Instance Rehearsal",
            "ADMIN_EMAIL": "multi-instance@example.test",
            "DEFAULT_ORG_NAME": "Multi Instance Rehearsal",
            "POSTGRES_POOL_MIN_SIZE": "0",
            "POSTGRES_POOL_MAX_SIZE": "5",
        }
        migration_database = PostgreSQLDatabase(
            migration_url, environ=bootstrap_environment
        )
        try:
            initialize_postgresql_database(migration_database, bootstrap_environment)
        finally:
            migration_database.close()
        database = PostgreSQLDatabase(
            application_url, environ=bootstrap_environment
        )
        _user_id, organization_id, session_tokens = _seed_sessions(
            database, session_count
        )
        database.close()
        database = None

        with tempfile.TemporaryDirectory(
            prefix="bidding-multi-instance-", ignore_cleanup_errors=True
        ) as runtime_raw:
            runtime_root = Path(runtime_raw).resolve()
            ports = _reserve_ports(instance_count)
            origins = ",".join(f"http://127.0.0.1:{port}" for port in ports)
            metrics_token = secrets.token_urlsafe(32)
            shared_data = runtime_root / "shared-data"
            base_environment = {
                **os.environ,
                **bootstrap_environment,
                "APP_DEBUG": "False",
                "APP_ENV": "test",
                "APP_HOST": "127.0.0.1",
                "APP_SECURE_COOKIES": "False",
                "BIDDING_DATABASE_URL": application_url,
                "BIDDING_MIGRATION_DATABASE_URL": migration_url,
                "BIDDING_DATA_DIR": str(shared_data),
                "BIDDING_BACKUP_DIR": str(shared_data / "backups"),
                "BIDDING_UPLOAD_DIR": str(shared_data / "templates" / "images"),
                "BIDDING_WORD_TEMPLATE_DIR": str(shared_data / "templates" / "words"),
                "AUDIT_CHECKPOINT_DIR": "",
                "AUDIT_CHECKPOINT_HMAC_KEY": "",
                "AUDIT_CHECKPOINT_OFFHOST_CONFIRMED": "false",
                "CORS_ORIGINS": origins,
                "ALLOWED_WS_ORIGINS": origins,
                "METRICS_BEARER_TOKEN": metrics_token,
                "POSTGRES_POOL_MIN_SIZE": "0",
                "POSTGRES_POOL_MAX_SIZE": "5",
                "POSTGRES_POOL_TIMEOUT_SECONDS": "5",
                "WEBSOCKET_MAX_CONNECTIONS_PER_IP": str(session_count + 10),
                "WEBSOCKET_MAX_CONNECTIONS_PER_USER": str(session_count + 10),
                "PYTHONDONTWRITEBYTECODE": "1",
            }
            base_urls = []
            for index, port in enumerate(ports):
                instance_environment = {
                    **base_environment,
                    "APP_PORT": str(port),
                    "BIDDING_LOG_DIR": str(runtime_root / f"logs-{index}"),
                    "DOCUMENT_WORKER_TEMP_DIR": str(
                        runtime_root / f"document-worker-{index}"
                    ),
                }
                process = subprocess.Popen(
                    [
                        sys.executable,
                        "-m",
                        "uvicorn",
                        "backend.app:app",
                        "--host",
                        "127.0.0.1",
                        "--port",
                        str(port),
                        "--no-proxy-headers",
                        "--limit-concurrency",
                        "256",
                        "--backlog",
                        "256",
                    ],
                    cwd=PROJECT_ROOT,
                    env=instance_environment,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.STDOUT,
                    creationflags=(
                        subprocess.CREATE_NO_WINDOW
                        if os.name == "nt" and hasattr(subprocess, "CREATE_NO_WINDOW")
                        else 0
                    ),
                )
                processes.append(process)
                base_url = f"http://127.0.0.1:{port}"
                base_urls.append(base_url)
                _wait_ready(base_url, process)

            csrf_tokens = [secrets.token_urlsafe(24) for _ in session_tokens]

            def headers_for(index, *, mutation=False):
                headers = {
                    "Cookie": (
                        f"session_token={session_tokens[index]}; "
                        f"csrf_token={csrf_tokens[index]}"
                    ),
                    "Origin": base_urls[index % instance_count],
                    "X-Active-Org": organization_id,
                }
                if mutation:
                    headers["X-CSRF-Token"] = csrf_tokens[index]
                return headers

            read_results = []

            def read_once(index):
                query = urlencode(
                    {"table": "goithau", "page": 1, "pageSize": 50}
                )
                status, _body, latency = _http_request(
                    base_urls[index % instance_count],
                    f"/api/paginate?{query}",
                    headers=headers_for(index % session_count),
                )
                return status, latency

            with concurrent.futures.ThreadPoolExecutor(max_workers=100) as executor:
                read_results = list(executor.map(read_once, range(read_requests)))

            sync_results = []

            def sync_once(index):
                session_index = index % session_count
                status, _body, latency = _http_request(
                    base_urls[index % instance_count],
                    "/api/sync",
                    method="POST",
                    headers=headers_for(session_index, mutation=True),
                    payload={
                        "includeDashboardSummary": False,
                        "clientMutationId": f"multi-instance-{suffix}-{index}",
                    },
                )
                return status, latency

            with concurrent.futures.ThreadPoolExecutor(max_workers=50) as executor:
                sync_results = list(executor.map(sync_once, range(sync_requests)))

            recovery_results = []
            with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
                recovery_results = list(
                    executor.map(
                        lambda index: _http_request(
                            base_urls[index % instance_count], "/health/live", timeout=3
                        ),
                        range(50),
                    )
                )

            ready_condition = threading.Condition()
            websocket_ready = 0
            receive_broadcast = threading.Event()

            def websocket_once(index):
                nonlocal websocket_ready
                from websockets.sync.client import connect

                session_index = index % session_count
                base_url = base_urls[index % instance_count]
                ws_url = base_url.replace("http://", "ws://") + "/ws/sync"
                with connect(
                    ws_url,
                    origin=base_url,
                    additional_headers={
                        "Cookie": headers_for(session_index)["Cookie"]
                    },
                    open_timeout=10,
                    close_timeout=5,
                ) as websocket:
                    websocket.send(
                        json.dumps(
                            {
                                "action": "auth",
                                "organizationId": organization_id,
                            }
                        )
                    )
                    with ready_condition:
                        websocket_ready += 1
                        ready_condition.notify_all()
                    if not receive_broadcast.wait(30):
                        return False
                    try:
                        message = websocket.recv(timeout=20)
                    except Exception:
                        return False
                    return "db_changed" in str(message)

            with concurrent.futures.ThreadPoolExecutor(
                max_workers=session_count
            ) as websocket_executor:
                websocket_futures = [
                    websocket_executor.submit(websocket_once, index)
                    for index in range(session_count)
                ]
                with ready_condition:
                    deadline = time.time() + 30
                    while websocket_ready < session_count and time.time() < deadline:
                        ready_condition.wait(timeout=0.1)
                authenticated_connections = 0
                metrics_deadline = time.time() + 20
                while time.time() < metrics_deadline:
                    authenticated_connections = sum(
                        _metrics_value(
                            base_url,
                            "biddingflow_websocket_active_connections",
                            metrics_token,
                        )
                        for base_url in base_urls
                    )
                    if authenticated_connections >= session_count:
                        break
                    time.sleep(0.1)
                broadcast_index = sync_requests
                session_index = broadcast_index % session_count
                broadcast_status, _body, broadcast_latency = _http_request(
                    base_urls[0],
                    "/api/sync",
                    method="POST",
                    headers=headers_for(session_index, mutation=True),
                    payload={
                        "includeDashboardSummary": False,
                        "clientMutationId": (
                            f"multi-instance-{suffix}-{broadcast_index}"
                        ),
                    },
                )
                receive_broadcast.set()
                websocket_deliveries = 0
                for future in websocket_futures:
                    try:
                        websocket_deliveries += int(bool(future.result(timeout=30)))
                    except Exception:
                        continue

            verification_database = PostgreSQLDatabase(
                application_url, environ=bootstrap_environment
            )
            connection = verification_database.get_connection()
            try:
                mutation_count = int(
                    connection.execute(
                        """SELECT count(*) FROM sync_mutations
                           WHERE client_mutation_id LIKE ?""",
                        (f"multi-instance-{suffix}-%",),
                    ).fetchone()[0]
                )
                broker_count = int(
                    connection.execute(
                        "SELECT count(*) FROM websocket_events WHERE event_type = 'broadcast'"
                    ).fetchone()[0]
                )
            finally:
                connection.close()
                verification_database.close()

            read_latencies = [latency for _status, latency in read_results]
            sync_latencies = [latency for _status, latency in sync_results]
            sync_latencies.append(broadcast_latency)
            recovery_latencies = [latency for _status, _body, latency in recovery_results]
            statuses = (
                [status for status, _latency in read_results]
                + [status for status, _latency in sync_results]
                + [broadcast_status]
                + [status for status, _body, _latency in recovery_results]
            )
            expected_mutations = sync_requests + 1
            evidence = {
                "schemaVersion": 1,
                "mode": "local-disposable-postgresql-multi-instance",
                "revision": _revision(),
                "platform": {
                    "system": platform.system(),
                    "python": platform.python_version(),
                    "postgresqlTlsVerified": False,
                },
                "instances": {"target": instance_count, "ready": len(base_urls)},
                "sessions": {"target": session_count, "distinct": len(set(session_tokens))},
                "http": {
                    "totalRequests": len(statuses),
                    "server5xx": sum(500 <= status <= 599 for status in statuses),
                    "throttled429": sum(status == 429 for status in statuses),
                    "unexpectedFailures": sum(status != 200 for status in statuses),
                },
                "latency": {
                    "read": _latency_summary(read_latencies),
                    "sync": _latency_summary(sync_latencies),
                    "recovery": _latency_summary(recovery_latencies),
                },
                "websocket": {
                    "authenticatedConnections": authenticated_connections,
                    "broadcastDeliveries": websocket_deliveries,
                },
                "database": {
                    "expectedMutations": expected_mutations,
                    "uniqueMutations": mutation_count,
                    "expectedBrokerEvents": expected_mutations,
                    "brokerEvents": broker_count,
                },
                "durationSeconds": round(time.perf_counter() - started, 3),
                "secretsPrinted": False,
                "scopeLimitations": [
                    "loopback network",
                    "single local PostgreSQL primary",
                    "no TLS/provider ingress/HA/failover",
                    "technical sessions are not evidence of 100 active humans",
                ],
            }
            checks, passed = evaluate_evidence(evidence, thresholds)
            evidence["checks"] = checks
            evidence["passed"] = passed
            _stop_processes(processes)
            processes.clear()
            return evidence
    finally:
        _stop_processes(processes)
        _remove_runtime_root(runtime_root)
        if database is not None:
            database.close()
        _drop_database_and_roles(admin_url, database_name, roles)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--admin-url", default=os.environ.get("BIDDING_TEST_POSTGRESQL_URL", ""))
    parser.add_argument("--instances", type=int, default=2)
    parser.add_argument("--sessions", type=int, default=100)
    parser.add_argument("--read-requests", type=int, default=500)
    parser.add_argument("--sync-requests", type=int, default=100)
    parser.add_argument("--output")
    args = parser.parse_args(argv)
    if not args.admin_url:
        parser.error("--admin-url or BIDDING_TEST_POSTGRESQL_URL is required")
    try:
        result = run_rehearsal(
            args.admin_url,
            instance_count=args.instances,
            session_count=args.sessions,
            read_requests=args.read_requests,
            sync_requests=args.sync_requests,
        )
    except Exception as exc:
        print(json.dumps({"passed": False, "error": str(exc)}, ensure_ascii=False))
        return 1
    rendered = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 0 if result["passed"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
