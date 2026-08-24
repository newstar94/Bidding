"""PostgreSQL adapter for fresh-authorized compliance facts."""

from __future__ import annotations

from backend.legal_versioning.repository import LegalVersioningRepository
from backend.legal_versioning.service import LegalVersioningService
from backend.version_comparison.read_repository import VersionComparisonReadRepository


_ENTITY = {
    "kehoach": ("plan", "ke_hoach_lcnt"),
    "goithau": ("package", "goi_thau"),
}


class ComplianceContextRepository:
    def __init__(self, cursor, visibility_scope):
        self.cursor = cursor
        self.visibility_scope = visibility_scope
        self.version_repository = VersionComparisonReadRepository(cursor, visibility_scope)
        self.legal_repository = LegalVersioningRepository(cursor)

    def load_authorized_snapshot(self, target_type, target_id, version_id=None):
        if target_type not in _ENTITY:
            return None
        exact_id = str(version_id or target_id or "").strip()
        record = self.version_repository.authorize_version(target_type, exact_id)
        if record is None:
            return None
        root_id = str(record.get("rootId") or record.get("id") or "")
        target_id = str(target_id or "").strip()
        if target_id not in {str(record.get("id") or ""), root_id}:
            return None
        snapshot = self.version_repository.load_snapshot(target_type, record)
        snapshot["organizationId"] = self.visibility_scope.organization_id
        return snapshot

    def load_legal(self, snapshot):
        target_type = _ENTITY[snapshot["entityType"]][0]
        record_id = str((snapshot.get("record") or {}).get("id") or "")
        binding = self.legal_repository.get_binding(
            self.visibility_scope.organization_id, target_type, record_id
        )
        sources = []
        if binding and binding.get("profileVersionId"):
            payload = LegalVersioningService(self.legal_repository).get_exact_sources(
                binding["profileVersionId"]
            )
            sources = payload.get("sources") or []
        return binding, sources

    def load_documents(self, snapshot):
        record = snapshot.get("record") or {}
        rows = self.cursor.execute(
            """SELECT artifact_id, template_version_id, template_sha256,
                      record_row_version, artifact_sha256, created_at
                 FROM generated_document_provenance
                WHERE organization_id = ? AND record_type = ? AND record_id = ?
                ORDER BY created_at DESC LIMIT 200""",
            (
                self.visibility_scope.organization_id,
                _ENTITY[snapshot["entityType"]][1],
                str(record.get("id") or ""),
            ),
        ).fetchall()
        return [{
            "artifactId": row[0], "templateVersionId": row[1],
            "templateSha256": row[2], "recordRowVersion": row[3],
            "artifactSha256": row[4], "createdAt": row[5],
        } for row in rows]
