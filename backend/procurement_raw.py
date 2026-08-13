"""Append-only storage for complete procurement source responses."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
from uuid import uuid4


_SECRET_KEY_PARTS = ("authorization", "cookie", "token", "captcha", "secret")


def _sanitize(value):
    if isinstance(value, list):
        return [_sanitize(item) for item in value]
    if not isinstance(value, dict):
        return value
    return {
        str(key): (
            "[REDACTED]"
            if any(part in str(key).casefold() for part in _SECRET_KEY_PARTS)
            else _sanitize(child)
        )
        for key, child in value.items()
    }


def _json(value):
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def _digest(value):
    return sha256(_json(value).encode("utf-8")).hexdigest()


def _row_value(row, key, index):
    try:
        return row[key]
    except (KeyError, TypeError):
        return row[index]


def _loads(value, default=None):
    if value in (None, ""):
        return default
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return default


def _revision_sort_key(value):
    text = str(value or "")
    return (int(text) if text.isdigit() else -1, text)


def _package_keys(value):
    best = []

    def visit(candidate, depth=0):
        nonlocal best
        if depth > 12 or not isinstance(candidate, (dict, list)):
            return
        if isinstance(candidate, list):
            rows = [
                row for row in candidate
                if isinstance(row, dict)
                and (row.get("idDetail") or row.get("id") or row.get("bidNo"))
            ]
            if len(rows) > len(best):
                best = rows
            for child in candidate:
                visit(child, depth + 1)
            return
        for child in candidate.values():
            visit(child, depth + 1)

    visit(value)
    return {
        str(row.get("idDetail") or row.get("id") or row.get("bidNo"))
        for row in best
    }


def _revision_numbers(value):
    """Extract the version-list contract while keeping unknown fields opaque."""

    candidates = []
    pending = [value]
    visited = 0
    while pending and visited < 100_000:
        candidate = pending.pop()
        visited += 1
        if isinstance(candidate, list):
            rows = [
                row for row in candidate
                if isinstance(row, dict)
                and (row.get("id") or row.get("revisionId"))
                and (
                    row.get("planVersion") is not None
                    or row.get("notifyVersion") is not None
                    or row.get("revisionNumber") is not None
                )
            ]
            if len(rows) > len(candidates):
                candidates = rows
            pending.extend(candidate)
        elif isinstance(candidate, dict):
            pending.extend(candidate.values())
    return {
        str(
            row.get("planVersion")
            if row.get("planVersion") is not None
            else (
                row.get("notifyVersion")
                if row.get("notifyVersion") is not None
                else row.get("revisionNumber")
            )
        ).strip().zfill(2)
        for row in candidates
    }


def iter_raw_sources(bundle):
    """Yield source envelopes with their revision/package ownership."""

    for source in (bundle.get("sources") or {}).values():
        if isinstance(source, dict) and source.get("operation"):
            yield None, None, None, source
    for revision_number, revision in (bundle.get("revisions") or {}).items():
        revision = revision if isinstance(revision, dict) else {}
        revision_id = revision.get("revisionId")
        for source in (revision.get("sources") or {}).values():
            if isinstance(source, dict) and source.get("operation"):
                yield str(revision_number), revision_id, None, source
        for package_key, package in (revision.get("packages") or {}).items():
            package = package if isinstance(package, dict) else {}
            for source in (package.get("sources") or {}).values():
                if isinstance(source, dict) and source.get("operation"):
                    yield (
                        str(revision_number),
                        revision_id,
                        str(package_key),
                        source,
                    )


class ProcurementRawSnapshotRepository:
    """Persist immutable upstream evidence and deduplicate identical captures."""

    def __init__(self, *, database):
        self.database = database

    def save_bundle(self, organization_id, bundle):
        if not isinstance(bundle, dict) or bundle.get("schemaVersion") != (
            "biddingflow-muasamcong-raw-bundle-v2"
        ):
            raise ValueError("Invalid procurement raw bundle")
        entity = bundle.get("entity") or {}
        entity_kind = str(entity.get("kind") or "").upper()
        canonical_code = str(
            entity.get("canonicalCode") or entity.get("planNo") or ""
        ).upper()
        if not organization_id or not entity_kind or not canonical_code:
            raise ValueError("Raw bundle ownership is incomplete")
        inserted = 0
        duplicates = 0
        connection = self.database.get_connection()
        try:
            for revision_number, revision_id, package_key, source in (
                iter_raw_sources(bundle)
            ):
                request = _sanitize(source.get("request"))
                response = _sanitize(source.get("response"))
                error = _sanitize(source.get("error"))
                response_hash = _digest(response)
                context = {
                    "entityKind": entity_kind,
                    "canonicalCode": canonical_code,
                    "revisionId": revision_id,
                    "revisionNumber": revision_number,
                    "childEntityKind": "PACKAGE" if package_key else None,
                    "childEntityId": package_key,
                    "operation": source.get("operation"),
                    "contentHash": response_hash,
                    "success": source.get("success") is True,
                }
                dedup_key = _digest(context)
                row = connection.execute(
                    """INSERT INTO procurement_raw_snapshot (
                           id, organization_id, provider, bundle_schema_version,
                           entity_kind, canonical_code, revision_id,
                           revision_number, child_entity_kind, child_entity_id,
                           operation, endpoint, request_json, response_json,
                           error_json, content_hash, dedup_key,
                           schema_fingerprint, success, retrieved_at
                       ) VALUES (
                           ?, ?, 'MUASAMCONG', ?, ?, ?, ?, ?, ?, ?,
                           ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                       ) ON CONFLICT (organization_id, provider, dedup_key)
                         DO NOTHING
                       RETURNING id""",
                    (
                        uuid4().hex,
                        str(organization_id),
                        str(bundle["schemaVersion"]),
                        entity_kind,
                        canonical_code,
                        revision_id,
                        revision_number,
                        "PACKAGE" if package_key else None,
                        package_key,
                        str(source.get("operation") or ""),
                        str(source.get("endpoint") or ""),
                        _json(request),
                        _json(response),
                        _json(error) if error is not None else None,
                        response_hash,
                        dedup_key,
                        str(source.get("schemaFingerprint") or "unknown"),
                        1 if source.get("success") is True else 0,
                        str(source.get("retrievedAt") or bundle.get("retrievedAt")),
                    ),
                ).fetchone()
                if row is None:
                    duplicates += 1
                else:
                    inserted += 1
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
        return {"inserted": inserted, "duplicates": duplicates}

    def load_fresh_plan_bundle(
        self,
        organization_id,
        canonical_code,
        *,
        revision_mode="ALL",
        revision_numbers=None,
        max_age_seconds=900,
        now=None,
    ):
        """Reassemble the freshest immutable PLAN sources without refetching."""

        code = str(canonical_code or "").strip().upper()
        if not organization_id or not code:
            return None
        current = now or datetime.now(timezone.utc)
        cutoff = current - timedelta(
            seconds=max(1, min(float(max_age_seconds), 86400.0))
        )
        connection = self.database.get_connection()
        try:
            rows = connection.execute(
                """SELECT revision_id, revision_number, child_entity_kind,
                          child_entity_id, operation, endpoint, request_json,
                          response_json, error_json, content_hash,
                          schema_fingerprint, success, retrieved_at, created_at
                     FROM procurement_raw_snapshot
                    WHERE organization_id = ?
                      AND provider = 'MUASAMCONG'
                      AND entity_kind = 'PLAN'
                      AND canonical_code = ?
                      AND retrieved_at >= ?
                    ORDER BY retrieved_at DESC, created_at DESC
                    LIMIT 5000""",
                (str(organization_id), code, cutoff.isoformat()),
            ).fetchall()
        finally:
            connection.close()
        if not rows:
            return None

        newest = {}
        for row in rows:
            revision_number = _row_value(row, "revision_number", 1)
            child_id = _row_value(row, "child_entity_id", 3)
            operation = str(_row_value(row, "operation", 4) or "")
            key = (
                str(revision_number) if revision_number is not None else None,
                str(child_id) if child_id is not None else None,
                operation,
            )
            newest.setdefault(key, row)

        detail_rows = {
            key[0]: row
            for key, row in newest.items()
            if key[0] is not None and key[1] is None and key[2] == "PLAN_DETAIL"
        }
        available = sorted(detail_rows, key=_revision_sort_key)
        mode = str(revision_mode or "ALL").strip().upper()
        if mode == "LATEST":
            selected = available[-1:] if available else []
        elif mode == "SELECTED":
            requested = {
                str(number).strip().zfill(2)
                for number in (revision_numbers or [])
                if str(number).strip()
            }
            selected = [number for number in available if number in requested]
            if requested != set(selected):
                return None
        elif mode == "ALL":
            selected = available
        else:
            return None
        if not selected:
            return None

        def envelope(row):
            success = bool(_row_value(row, "success", 11))
            return {
                "operation": str(_row_value(row, "operation", 4) or ""),
                "endpoint": str(_row_value(row, "endpoint", 5) or ""),
                "request": _loads(_row_value(row, "request_json", 6)),
                "response": _loads(_row_value(row, "response_json", 7)),
                "error": _loads(_row_value(row, "error_json", 8)),
                "contentHash": str(_row_value(row, "content_hash", 9) or ""),
                "schemaFingerprint": str(
                    _row_value(row, "schema_fingerprint", 10) or "unknown"
                ),
                "success": success,
                "retrievedAt": str(_row_value(row, "retrieved_at", 12) or ""),
                "metrics": {},
            }

        sources = {}
        for (_revision, child_id, operation), row in newest.items():
            if _revision is None and child_id is None:
                key = {
                    "SEARCH": "search",
                    "PLAN_VERSION_LIST": "versionList",
                }.get(operation, operation.lower())
                sources[key] = envelope(row)

        search_source = sources.get("search")
        version_source = sources.get("versionList")
        if (
            not search_source
            or search_source.get("success") is not True
            or not version_source
            or version_source.get("success") is not True
        ):
            return None
        advertised = _revision_numbers(version_source.get("response"))
        if not advertised:
            return None
        if mode == "ALL" and not advertised.issubset(set(selected)):
            return None
        if mode == "LATEST" and selected != [max(
            advertised, key=_revision_sort_key
        )]:
            return None

        revisions = {}
        failures = []
        envelopes = list(sources.values())
        for revision_number in selected:
            detail_row = detail_rows[revision_number]
            detail_source = envelope(detail_row)
            revision_id = str(_row_value(detail_row, "revision_id", 0) or "")
            node = {
                "revisionId": revision_id,
                "revisionNumber": revision_number,
                "sources": {"planDetail": detail_source},
                "packages": {},
            }
            envelopes.append(detail_source)
            if not detail_source["success"]:
                failures.append({
                    "operation": "PLAN_DETAIL",
                    "revision": revision_number,
                    "revisionId": revision_id,
                    "error": (detail_source.get("error") or {}).get(
                        "code", "PROCUREMENT_UPSTREAM_UNAVAILABLE"
                    ),
                })
            valid_packages = _package_keys(detail_source.get("response"))
            package_rows = {
                child_id: row
                for (row_revision, child_id, operation), row in newest.items()
                if row_revision == revision_number
                and child_id is not None
                and operation == "PLAN_PACKAGE_DETAIL"
                and child_id in valid_packages
            }
            if set(package_rows) != valid_packages:
                return None
            for child_id, row in package_rows.items():
                package_source = envelope(row)
                node["packages"][child_id] = {
                    "stableKey": child_id,
                    "identifiers": {
                        "id": None,
                        "idDetail": child_id,
                        "idPlan": revision_id,
                        "bidNo": None,
                    },
                    "sources": {"planPackageDetail": package_source},
                }
                envelopes.append(package_source)
                if not package_source["success"]:
                    failures.append({
                        "operation": "PLAN_PACKAGE_DETAIL",
                        "revision": revision_number,
                        "revisionId": revision_id,
                        "package": child_id,
                        "error": (package_source.get("error") or {}).get(
                            "code", "PROCUREMENT_UPSTREAM_UNAVAILABLE"
                        ),
                    })
            revisions[revision_number] = node

        retrieved_at = max(
            (source.get("retrievedAt") or "" for source in envelopes),
            default=current.isoformat(),
        )
        complete = not failures and all(
            source.get("success") is True for source in envelopes
        )
        bundle = {
            "schemaVersion": "biddingflow-muasamcong-raw-bundle-v2",
            "provider": "MUASAMCONG",
            "entity": {
                "kind": "PLAN",
                "canonicalCode": code,
                "planNo": code,
            },
            "detailLevel": "COMPLETE",
            "revisionMode": mode,
            "retrievedAt": retrieved_at,
            "sources": sources,
            "revisions": revisions,
            "failures": failures,
            "complete": complete,
            "status": "FOUND_COMPLETE" if complete else "FOUND_PARTIAL",
            "manifest": {
                "sourceCount": len(envelopes),
                "successCount": sum(
                    source.get("success") is True for source in envelopes
                ),
                "failedCount": sum(
                    source.get("success") is not True for source in envelopes
                ),
                "revisions": list(selected),
                "packages": sum(
                    len(node["packages"]) for node in revisions.values()
                ),
                "operations": list(dict.fromkeys(
                    source.get("operation") for source in envelopes
                )),
            },
            "metrics": {
                "cache": {"hit": True, "layer": "RAW_SNAPSHOT"},
                "upstream": {"requestCount": 0, "networkMs": 0},
                "collector": {
                    "revisions": len(revisions),
                    "packageDetails": sum(
                        len(node["packages"]) for node in revisions.values()
                    ),
                },
            },
        }
        bundle["fingerprint"] = f"complete-bundle:cached:{_digest(bundle)[:12]}"
        return bundle

    def load_fresh_notice_bundle(
        self,
        organization_id,
        canonical_code,
        *,
        detail_level="COMPLETE",
        revision_mode="ALL",
        revision_numbers=None,
        max_age_seconds=900,
        now=None,
    ):
        """Reassemble a fresh NOTICE graph for canonical remapping."""

        code = str(canonical_code or "").strip().upper()
        if not organization_id or not code:
            return None
        current = now or datetime.now(timezone.utc)
        cutoff = current - timedelta(
            seconds=max(1, min(float(max_age_seconds), 86400.0))
        )
        connection = self.database.get_connection()
        try:
            rows = connection.execute(
                """SELECT revision_id, revision_number, child_entity_kind,
                          child_entity_id, operation, endpoint, request_json,
                          response_json, error_json, content_hash,
                          schema_fingerprint, success, retrieved_at, created_at
                     FROM procurement_raw_snapshot
                    WHERE organization_id = ?
                      AND provider = 'MUASAMCONG'
                      AND entity_kind = 'NOTICE'
                      AND canonical_code = ?
                      AND retrieved_at >= ?
                    ORDER BY retrieved_at DESC, created_at DESC
                    LIMIT 5000""",
                (str(organization_id), code, cutoff.isoformat()),
            ).fetchall()
        finally:
            connection.close()
        if not rows:
            return None
        newest = {}
        for row in rows:
            revision_number = _row_value(row, "revision_number", 1)
            operation = str(_row_value(row, "operation", 4) or "")
            key = (
                str(revision_number)
                if revision_number is not None else None,
                operation,
            )
            newest.setdefault(key, row)

        def envelope(row):
            return {
                "operation": str(_row_value(row, "operation", 4) or ""),
                "endpoint": str(_row_value(row, "endpoint", 5) or ""),
                "request": _loads(_row_value(row, "request_json", 6)),
                "response": _loads(_row_value(row, "response_json", 7)),
                "error": _loads(_row_value(row, "error_json", 8)),
                "contentHash": str(_row_value(row, "content_hash", 9) or ""),
                "schemaFingerprint": str(
                    _row_value(row, "schema_fingerprint", 10) or "unknown"
                ),
                "success": bool(_row_value(row, "success", 11)),
                "retrievedAt": str(_row_value(row, "retrieved_at", 12) or ""),
                "metrics": {},
            }

        requested_detail = str(detail_level or "COMPLETE").strip().upper()
        invitation_only = requested_detail == "INVITATION"
        top_keys = {
            "SEARCH": "search",
            "NOTICE_LDT_VERSION_LIST": "ldtVersionList",
            "NOTICE_OTHER_VERSION_LIST": "otherVersionList",
            "NOTICE_CONTRACT_LIST": "contractList",
        }
        sources = {
            top_keys.get(operation, operation.lower()): envelope(row)
            for (revision, operation), row in newest.items()
            if revision is None
            and not (invitation_only and operation == "NOTICE_CONTRACT_LIST")
        }
        version_sources = [
            sources.get("ldtVersionList"), sources.get("otherVersionList")
        ]
        advertised = set().union(*(
            _revision_numbers(source.get("response"))
            for source in version_sources
            if source and source.get("success") is True
        ))
        detail_rows = {
            revision: row
            for (revision, operation), row in newest.items()
            if revision is not None
            and operation in {
                "NOTICE_LDT_DETAIL", "NOTICE_OTHER_DETAIL", "NOTICE_ADB_DETAIL"
            }
        }
        available = sorted(detail_rows, key=_revision_sort_key)
        mode = str(revision_mode or "ALL").strip().upper()
        if mode == "LATEST":
            selected = available[-1:] if available else []
        elif mode == "SELECTED":
            requested = {
                str(value).strip().zfill(2)
                for value in (revision_numbers or [])
                if str(value).strip()
            }
            selected = [value for value in available if value in requested]
            if requested != set(selected):
                return None
        elif mode == "ALL":
            selected = available
        else:
            return None
        if (
            not selected
            or not sources.get("search")
            or sources["search"].get("success") is not True
            or not advertised
            or (mode == "ALL" and not advertised.issubset(set(selected)))
            or (
                mode == "LATEST"
                and selected != [max(advertised, key=_revision_sort_key)]
            )
        ):
            return None

        source_keys = {
            "NOTICE_TENDER_INFO": "tenderInfo",
            "NOTICE_HSMT": "hsmt",
            "NOTICE_PETITION": "petition",
            "NOTICE_CLARIFICATION": "clarification",
            "NOTICE_PREBID_CONFERENCE": "prebidConference",
            "PLAN_VERSION_LIST": "planVersionList",
            "PLAN_DETAIL": "planDetail",
            "PLAN_PACKAGE_DETAIL": "planPackageDetail",
            "SELECTION_RESULT": "selectionResult",
            "SELECTION_RESULT_OTHER": "selectionResult",
            "TECHNICAL_RESULT": "technicalResult",
            "NOTICE_PHASE_TWO": "phaseTwo",
            "NOTICE_HSMT_PHASE_TWO": "hsmtPhaseTwo",
        }
        revisions = {}
        failures = []
        envelopes = list(sources.values())
        for revision_number in selected:
            detail_row = detail_rows[revision_number]
            revision_id = str(_row_value(detail_row, "revision_id", 0) or "")
            detail_source = envelope(detail_row)
            node_sources = {"noticeDetail": detail_source}
            for (row_revision, operation), row in newest.items():
                if row_revision != revision_number or row is detail_row:
                    continue
                key = source_keys.get(operation)
                if invitation_only and (
                    operation.startswith("OPENING_")
                    or operation in {
                        "SELECTION_RESULT", "SELECTION_RESULT_OTHER",
                        "TECHNICAL_RESULT",
                    }
                ):
                    continue
                if operation.startswith("OPENING_"):
                    request = _loads(_row_value(row, "request_json", 6), {})
                    pack_type = request.get("packType")
                    key = operation.lower() + (
                        f"_{pack_type}" if pack_type is not None else ""
                    )
                if key:
                    node_sources[key] = envelope(row)
            node = {
                "revisionId": revision_id,
                "revisionNumber": revision_number,
                "sources": node_sources,
            }
            revisions[revision_number] = node
            envelopes.extend(node_sources.values())
            for source in node_sources.values():
                if source.get("success") is not True:
                    failures.append({
                        "operation": source.get("operation"),
                        "revision": revision_number,
                        "error": (source.get("error") or {}).get(
                            "code", "PROCUREMENT_UPSTREAM_UNAVAILABLE"
                        ),
                    })
        retrieved_at = max(
            (source.get("retrievedAt") or "" for source in envelopes),
            default=current.isoformat(),
        )
        complete = not failures and all(
            source.get("success") is True for source in envelopes
        )
        bundle = {
            "schemaVersion": "biddingflow-muasamcong-raw-bundle-v2",
            "provider": "MUASAMCONG",
            "entity": {
                "kind": "NOTICE", "canonicalCode": code, "noticeNo": code,
            },
            "detailLevel": requested_detail,
            "revisionMode": mode,
            "retrievedAt": retrieved_at,
            "sources": sources,
            "revisions": revisions,
            "failures": failures,
            "complete": complete,
            "status": "FOUND_COMPLETE" if complete else "FOUND_PARTIAL",
            "manifest": {
                "sourceCount": len(envelopes),
                "successCount": sum(
                    source.get("success") is True for source in envelopes
                ),
                "failedCount": sum(
                    source.get("success") is not True for source in envelopes
                ),
                "revisions": list(selected),
                "packages": 0,
                "operations": list(dict.fromkeys(
                    source.get("operation") for source in envelopes
                )),
            },
            "metrics": {
                "cache": {"hit": True, "layer": "RAW_SNAPSHOT"},
                "upstream": {"requestCount": 0, "networkMs": 0},
                "collector": {"revisions": len(revisions)},
            },
        }
        bundle["fingerprint"] = (
            f"complete-bundle:cached:{_digest(bundle)[:12]}"
        )
        return bundle
