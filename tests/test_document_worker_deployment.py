from pathlib import Path
import re

import pytest

from scripts.verify_document_worker_deployment import (
    VerificationError,
    merge_worker_environments,
    validate_apparmor_profile,
)


ROOT = Path(__file__).resolve().parents[1]


def _directive_values(content: str, name: str) -> list[str]:
    prefix = f"{name}="
    return [
        line[len(prefix) :].strip()
        for line in content.splitlines()
        if line.startswith(prefix)
    ]


def test_document_worker_systemd_template_matches_verifier_contract():
    worker = (
        ROOT / "deploy/systemd/biddingflow-document-worker.service.example"
    ).read_text(encoding="utf-8")

    assert "User=biddingflow-document-worker" in worker
    assert "Group=biddingflow-documents" in worker
    assert "EnvironmentFile=/etc/biddingflow/document-worker.env" in worker
    assert "EnvironmentFile=/etc/biddingflow/database-document-worker.env" in worker
    assert (
        "ExecStart=/opt/biddingflow/venv/bin/python "
        "/opt/biddingflow/current/scripts/run_document_worker.py"
    ) in worker
    for directive in (
        "NoNewPrivileges=true",
        "PrivateDevices=true",
        "PrivateTmp=true",
        "ProtectHome=true",
        "ProtectSystem=strict",
        "ProtectProc=invisible",
        "ProcSubset=pid",
        "KillMode=control-group",
        "RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6",
        "IPAddressDeny=any",
        "ReadWritePaths=/var/lib/biddingflow-document-jobs",
        "CPUQuota=200%",
        "MemoryMax=2G",
        "TasksMax=64",
        "LimitNOFILE=512",
        "LimitFSIZE=128M",
    ):
        assert directive in worker
    assert "CapabilityBoundingSet=" in worker
    assert "AmbientCapabilities=" in worker
    for network in (
        "localhost",
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
        "fd00::/8",
    ):
        assert f"IPAddressAllow={network}" in worker


def test_web_systemd_template_binds_worker_and_exchange_group():
    web = (ROOT / "deploy/systemd/biddingflow.service.example").read_text(
        encoding="utf-8"
    )

    assert "After=network-online.target postgresql.service biddingflow-document-worker.service" in web
    assert "BindsTo=biddingflow-document-worker.service" in web
    assert "SupplementaryGroups=biddingflow-documents" in web
    assert "ReadWritePaths=/var/lib/biddingflow /var/lib/biddingflow-document-jobs" in web


def test_worker_environment_template_has_no_database_or_application_secrets():
    environment = (ROOT / "deploy/document-worker.env.example").read_text(
        encoding="utf-8"
    )

    assert "DOCUMENT_WORKER_DATABASE_URL" not in environment
    forbidden = (
        "DATABASE_URL",
        "RUNTIME_DATABASE_URL",
        "MIGRATOR_DATABASE_URL",
        "BACKUP_DATABASE_URL",
        "SMTP_PASSWORD",
        "GOOGLE_CLIENT_SECRET",
        "EMAIL_OUTBOX_ENCRYPTION_KEY",
    )
    for name in forbidden:
        assert not re.search(rf"^{re.escape(name)}=", environment, re.MULTILINE)
    for name in (
        "APP_ENV",
        "DOCUMENT_WORKER_EXECUTION_MODE",
        "DOCUMENT_WORKER_SERVICE_USER",
        "DOCUMENT_WORKER_SERVICE_GROUP",
        "DOCUMENT_WORKER_SHARED_GID",
        "DOCUMENT_WORKER_TEMP_DIR",
        "DOCUMENT_WORKER_SANDBOX",
        "DOCUMENT_WORKER_SANDBOX_EXECUTABLE",
        "DOCUMENT_WORKER_SANDBOX_UID",
        "DOCUMENT_WORKER_SANDBOX_GID",
    ):
        assert re.search(rf"^{re.escape(name)}=", environment, re.MULTILINE)


def test_document_worker_verifier_defaults_match_release_layout():
    verifier = (
        ROOT / "scripts/verify_document_worker_deployment.py"
    ).read_text(encoding="utf-8")

    assert 'default=Path("/opt/biddingflow/current")' in verifier
    assert 'default=Path("/opt/biddingflow/venv/bin/python")' in verifier


def test_worker_environment_merge_allows_only_matching_app_env_overlap():
    merged = merge_worker_environments(
        {"APP_ENV": "production", "DOCUMENT_WORKER_SANDBOX": "bwrap"},
        {"APP_ENV": "PRODUCTION", "DOCUMENT_WORKER_DATABASE_URL": "scoped"},
    )
    assert merged["APP_ENV"] == "PRODUCTION"
    with pytest.raises(VerificationError, match="conflicting APP_ENV"):
        merge_worker_environments(
            {"APP_ENV": "development"}, {"APP_ENV": "production"}
        )
    with pytest.raises(VerificationError, match="duplicate settings"):
        merge_worker_environments(
            {"DOCUMENT_WORKER_SANDBOX": "bwrap"},
            {"DOCUMENT_WORKER_SANDBOX": "process"},
        )


def _mock_apparmor_status(monkeypatch, profiles: str, *, enabled: str = "Y\n"):
    original_read_text = Path.read_text

    def read_status(path, *args, **kwargs):
        if path == Path("/sys/module/apparmor/parameters/enabled"):
            return enabled
        if path == Path("/sys/kernel/security/apparmor/profiles"):
            return profiles
        return original_read_text(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", read_status)


@pytest.mark.parametrize(
    "profiles",
    [
        "/usr/bin/bwrap (enforce)\n",
        "bwrap (enforce)\n/usr/sbin/other (complain)\n",
        " /usr/sbin/other (complain)\n  bwrap (enforce)  \n",
    ],
)
def test_apparmor_accepts_exact_enforced_bubblewrap_profile(monkeypatch, profiles):
    _mock_apparmor_status(monkeypatch, profiles)

    validate_apparmor_profile()


@pytest.mark.parametrize(
    "profiles",
    [
        "/usr/bin/bwrap (complain)\n/usr/sbin/other (enforce)\n",
        "/usr/sbin/other (enforce)\nbwrap (complain)\n",
        "/usr/bin/bwrap-helper (enforce)\n",
        "/usr/bin/bwrap//child (enforce)\n",
        "other-bwrap (enforce)\n",
        "/usr/bin/bwrap (enforce) trailing\n",
        "/usr/sbin/other (enforce)\n",
        "",
    ],
)
def test_apparmor_requires_enforcement_on_exact_bubblewrap_profile(monkeypatch, profiles):
    _mock_apparmor_status(monkeypatch, profiles)

    with pytest.raises(VerificationError, match="enforced Bubblewrap"):
        validate_apparmor_profile()


def test_apparmor_rejects_disabled_module_even_with_enforced_profile(monkeypatch):
    _mock_apparmor_status(monkeypatch, "/usr/bin/bwrap (enforce)\n", enabled="N\n")

    with pytest.raises(VerificationError, match="not enabled"):
        validate_apparmor_profile()
