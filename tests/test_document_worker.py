from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import sys
import threading
import zipfile
from io import BytesIO

import pytest

from backend.documents import document_worker
from backend.documents.document_ipc import (
    DocumentIpcError,
    read_job_manifest,
    read_result,
    write_job_manifest,
    write_result,
)
from backend.documents.document_worker import (
    DocumentWorkerBusyError,
    DocumentWorkerInputError,
    DocumentWorkerTimeoutError,
    _consume_durable_document_result,
    _enqueue_durable_document_job,
    _prepare_external_job_permissions,
    cleanup_orphaned_durable_document_jobs,
    document_worker_execution_mode,
    _worker_environment,
    run_document_job,
)
from backend.documents.document_sandbox import (
    _validate_distinct_sandbox_identity,
    build_bwrap_command,
)
from backend.documents.seccomp_policy import (
    _DENIED_SYSCALLS,
    seccomp_library_name,
)
from backend.shared.paths import PROJECT_ROOT
from scripts.run_document_worker import (
    _run_worker_loop,
    _validate_document_worker_database_url,
    _validate_worker_secret_boundary,
)
from scripts.verify_document_worker_deployment import (
    VerificationError,
    parse_environment_file,
    validate_worker_unit_properties,
)


def _minimal_xlsx(extra_entries=None, *, content_types=None) -> bytes:
    output = BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "[Content_Types].xml",
            content_types or """<?xml version="1.0" encoding="UTF-8"?>
            <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
              <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
            </Types>""",
        )
        archive.writestr(
            "xl/workbook.xml",
            """<?xml version="1.0" encoding="UTF-8"?>
            <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>""",
        )
        for name, content in extra_entries or []:
            archive.writestr(name, content)
    return output.getvalue()


