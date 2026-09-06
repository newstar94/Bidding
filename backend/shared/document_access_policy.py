"""Word configuration and document-export capability policy."""

from dataclasses import dataclass

from backend.commercial_policy.config import trial_full_access_enabled
from backend.shared.access_principals import (
    has_active_organization_membership,
    is_organization_manager,
    is_personal_workspace_owner,
)
from backend.shared.subscription_policy import can_use_word_export


@dataclass(frozen=True)
class DocumentExportCapabilities:
    """Effective permission to place sensitive field families in a document."""

    financial: bool = False
    identity: bool = False
    signature: bool = False

    @classmethod
    def allow_all(cls):
        return cls(financial=True, identity=True, signature=True)

    def as_dict(self):
        return {
            "financial": self.financial,
            "identity": self.identity,
            "signature": self.signature,
        }


def _stored_document_export_capabilities(cursor, user_id, organization_id):
    row = cursor.execute(
        """SELECT financial, identity, signature
           FROM document_export_capabilities
           WHERE organization_id = ? AND user_id = ?
           LIMIT 1""",
        (organization_id, user_id),
    ).fetchone()
    if not row:
        return DocumentExportCapabilities()
    return DocumentExportCapabilities(
        financial=bool(row[0]),
        identity=bool(row[1]),
        signature=bool(row[2]),
    )


def resolve_document_export_capabilities(cursor, role_str, user_id, organization_id):
    """Resolve field-family grants after workspace and subscription checks."""

    if not can_use_word_export(cursor, role_str, user_id, organization_id):
        return DocumentExportCapabilities()
    if trial_full_access_enabled():
        return DocumentExportCapabilities.allow_all()
    if is_personal_workspace_owner(cursor, user_id, organization_id):
        return DocumentExportCapabilities.allow_all()
    if is_organization_manager(cursor, role_str, user_id, organization_id):
        return DocumentExportCapabilities.allow_all()
    if has_active_organization_membership(cursor, role_str, user_id, organization_id):
        return _stored_document_export_capabilities(cursor, user_id, organization_id)
    return DocumentExportCapabilities()


def can_read_word_config(cursor, role_str, user_id, organization_id):
    """Allow members to use the Word configuration of the active workspace."""

    if not can_use_word_export(cursor, role_str, user_id, organization_id):
        return False
    if is_organization_manager(cursor, role_str, user_id, organization_id):
        return True
    if is_personal_workspace_owner(cursor, user_id, organization_id):
        return True
    return has_active_organization_membership(cursor, role_str, user_id, organization_id)


def can_manage_word_config(cursor, role_str, user_id, organization_id):
    """Allow only a personal owner or organization manager to change Word config."""

    if not can_read_word_config(cursor, role_str, user_id, organization_id):
        return False
    return bool(
        is_personal_workspace_owner(cursor, user_id, organization_id)
        or is_organization_manager(cursor, role_str, user_id, organization_id)
    )
