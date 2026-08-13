from types import SimpleNamespace

from backend.documents.document_job_policy import (
    DocumentJobAuthorizationError,
    build_document_job_policy,
    verify_document_job_policy,
)


def test_document_job_policy_is_canonical_and_binds_revision_and_active_role():
    role = SimpleNamespace(
        user_id="user",
        platform_role="user",
        active_role="employee",
        active_role_organization_id="org",
    )

    policy, fingerprint = build_document_job_policy(
        role,
        package_revision=7,
        required_sensitive_groups=["signature", "financial", "signature"],
        document_format="docx",
    )

    assert policy == {
        "version": 1,
        "format": "docx",
        "platformRole": "user",
        "activeRole": "employee",
        "activeRoleOrganizationId": "org",
        "packageRevision": 7,
        "requiredSensitiveGroups": ["financial", "signature"],
    }
    assert len(fingerprint) == 64


class _Cursor:
    def execute(self, statement, params=()):
        normalized = " ".join(statement.split())
        if "FROM tai_khoan" in normalized:
            self.row = ("user", "active", "user")
        elif "FROM goi_thau" in normalized:
            self.row = (7,)
        else:
            self.row = None
        return self

    def fetchone(self):
        return self.row


def test_document_job_policy_denies_revoked_sensitive_capability(monkeypatch):
    role = SimpleNamespace(
        user_id="user", platform_role="user", active_role="employee",
        active_role_organization_id="org",
    )
    policy, fingerprint = build_document_job_policy(
        role,
        package_revision=7,
        required_sensitive_groups=["financial"],
        document_format="docx",
    )
    monkeypatch.setattr(
        "backend.documents.document_job_policy.can_use_document_export",
        lambda *_args, **_kwargs: True,
    )
    monkeypatch.setattr(
        "backend.documents.document_job_policy.can_read_record",
        lambda *_args, **_kwargs: True,
    )
    monkeypatch.setattr(
        "backend.documents.document_job_policy.resolve_document_export_capabilities",
        lambda *_args, **_kwargs: SimpleNamespace(
            financial=False, identity=True, signature=True
        ),
    )

    try:
        verify_document_job_policy(
            _Cursor(),
            {
                "organization_id": "org",
                "user_id": "user",
                "package_id": "package",
                "policy_json": policy,
                "policy_hash": fingerprint,
            },
        )
    except DocumentJobAuthorizationError as error:
        assert error.code == "DOCUMENT_EXPORT_PERMISSION_REVOKED"
    else:
        raise AssertionError("revoked sensitive grant must deny the job")


def test_document_job_policy_rejects_tampered_or_legacy_policy():
    for policy, fingerprint in (({}, ""), ({"version": 1}, "0" * 64)):
        try:
            verify_document_job_policy(
                _Cursor(),
                {
                    "organization_id": "org",
                    "user_id": "user",
                    "package_id": "package",
                    "policy_json": policy,
                    "policy_hash": fingerprint,
                },
            )
        except DocumentJobAuthorizationError as error:
            assert error.code == "DOCUMENT_EXPORT_POLICY_INVALID"
        else:
            raise AssertionError("invalid policy must fail closed")