def test_embedded_document_worker_backoff_resets_after_work(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DOCUMENT_JOB_POLL_SECONDS", "1")
    monkeypatch.setenv("DOCUMENT_JOB_MAX_POLL_SECONDS", "8")
    monkeypatch.setenv("WORKER_IDLE_POLL_JITTER_RATIO", "0")
    outcomes = iter([False, False, True, False])
    sleeps = []

    async def next_outcome(*_args, **_kwargs):
        return next(outcomes)

    async def record_sleep(seconds):
        sleeps.append(seconds)
        if len(sleeps) == 4:
            raise asyncio.CancelledError

    monkeypatch.setattr(document_worker.asyncio, "to_thread", next_outcome)
    monkeypatch.setattr(document_worker.asyncio, "sleep", record_sleep)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(document_worker.run_durable_document_queue_worker(object()))

    assert sleeps == [1.0, 2.0, 0.1, 1.0]


def test_external_document_worker_wait_is_stoppable_and_resets_after_work(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from scripts import run_document_worker as worker_script

    monkeypatch.setenv("DOCUMENT_JOB_POLL_SECONDS", "1")
    monkeypatch.setenv("DOCUMENT_JOB_MAX_POLL_SECONDS", "8")
    monkeypatch.setenv("WORKER_IDLE_POLL_JITTER_RATIO", "0")
    outcomes = iter([False, False, True, False])
    waits = []
    stop_event = threading.Event()

    def process(_database):
        return next(outcomes)

    original_wait = stop_event.wait

    def record_wait(seconds):
        waits.append(seconds)
        if len(waits) == 3:
            stop_event.set()
            return True
        return original_wait(0)

    monkeypatch.setattr(
        worker_script,
        "process_next_durable_document_job",
        process,
    )
    monkeypatch.setattr(stop_event, "wait", record_wait)
    monkeypatch.setattr(worker_script.time, "sleep", lambda _seconds: None)
    failures: queue.Queue[BaseException] = queue.Queue()

    _run_worker_loop(object(), stop_event, failures)

    assert waits == [1.0, 2.0, 1.0]
    assert failures.empty()


def _mark_first_entry_encrypted(content: bytes) -> bytes:
    patched = bytearray(content)
    local = patched.find(b"PK\x03\x04")
    central = patched.find(b"PK\x01\x02")
    assert local >= 0 and central >= 0
    patched[local + 6] |= 0x01
    patched[central + 8] |= 0x01
    return bytes(patched)


def test_document_ipc_uses_json_and_hashed_binary_sidecars(tmp_path: Path) -> None:
    manifest_path = tmp_path / "input.json"
    content = _minimal_xlsx()
    write_job_manifest(
        manifest_path,
        "validate_ooxml",
        {"content": content, "kind": "xlsx"},
        image_root=tmp_path / "images",
    )

    assert manifest_path.read_bytes().startswith(b'{"format":"biddingflow-document-job"')
    operation, payload = read_job_manifest(manifest_path, tmp_path.resolve())
    assert operation == "validate_ooxml"
    assert payload == {"content": content, "kind": "xlsx"}

    sidecar = next(tmp_path.glob("input-*.bin"))
    sidecar.write_bytes(sidecar.read_bytes() + b"tampered")
    with pytest.raises(DocumentIpcError, match="Kích thước|Hash"):
        read_job_manifest(manifest_path, tmp_path.resolve())


def test_parent_rejects_tampered_binary_result(tmp_path: Path) -> None:
    result_path = tmp_path / "result.json"
    write_result(result_path, result=b"safe-result")
    result_binary = tmp_path / "result.bin"
    result_binary.write_bytes(b"attacker-controlled")
    with pytest.raises(DocumentIpcError, match="Kích thước|Hash"):
        read_result(result_path, tmp_path.resolve())


def test_parent_rejects_result_schema_confusion(tmp_path: Path) -> None:
    result_path = tmp_path / "result.json"
    result_path.write_text(
        json.dumps({"format": "biddingflow-document-result", "version": 1, "ok": True, "result": True, "extra": "payload"}),
        encoding="utf-8",
    )
    with pytest.raises(DocumentIpcError, match="Schema"):
        read_result(result_path, tmp_path.resolve())


def test_document_subprocess_roundtrip_and_cleanup(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    worker_root = tmp_path / "worker-jobs"
    monkeypatch.setenv("DOCUMENT_WORKER_TEMP_DIR", str(worker_root))
    monkeypatch.setenv("APP_ENV", "test")

    assert run_document_job(
        "validate_ooxml",
        {"content": _minimal_xlsx(), "kind": "xlsx"},
        timeout_seconds=15,
    ) is True
    exported = run_document_job(
        "export_excel",
        {"function": "create_mothau_template", "args": ["TU_VAN", []]},
        timeout_seconds=15,
    )
    assert isinstance(exported, bytes) and exported.startswith(b"PK\x03\x04")
    assert not worker_root.exists() or not any(worker_root.iterdir())


def test_document_subprocess_rejects_malformed_archive(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DOCUMENT_WORKER_TEMP_DIR", str(tmp_path / "worker-jobs"))
    monkeypatch.setenv("APP_ENV", "test")
    with pytest.raises(DocumentWorkerInputError):
        run_document_job(
            "validate_ooxml",
            {"content": b"not-an-xlsx", "kind": "xlsx"},
            timeout_seconds=15,
        )


def test_production_requires_external_document_worker_mode() -> None:
    with pytest.raises(RuntimeError, match="external"):
        document_worker_execution_mode({"APP_ENV": "production"})
    with pytest.raises(RuntimeError, match="cannot execute"):
        document_worker_execution_mode(
            {
                "APP_ENV": "production",
                "DOCUMENT_WORKER_EXECUTION_MODE": "embedded",
            }
        )
    assert document_worker_execution_mode(
        {
            "APP_ENV": "production",
            "DOCUMENT_WORKER_EXECUTION_MODE": "external",
        }
    ) == "external"
    assert document_worker_execution_mode({"APP_ENV": "test"}) == "embedded"


def test_external_web_consumer_never_claims_or_executes_job(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _Connection:
        def execute(self, _statement, _parameters=()):
            return self

        def fetchone(self):
            return {
                "status": "completed",
                "last_error_code": None,
                "last_error_message": None,
            }

        def close(self):
            return None

    class _Database:
        def get_connection(self):
            return _Connection()

    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("DOCUMENT_WORKER_EXECUTION_MODE", "external")
    monkeypatch.setattr(
        document_worker,
        "_document_job_dir",
        lambda _job_id: tmp_path,
    )
    monkeypatch.setattr(
        document_worker,
        "_claim_durable_document_job",
        lambda *_args, **_kwargs: pytest.fail("web process claimed an external job"),
    )
    monkeypatch.setattr(document_worker, "_read_result", lambda *_args: b"result")
    monkeypatch.setattr(
        document_worker,
        "_delete_consumed_completed_document_job",
        lambda *_args, **_kwargs: True,
    )

    assert _consume_durable_document_result(
        "a" * 32,
        database=_Database(),
        timeout_seconds=1,
    ) == b"result"


def test_external_queue_admission_is_cluster_wide_and_cleans_rejected_job(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _Result:
        def __init__(self, value=0):
            self.value = value

        def fetchone(self):
            return (self.value,)

    class _Connection:
        def __init__(self):
            self.calls = []
            self.rolled_back = False

        def execute(self, statement, parameters=()):
            self.calls.append((" ".join(statement.split()), tuple(parameters)))
            if "COUNT(*) FROM document_jobs" in statement:
                return _Result(1)
            return _Result()

        def commit(self):
            pytest.fail("a rejected queue admission must not commit")

        def rollback(self):
            self.rolled_back = True

        def close(self):
            return None

    connection = _Connection()

    class _Database:
        def get_connection(self):
            return connection

    worker_root = tmp_path / "exchange"
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("DOCUMENT_WORKER_EXECUTION_MODE", "external")
    monkeypatch.setenv("DOCUMENT_WORKER_TEMP_DIR", str(worker_root))
    monkeypatch.setenv("DOCUMENT_WORKER_MAX_CONCURRENCY", "1")
    monkeypatch.setenv("DOCUMENT_WORKER_QUEUE_SIZE", "0")
    monkeypatch.setenv("DOCUMENT_WORKER_INSTANCE_COUNT", "1")
    monkeypatch.setattr(
        document_worker,
        "_prepare_external_job_permissions",
        lambda _job_dir: None,
    )

    with pytest.raises(DocumentWorkerBusyError):
        _enqueue_durable_document_job(
            "validate_ooxml",
            {"content": _minimal_xlsx(), "kind": "xlsx"},
            database=_Database(),
        )

    assert connection.rolled_back is True
    assert any("pg_advisory_xact_lock" in sql for sql, _ in connection.calls)
    assert not list(worker_root.glob("job-*"))


def test_external_startup_removes_only_old_rowless_job_directories(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    durable_id = "c" * 32
    orphan_id = "d" * 32
    worker_root = tmp_path / "exchange"
    durable_dir = worker_root / f"job-{durable_id}"
    orphan_dir = worker_root / f"job-{orphan_id}"
    invalid_dir = worker_root / "job-not-a-valid-id"
    for directory in (durable_dir, orphan_dir, invalid_dir):
        directory.mkdir(parents=True, exist_ok=True)
        os.utime(directory, (1, 1))

    class _Result:
        def fetchall(self):
            return [{"id": durable_id}]

    class _Connection:
        def execute(self, statement):
            assert "SELECT id FROM document_jobs" in statement
            return _Result()

        def close(self):
            return None

    class _Database:
        def get_connection(self):
            return _Connection()

    monkeypatch.setenv("DOCUMENT_WORKER_TEMP_DIR", str(worker_root))

    assert cleanup_orphaned_durable_document_jobs(
        _Database(),
        min_age_seconds=60,
    ) == 1
    assert durable_dir.is_dir()
    assert not orphan_dir.exists()
    assert invalid_dir.is_dir()


def test_external_worker_uses_only_job_scoped_image_root(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    job_id = "b" * 32
    job_dir = tmp_path / f"job-{job_id}"
    job_dir.mkdir()
    write_job_manifest(
        job_dir / "input.json",
        "validate_ooxml",
        {"content": _minimal_xlsx(), "kind": "xlsx"},
        image_root=tmp_path / "images",
    )
    captured = {}
    monkeypatch.setattr(document_worker, "_document_job_dir", lambda _job_id: job_dir)
    monkeypatch.setattr(
        document_worker,
        "run_document_job",
        lambda operation, payload, **kwargs: captured.update(
            operation=operation,
            payload=payload,
            image_root=kwargs.get("image_root"),
        ) or True,
    )
    monkeypatch.setattr(
        document_worker,
        "_finish_durable_document_job",
        lambda *_args, **_kwargs: "completed",
    )
    monkeypatch.setattr(
        document_worker,
        "_prepare_external_job_permissions",
        lambda _job_dir: None,
    )

    document_worker._process_claimed_document_job(
        object(),
        {
            "id": job_id,
            "operation": "validate_ooxml",
            "attempt_count": 1,
            "lock_token": "lock",
        },
    )

    assert captured["image_root"] == job_dir / "assets" / "images"
    assert (job_dir / "result.json").is_file()


def test_external_exchange_permissions_are_group_only(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    job_dir = tmp_path / "job"
    nested = job_dir / "assets"
    nested.mkdir(parents=True)
    payload = nested / "input.bin"
    payload.write_bytes(b"data")
    job_dir.chmod(0o700)
    nested.chmod(0o700)
    payload.chmod(0o600)
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("DOCUMENT_WORKER_EXECUTION_MODE", "external")
    monkeypatch.setattr(document_worker, "_external_worker_shared_gid", lambda: 987)
    monkeypatch.setattr(
        document_worker.os,
        "chown",
        lambda *_args: None,
        raising=False,
    )
    chmod_calls = []
    monkeypatch.setattr(
        document_worker.os,
        "chmod",
        lambda target, mode: chmod_calls.append((Path(target), mode)),
    )

    _prepare_external_job_permissions(job_dir)

    assert (job_dir, 0o770) in chmod_calls
    assert (nested, 0o770) in chmod_calls
    assert (payload, 0o660) in chmod_calls


def test_worker_database_url_and_secret_boundary_fail_closed() -> None:
    safe_environment = {
        "DATABASE_DOCUMENT_WORKER_ROLE": "biddingflow_document_worker",
    }
    _validate_document_worker_database_url(
        "postgresql://biddingflow_document_worker:secret@db.internal/biddingflow?sslmode=verify-full",
        safe_environment,
    )
    with pytest.raises(RuntimeError, match="verify-full"):
        _validate_document_worker_database_url(
            "postgresql://biddingflow_document_worker:secret@db.internal/biddingflow?sslmode=require",
            safe_environment,
        )
    with pytest.raises(RuntimeError, match="DATABASE_DOCUMENT_WORKER_ROLE"):
        _validate_document_worker_database_url(
            "postgresql://biddingflow_app:secret@db.internal/biddingflow?sslmode=verify-full",
            safe_environment,
        )
    _validate_worker_secret_boundary({"PATH": "/usr/bin"})
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        _validate_worker_secret_boundary({"DATABASE_URL": "postgresql://secret"})


def test_deployment_verifier_parses_only_strict_environment_entries(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    environment_file = tmp_path / "document-worker.env"
    environment_file.write_text(
        "# comment\nAPP_ENV=production\nDOCUMENT_WORKER_SANDBOX=\"bwrap\"\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(
        "scripts.verify_document_worker_deployment._secure_regular_file",
        lambda *args, **kwargs: None,
    )
    assert parse_environment_file(environment_file) == {
        "APP_ENV": "production",
        "DOCUMENT_WORKER_SANDBOX": "bwrap",
    }
    environment_file.write_text("export APP_ENV=production\n", encoding="utf-8")
    with pytest.raises(VerificationError, match="Unsupported environment syntax"):
        parse_environment_file(environment_file)


def test_deployment_verifier_rejects_weaker_systemd_limits(tmp_path: Path) -> None:
    environment_file = tmp_path / "document-worker.env"
    environment_file.write_text("placeholder", encoding="utf-8")
    worker = {
        "ActiveState": "active",
        "SubState": "running",
        "User": "biddingflow-document-worker",
        "Group": "biddingflow-documents",
        "NoNewPrivileges": "yes",
        "CapabilityBoundingSet": "",
        "AmbientCapabilities": "",
        "PrivateDevices": "yes",
        "PrivateTmp": "yes",
        "ProtectHome": "yes",
        "ProtectSystem": "strict",
        "ProtectProc": "invisible",
        "ProcSubset": "pid",
        "KillMode": "control-group",
        "RestrictAddressFamilies": "AF_UNIX AF_INET AF_INET6",
        "IPAddressDeny": "any",
        "IPAddressAllow": "localhost 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 fd00::/8",
        "ReadWritePaths": str(tmp_path / "exchange"),
        "EnvironmentFiles": f"{environment_file} (ignore_errors=no)",
        "CPUQuotaPerSecUSec": "2s",
        "MemoryMax": str(2 * 1024 * 1024 * 1024),
        "TasksMax": "64",
        "LimitNOFILE": "512",
        "LimitFSIZE": str(128 * 1024 * 1024),
        "MainPID": "1234",
        "FragmentPath": "/etc/systemd/system/biddingflow-document-worker.service",
    }
    web = {
        "ActiveState": "active",
        "SubState": "running",
        "User": "biddingflow",
        "Group": "biddingflow",
        "SupplementaryGroups": "biddingflow-documents",
        "BindsTo": "biddingflow-document-worker.service",
        "MainPID": "2345",
    }
    environment_file.parent.joinpath("exchange").mkdir()
    worker["MemoryMax"] = str(2 * 1024 * 1024 * 1024 + 1)
    with pytest.raises(VerificationError, match="MemoryMax"):
        validate_worker_unit_properties(
            worker,
            web,
            exchange_root=Path(worker["ReadWritePaths"]),
            environment_file=environment_file,
        )


def test_systemd_units_keep_web_and_document_worker_boundaries_separate() -> None:
    worker_unit = (
        PROJECT_ROOT / "deploy" / "biddingflow-document-worker.service.example"
    ).read_text(encoding="utf-8")
    web_unit = (
        PROJECT_ROOT / "deploy" / "biddingflow.service.example"
    ).read_text(encoding="utf-8")
    worker_environment = (
        PROJECT_ROOT / "deploy" / "biddingflow-document-worker.env.example"
    ).read_text(encoding="utf-8")

    assert "User=biddingflow-document-worker" in worker_unit
    assert "Group=biddingflow-documents" in worker_unit
    assert "EnvironmentFile=/etc/biddingflow/document-worker.env" in worker_unit
    assert "ExecStartPre=/opt/biddingflow/.venv/bin/python scripts/verify_document_sandbox.py" in worker_unit
    assert "IPAddressDeny=any" in worker_unit
    assert "ReadWritePaths=/var/lib/biddingflow-document-jobs" in worker_unit
    assert "ReadWritePaths=/var/lib/biddingflow " not in worker_unit
    assert "User=biddingflow\n" in web_unit
    assert "SupplementaryGroups=biddingflow-documents" in web_unit
    assert "BindsTo=biddingflow-document-worker.service" in web_unit
    assert "DOCUMENT_WORKER_DATABASE_URL=" in worker_environment
    worker_environment_keys = {
        line.split("=", 1)[0]
        for line in worker_environment.splitlines()
        if line and not line.startswith("#") and "=" in line
    }
    assert "DATABASE_URL" not in worker_environment_keys
    assert "SMTP_PASSWORD" not in worker_environment_keys


@pytest.mark.parametrize(
    "content",
    [
        _minimal_xlsx([("../escape.xml", "<safe/>")]),
        _minimal_xlsx([("xl/worksheets/sheet1.xml", "0" * 1_000_000)]),
        _minimal_xlsx([
            (
                "_rels/.rels",
                """<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                <Relationship Id="rId1" Target="https://attacker.invalid" TargetMode="External" Type="x"/>
                </Relationships>""",
            )
        ]),
        _mark_first_entry_encrypted(_minimal_xlsx()),
        _minimal_xlsx(
            content_types="""<!DOCTYPE x [<!ENTITY payload "boom">]>
            <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
              <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
            </Types>"""
        ),
    ],
    ids=["zip-slip", "zip-bomb", "external-relationship", "encrypted", "entity-expansion"],
)
def test_document_subprocess_rejects_hostile_ooxml(
    content: bytes,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DOCUMENT_WORKER_TEMP_DIR", str(tmp_path / "worker-jobs"))
    monkeypatch.setenv("APP_ENV", "test")
    with pytest.raises(DocumentWorkerInputError):
        run_document_job(
            "validate_ooxml",
            {"content": content, "kind": "xlsx"},
            timeout_seconds=15,
        )


def test_bwrap_command_mounts_backend_not_project_secrets(tmp_path: Path) -> None:
    job_dir = tmp_path.resolve()
    command = build_bwrap_command(
        ["/usr/bin/python3", "-m", "backend.documents.document_worker_entry"],
        job_dir,
        {"PYTHONPATH": str(PROJECT_ROOT)},
        executable="/usr/bin/bwrap",
    )
    mounts = [
        (command[index + 1], command[index + 2])
        for index, value in enumerate(command[:-2])
        if value in {"--ro-bind", "--bind"}
    ]
    assert (str((PROJECT_ROOT / "backend").resolve()), str((PROJECT_ROOT / "backend").resolve())) in mounts
    assert (str(PROJECT_ROOT.resolve()), str(PROJECT_ROOT.resolve())) not in mounts
    assert (str(job_dir), str(job_dir)) in mounts
    assert "--unshare-user" in command
    assert "--unshare-net" in command
    assert "--unshare-pid" in command
    assert "--disable-userns" in command
    assert command[command.index("--uid") + 1] == "65534"
    assert command[command.index("--gid") + 1] == "65534"
    assert "--clearenv" in command


def test_bwrap_tmpfs_is_mounted_before_job_directory_below_tmp(
    tmp_path: Path,
) -> None:
    job_dir = (tmp_path / "worker-jobs" / "job-1").resolve()
    job_dir.mkdir(parents=True)
    command = build_bwrap_command(
        ["/usr/bin/python3", "-m", "backend.documents.document_worker_entry"],
        job_dir,
        {"PYTHONPATH": str(PROJECT_ROOT)},
        executable="/usr/bin/bwrap",
    )

    tmpfs_index = command.index("--tmpfs")
    job_bind_index = next(
        index
        for index, value in enumerate(command)
        if value == "--bind" and command[index + 1] == str(job_dir)
    )
    assert tmpfs_index < job_bind_index


def test_document_sandbox_identity_must_differ_from_web_service() -> None:
    environment = {
        "DOCUMENT_WORKER_SANDBOX_UID": "65534",
        "DOCUMENT_WORKER_SANDBOX_GID": "65533",
    }
    assert _validate_distinct_sandbox_identity(
        environment,
        parent_uid=1000,
        parent_gid=1000,
    ) == ("65534", "65533")
    with pytest.raises(RuntimeError, match="UID"):
        _validate_distinct_sandbox_identity(
            environment,
            parent_uid=65534,
            parent_gid=1000,
        )
    with pytest.raises(RuntimeError, match="GID"):
        _validate_distinct_sandbox_identity(
            environment,
            parent_uid=1000,
            parent_gid=65533,
        )


def test_document_timeout_kills_worker_and_cleans_job_directory(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    worker_root = tmp_path / "worker-jobs"
    monkeypatch.setenv("DOCUMENT_WORKER_TEMP_DIR", str(worker_root))
    monkeypatch.setenv("APP_ENV", "test")

    with pytest.raises(DocumentWorkerTimeoutError):
        run_document_job(
            "test_delay",
            {"seconds": 3},
            timeout_seconds=1,
        )
    assert not worker_root.exists() or not any(worker_root.iterdir())
    assert run_document_job(
        "validate_ooxml",
        {"content": _minimal_xlsx(), "kind": "xlsx"},
        timeout_seconds=15,
    ) is True


def test_seccomp_policy_denies_network_process_and_kernel_escape_syscalls() -> None:
    required = {
        "clone",
        "clone3",
        "fork",
        "vfork",
        "execve",
        "execveat",
        "socket",
        "socketpair",
        "connect",
        "mount",
        "ptrace",
        "unshare",
        "setns",
    }
    assert required <= set(_DENIED_SYSCALLS)


def test_worker_resolves_seccomp_before_entering_minimal_root(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DOCUMENT_WORKER_SECCOMP_LIBRARY", "libseccomp.so.2")

    environment = _worker_environment(tmp_path)

    assert environment["DOCUMENT_WORKER_SECCOMP_LIBRARY"] == "libseccomp.so.2"


def test_ubuntu_ci_uses_targeted_bwrap_user_namespace_profile() -> None:
    profile = (PROJECT_ROOT / "deploy" / "apparmor-biddingflow-bwrap").read_text(
        encoding="utf-8"
    )
    workflow = (
        PROJECT_ROOT / ".github" / "workflows" / "security-quality.yml"
    ).read_text(encoding="utf-8")

    assert "/usr/bin/bwrap flags=(unconfined)" in profile
    assert "userns," in profile
    assert "apparmor_parser --replace /etc/apparmor.d/biddingflow-bwrap" in workflow
    assert "apparmor_restrict_unprivileged_userns=0" not in workflow
    assert "kernel.apparmor_restrict_unprivileged_userns=0" not in workflow


@pytest.mark.skipif(
    os.name != "posix" or not shutil.which("bwrap") or not seccomp_library_name(),
    reason="Real Bubblewrap/seccomp probe requires a Linux staging runner.",
)
def test_real_linux_document_sandbox_probe(tmp_path: Path) -> None:
    environment = os.environ.copy()
    environment["DOCUMENT_WORKER_TEMP_DIR"] = str(tmp_path / "worker-jobs")
    completed = subprocess.run(
        [sys.executable, "scripts/verify_document_sandbox.py"],
        cwd=PROJECT_ROOT,
        env=environment,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=30,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr.decode(
        "utf-8", errors="replace"
    )
