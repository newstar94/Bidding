"""Validate a complete, previously unpersisted plan-version draft graph."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


_QUERY_CHUNK_SIZE = 500
_MAX_SAFE_INTEGER = 9_007_199_254_740_991


@dataclass(frozen=True, slots=True)
class PlanDraftValidationError(ValueError):
    code: str
    message: str

    def __str__(self) -> str:
        return self.message


def _fail(code: str, message: str) -> None:
    raise PlanDraftValidationError(code, message)


def _record_id(row: Any) -> str:
    return str(row.get("id") or "").strip() if isinstance(row, dict) else ""


def _root_id(row: dict[str, Any]) -> str:
    return str(row.get("rootId") or row.get("id_goc") or row.get("id") or "").strip()


def _version(row: dict[str, Any]) -> int:
    value = row.get("phienBan", row.get("phien_ban"))
    if isinstance(value, bool):
        return -1
    if isinstance(value, int):
        return value if 0 <= value <= _MAX_SAFE_INTEGER else -1
    if isinstance(value, str) and value.strip().isascii() and value.strip().isdigit():
        parsed = int(value.strip())
        return parsed if parsed <= _MAX_SAFE_INTEGER else -1
    return -1


def _declared_version(item: dict[str, Any]) -> int:
    return _version({"phienBan": item.get("version")})


def _is_unpersisted(row: dict[str, Any]) -> bool:
    values = [
        row[field]
        for field in ("rowVersion", "expectedVersion")
        if field in row and row[field] is not None
    ]
    return all(_declared_version({"version": value}) == 0 for value in values)


def _has_valid_record_versions(row: dict[str, Any]) -> bool:
    values = [
        row[field]
        for field in ("rowVersion", "expectedVersion")
        if field in row and row[field] is not None
    ]
    return all(_declared_version({"version": value}) >= 0 for value in values)


def _unique_ids(rows: list[Any], *, label: str) -> set[str]:
    ids = [_record_id(row) for row in rows]
    if any(not value for value in ids) or len(set(ids)) != len(ids):
        _fail("DRAFT_ID_INVALID", f"{label} có ID thiếu hoặc bị trùng.")
    return set(ids)


def _existing_ids(
    cursor,
    organization_id: str,
    table: str,
    ids: set[str],
    root_ids: set[str] | None = None,
) -> set[str]:
    roots = sorted(root_ids or set())
    if not ids and not roots:
        return set()
    found = set()
    for column, values in (("id", sorted(ids)), ("id_goc", roots)):
        for offset in range(0, len(values), _QUERY_CHUNK_SIZE):
            chunk = values[offset:offset + _QUERY_CHUNK_SIZE]
            placeholders = ", ".join("?" for _ in chunk)
            rows = cursor.execute(
                f"SELECT id FROM {table} WHERE organization_id = ? "  # noqa: S608 - fixed table/column names and generated placeholders
                f"AND {column} IN ({placeholders})",
                (organization_id, *chunk),
            ).fetchall()
            found.update(str(row[0]) for row in rows)
    return found


def validate_plan_draft_finalize(cursor, organization_id: str, data: dict[str, Any]) -> None:
    """Reject malformed, cross-linked, deleted, or already-persisted draft graphs."""

    if not str(data.get("draftId") or "").strip() or not str(data.get("clientMutationId") or "").strip():
        _fail("DRAFT_COMMAND_INVALID", "Thiếu định danh draft hoặc idempotency key.")
    if data.get("deletions") not in (None, []):
        _fail("DRAFT_DELETIONS_NOT_ALLOWED", "Kế hoạch mới chưa lưu không được chứa thao tác xóa server.")
    for payload_key in (
        "chudautu", "chuyengia", "nhathau",
        "goithauhanghoa", "thongtinmothau", "hanghoaduthaunhathau", "assignments",
    ):
        rows = data.get(payload_key) or []
        if isinstance(rows, list) and any(
            isinstance(row, dict) and not _has_valid_record_versions(row)
            for row in rows
        ):
            _fail("DRAFT_REFERENCE_INVALID", "Phiên bản bản ghi trong bản nháp không hợp lệ.")

    plans = data.get("kehoach")
    versions = data.get("versions")
    if not isinstance(plans, list) or not plans or not isinstance(versions, list):
        _fail("DRAFT_VERSION_SEQUENCE_INVALID", "Draft phải chứa ít nhất phiên bản kế hoạch 00.")
    plan_ids = _unique_ids(plans, label="Chuỗi kế hoạch")
    root_id = str(data.get("planRootId") or "").strip()
    ordered_plans = sorted(plans, key=_version)
    plan_versions = [_version(row) for row in ordered_plans]
    if plan_versions != list(range(len(ordered_plans))):
        _fail("DRAFT_VERSION_SEQUENCE_INVALID", "Phiên bản kế hoạch phải duy nhất và liên tục từ 00.")
    declared = []
    declared = [
        (str(item.get("id") or ""), _declared_version(item))
        for item in versions if isinstance(item, dict)
    ]
    actual = [(_record_id(row), _version(row)) for row in ordered_plans]
    if declared != actual:
        _fail("DRAFT_VERSION_SEQUENCE_INVALID", "Danh sách phiên bản không khớp chuỗi kế hoạch.")
    if not root_id or any(_root_id(row) != root_id for row in plans):
        _fail("DRAFT_ROOT_INVALID", "Các phiên bản kế hoạch không cùng một rootId.")
    if any(not _is_unpersisted(row) for row in plans):
        _fail("DRAFT_ALREADY_PERSISTED", "Chuỗi kế hoạch draft đã chứa bản ghi server.")

    packages = data.get("goithau") or []
    if not isinstance(packages, list):
        _fail("DRAFT_REFERENCE_INVALID", "Danh sách gói thầu không hợp lệ.")
    package_ids = _unique_ids(packages, label="Danh sách gói thầu")
    if any(
        str(row.get("keHoachId") or row.get("ke_hoach_id") or "") not in plan_ids
        or not _is_unpersisted(row)
        for row in packages
    ):
        _fail("DRAFT_REFERENCE_INVALID", "Gói thầu không thuộc một phiên bản kế hoạch draft hợp lệ.")

    for payload_key in ("goithauhanghoa", "thongtinmothau", "hanghoaduthaunhathau"):
        rows = data.get(payload_key) or []
        if not isinstance(rows, list):
            _fail("DRAFT_REFERENCE_INVALID", f"Danh sách {payload_key} không hợp lệ.")
        _unique_ids(rows, label=payload_key)
        if any(str(row.get("goiThauId") or row.get("goi_thau_id") or "") not in package_ids for row in rows):
            _fail("DRAFT_REFERENCE_INVALID", f"{payload_key} có liên kết gói thầu bị treo.")

    assignments = data.get("assignments") or []
    if not isinstance(assignments, list):
        _fail("DRAFT_REFERENCE_INVALID", "Danh sách phân công không hợp lệ.")
    _unique_ids(assignments, label="Danh sách phân công")
    for assignment in assignments:
        assignment_type = str(assignment.get("type") or assignment.get("loai_doi_tuong") or "")
        target_id = str(assignment.get("targetId") or assignment.get("id_muc_tieu") or "")
        valid = (
            assignment_type == "kehoach" and target_id in plan_ids
        ) or (
            assignment_type == "goithau" and target_id in package_ids
        )
        if not valid:
            _fail("DRAFT_REFERENCE_INVALID", "Phân công có đối tượng đích không hợp lệ.")

    if _existing_ids(cursor, organization_id, "ke_hoach_lcnt", plan_ids, {root_id}):
        _fail("DRAFT_ALREADY_PERSISTED", "Một phần chuỗi kế hoạch đã tồn tại trong workspace.")
    package_roots = {_root_id(row) for row in packages if _root_id(row)}
    if _existing_ids(cursor, organization_id, "goi_thau", package_ids, package_roots):
        _fail("DRAFT_ALREADY_PERSISTED", "Một phần snapshot gói thầu đã tồn tại trong workspace.")

    last_plan_id = _record_id(ordered_plans[-1])
    for plan in plans:
        plan["isLatest"] = 1 if _record_id(plan) == last_plan_id else 0


def finalize_response_metadata(data: dict[str, Any]) -> dict[str, Any]:
    plans = sorted(data.get("kehoach") or [], key=_version)
    packages = data.get("goithau") or []
    plan_ids = [_record_id(row) for row in plans]
    package_ids = [_record_id(row) for row in packages]
    return {
        "draftId": str(data.get("draftId") or ""),
        "planRootId": str(data.get("planRootId") or ""),
        "persistedPlanIds": plan_ids,
        "persistedPackageIds": package_ids,
        "latestPlanId": plan_ids[-1] if plan_ids else "",
        "latestVersion": _version(plans[-1]) if plans else None,
        "idMapping": {
            "plans": {value: value for value in plan_ids},
            "packages": {value: value for value in package_ids},
        },
    }
