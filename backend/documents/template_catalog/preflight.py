"""Pure, version-pinned compatibility preflight for immutable DOCX versions."""

from __future__ import annotations

import hashlib
import json
from zipfile import BadZipFile

from backend.documents.docx_context_policy import (
    MANIFEST_VERSION,
    ROOT_SPECS_BY_DOCUMENT_TYPE,
    validate_mapping_definition,
)
from backend.documents.template_security import extract_docx_template_root_keys
from backend.documents.word_defaults import WORD_DEFAULT_MAPPINGS_VERSION
from backend.documents.word_mapping_registry import resolve_word_mappings

from .service import CatalogNotFoundError


PARSER_VERSION = "docx-template-security.v1"
REQUIRED_REGISTRY_VERSION = "approved-empty-v1"
CONTEXT_POLICY_VERSION = f"docx-context-policy.v{MANIFEST_VERSION}"
REPORT_SCHEMA_VERSION = 1

# Product approved a versioned empty required set until exact fixtures define
# required variables. Template text is never promoted into requirements.
REQUIRED_VARIABLES_BY_DOCUMENT_TYPE: dict[str, frozenset[str]] = {}


def _canonical(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


class TemplatePreflight:
    def __init__(self, repository, storage):
        self.repository = repository
        self.storage = storage

    def run(
        self, *, organization_id: str, version_id: str, actor_user_id: str,
        document_types=None,
    ):
        version = self.repository.get_version(organization_id, version_id)
        if version is None:
            raise CatalogNotFoundError()
        selected_types = self._document_types(document_types)
        mappings = resolve_word_mappings(
            self.repository.cursor, organization_id, include_disabled=False
        )
        mapping_snapshot = [
            {
                "mappingKey": item.get("mapping_key"),
                "name": item.get("ten_bien"),
                "sourceTable": item.get("source_table"),
                "sourceColumn": item.get("source_column"),
                "baseVersion": item.get("base_version"),
                "origin": item.get("origin"),
            }
            for item in sorted(
                mappings,
                key=lambda item: (
                    str(item.get("ten_bien") or ""), str(item.get("id") or "")
                ),
            )
        ]
        mapping_json = _canonical(mapping_snapshot)
        mapping_hash = hashlib.sha256(mapping_json.encode("utf-8")).hexdigest()
        issues = []
        roots = set()
        content = self.storage.read(
            organization_id, version["storageKey"], version["sha256"]
        )
        try:
            roots = extract_docx_template_root_keys(content)
        except (BadZipFile, KeyError, ValueError) as error:
            issues.append({
                "code": "INVALID_TEMPLATE_STATEMENT",
                "severity": "BLOCKER",
                "message": str(error)[:500],
            })

        allowed_context_roots = {
            root
            for document_type in selected_types
            for root in ROOT_SPECS_BY_DOCUMENT_TYPE[document_type]
        }
        mapping_roots = {
            str(item.get("ten_bien") or "").strip()
            for item in mappings
            if str(item.get("ten_bien") or "").strip()
        }
        for root in sorted(roots - allowed_context_roots - mapping_roots):
            issues.append({
                "code": "UNKNOWN_VARIABLE",
                "severity": "BLOCKER",
                "path": root,
            })

        required = set().union(
            *(REQUIRED_VARIABLES_BY_DOCUMENT_TYPE.get(kind, frozenset())
              for kind in selected_types)
        )
        for root in sorted(required - roots):
            issues.append({
                "code": "MISSING_REQUIRED_VARIABLE",
                "severity": "BLOCKER",
                "path": root,
            })

        if len(selected_types) > 1:
            for root in sorted(roots & allowed_context_roots):
                supported = [
                    kind for kind in selected_types
                    if root in ROOT_SPECS_BY_DOCUMENT_TYPE[kind]
                    or root in mapping_roots
                ]
                if len(supported) != len(selected_types):
                    issues.append({
                        "code": "CROSS_CONTEXT_VARIABLE",
                        "severity": "WARNING",
                        "path": root,
                        "supportedDocumentTypes": supported,
                    })

        for mapping in mappings:
            try:
                validate_mapping_definition(
                    mapping.get("ten_bien"),
                    mapping.get("source_table"),
                    mapping.get("source_column"),
                )
            except ValueError:
                issues.append({
                    "code": "INVALID_MAPPING_DEFINITION",
                    "severity": "BLOCKER",
                    "path": str(mapping.get("ten_bien") or ""),
                })

        blockers = sum(item["severity"] == "BLOCKER" for item in issues)
        warnings = sum(item["severity"] == "WARNING" for item in issues)
        report = {
            "schemaVersion": REPORT_SCHEMA_VERSION,
            "templateVersionId": version_id,
            "templateSha256": version["sha256"],
            "parserVersion": PARSER_VERSION,
            "mappingBaseVersion": str(WORD_DEFAULT_MAPPINGS_VERSION),
            "mappingSnapshotHash": mapping_hash,
            "requiredRegistryVersion": REQUIRED_REGISTRY_VERSION,
            "requiredRegistryState": "APPROVED_EMPTY",
            "contextPolicyVersion": CONTEXT_POLICY_VERSION,
            "documentTypes": selected_types,
            "referencedRoots": sorted(roots),
            "issues": issues,
            "summary": {"blockers": blockers, "warnings": warnings},
        }
        report_json = _canonical(report)
        return self.repository.insert_preflight(
            organization_id=organization_id,
            values={
                "template_version_id": version_id,
                "template_sha256": version["sha256"],
                "parser_version": PARSER_VERSION,
                "mapping_base_version": str(WORD_DEFAULT_MAPPINGS_VERSION),
                "mapping_snapshot_hash": mapping_hash,
                "required_registry_version": REQUIRED_REGISTRY_VERSION,
                "context_policy_version": CONTEXT_POLICY_VERSION,
                "report_json": report_json,
                "report_hash": hashlib.sha256(report_json.encode("utf-8")).hexdigest(),
                "result": "BLOCKED" if blockers else "PASS",
                "run_by_id": actor_user_id,
            },
        )

    @staticmethod
    def _document_types(values):
        selected = list(
            dict.fromkeys(str(value or "").strip() for value in (values or ()))
        )
        selected = [value for value in selected if value]
        if not selected:
            selected = sorted(ROOT_SPECS_BY_DOCUMENT_TYPE)
        unknown = [
            value for value in selected
            if value not in ROOT_SPECS_BY_DOCUMENT_TYPE
        ]
        if unknown:
            raise ValueError("Unsupported Word preflight document type.")
        return selected
