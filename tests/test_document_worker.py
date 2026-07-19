from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile
from io import BytesIO

import pytest

from backend.documents.document_ipc import (
    DocumentIpcError,
    read_job_manifest,
    read_result,
    write_job_manifest,
    write_result,
)
from backend.documents.document_worker import (
    DocumentWorkerInputError,
    DocumentWorkerTimeoutError,
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
