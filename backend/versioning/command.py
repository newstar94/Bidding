"""Build sync payloads for server-authoritative aggregate version creation."""

from __future__ import annotations

from copy import deepcopy
from uuid import NAMESPACE_URL, uuid5

from backend.versioning.aggregate_snapshot import (
    SERVER_FIELDS,
    snapshot_package_aggregate,
    snapshot_plan_aggregate,
)


IMMUTABLE_VERSION_FIELDS = SERVER_FIELDS | {
    "id",
    "rootId",
    "phienBan",
    "isLatest",
    "createdAt",
    "updatedAt",
}

VERSION_CHANGE_ALIASES = {
    "plan": {
        "diadiemQuymo": "diaDiemQuyMo",
        "thongtinKhac": "thongTinKhac",
    },
}


class AggregateVersionConflict(Exception):
    """Raised when the source aggregate is no longer the expected version."""

    def __init__(self, current_version):
        self.current_version = current_version
        super().__init__("The source aggregate changed before version creation.")


class HistoricalAggregateError(ValueError):
    """Raised when a command would derive a new version from historical state."""


def _rows(value):
    return value if isinstance(value, list) else []


def _integer(value, *, field):
    if isinstance(value, bool):
        raise ValueError(f"{field} must be an integer.")
    try:
        return int(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{field} must be an integer.") from error


def _source_record(state, table, source_id):
    return next(
        (record for record in _rows(state.get(table)) if str(record.get("id")) == source_id),
        None,
    )


def _clean_record(record):
    cloned = deepcopy(record)
    for field in SERVER_FIELDS:
        cloned.pop(field, None)
    return cloned


def _demote_source(source):
    record = _clean_record(source)
    record["isLatest"] = 0
    record["expectedVersion"] = _integer(
        source.get("rowVersion"), field="rowVersion"
    )
    return record


def _id_factory(client_mutation_id, kind):
    counter = 0

    def create_id(entity_kind):
        nonlocal counter
        counter += 1
        token = f"{client_mutation_id}:{kind}:{counter}:{entity_kind}"
        return str(uuid5(NAMESPACE_URL, token))

    return create_id


def _validate_command(command):
    if not isinstance(command, dict):
        raise ValueError("Version command must be an object.")
    kind = str(command.get("kind") or "").strip().lower()
    if kind not in {"package", "plan"}:
        raise ValueError("kind must be package or plan.")
    source_id = str(command.get("sourceId") or "").strip()
    if not source_id:
        raise ValueError("sourceId is required.")
    mutation_id = str(command.get("clientMutationId") or "").strip()
    if not mutation_id or len(mutation_id) > 128:
        raise ValueError("clientMutationId must contain 1 to 128 characters.")
    expected_version = _integer(
        command.get("expectedRowVersion"), field="expectedRowVersion"
    )
    if expected_version < 1:
        raise ValueError("expectedRowVersion must be positive.")
    changes = command.get("changes", {})
    if not isinstance(changes, dict):
        raise ValueError("changes must be an object.")
    aliases = VERSION_CHANGE_ALIASES.get(kind, {})
    normalized_changes = {}
    for key, value in changes.items():
        canonical_key = aliases.get(key, key)
        if canonical_key in IMMUTABLE_VERSION_FIELDS:
            continue
        if canonical_key not in normalized_changes or key == canonical_key:
            normalized_changes[canonical_key] = deepcopy(value)
    changes = normalized_changes
    def root_ids(field):
        values = command.get(field)
        if values is None:
            return None
        if not isinstance(values, list) or len(values) > 500:
            raise ValueError(f"{field} must be a bounded list.")
        normalized = {str(value).strip() for value in values if str(value).strip()}
        if len(normalized) != len(values):
            raise ValueError(f"{field} contains an invalid or duplicate root id.")
        return normalized

    include_roots = root_ids("includePackageRootIds")
    exclude_roots = root_ids("excludePackageRootIds") or set()
    if include_roots is not None and include_roots & exclude_roots:
        raise ValueError("Package root cannot be both included and excluded.")
    return (
        kind,
        source_id,
        mutation_id,
        expected_version,
        changes,
        include_roots,
        exclude_roots,
    )


def _assert_current_source(source, expected_version):
    if source is None:
        raise LookupError("The source aggregate does not exist.")
    current_version = _integer(source.get("rowVersion"), field="rowVersion")
    if source.get("isLatest") != 1 or current_version != expected_version:
        raise AggregateVersionConflict(current_version)


def _base_payload(repository, organization_id, mutation_id):
    return {
        "baseSyncVersion": str(repository.current_sync_version(organization_id)),
        "clientMutationId": mutation_id,
        "kehoach": [],
        "goithau": [],
        "goithauhanghoa": [],
        "thongtinmothau": [],
        "hanghoaduthaunhathau": [],
        "assignments": [],
        "deletions": [],
    }


def build_aggregate_version_payload(
    repository,
    organization_id,
    command,
    *,
    timestamp,
):
    """Load authoritative state and build one idempotent sync mutation payload."""

    (
        kind,
        source_id,
        mutation_id,
        expected_version,
        changes,
        include_roots,
        exclude_roots,
    ) = _validate_command(command)
    load_state = (
        repository.load_package_state
        if kind == "package"
        else repository.load_plan_state
    )
    state = load_state(organization_id, source_id)
    if not isinstance(state, dict):
        raise LookupError("The source aggregate does not exist.")

    table = "goithau" if kind == "package" else "kehoach"
    source = _source_record(state, table, source_id)
    _assert_current_source(source, expected_version)

    create_id = _id_factory(mutation_id, kind)
    payload = _base_payload(repository, organization_id, mutation_id)
    if kind == "package":
        owning_plan = _source_record(
            state,
            "kehoach",
            str(source.get("keHoachId") or ""),
        )
        if owning_plan is None or owning_plan.get("isLatest") != 1:
            raise HistoricalAggregateError(
                "Package version command requires the owning plan to be latest."
            )
        target_id = create_id("goithau")
        snapshot = snapshot_package_aggregate(
            state,
            source,
            target_package_id=target_id,
            target_plan_id=source.get("keHoachId"),
            package_version=_integer(source.get("phienBan") or 0, field="phienBan") + 1,
            timestamp=timestamp,
            overrides=changes,
            create_id=create_id,
        )
        payload["goithau"] = [_demote_source(source), snapshot["packageRecord"]]
        for key in (
            "goithauhanghoa",
            "thongtinmothau",
            "hanghoaduthaunhathau",
            "assignments",
        ):
            payload[key] = snapshot[key]
        return payload

    target_plan_id = create_id("kehoach")
    created_plan = _clean_record(source)
    created_plan.update(deepcopy(changes))
    created_plan.update({
        "id": target_plan_id,
        "rootId": source.get("rootId") or source["id"],
        "phienBan": _integer(source.get("phienBan") or 0, field="phienBan") + 1,
        "isLatest": 1,
        "createdAt": source.get("createdAt") or timestamp,
        "updatedAt": timestamp,
    })
    aggregate = snapshot_plan_aggregate(
        state,
        source_plan_id=source_id,
        target_plan_id=target_plan_id,
        timestamp=timestamp,
        create_id=create_id,
        include_package_roots=include_roots,
        exclude_package_roots=exclude_roots,
    )
    payload["kehoach"] = [_demote_source(source), created_plan]
    for key in (
        "goithau",
        "goithauhanghoa",
        "thongtinmothau",
        "hanghoaduthaunhathau",
        "assignments",
    ):
        payload[key] = aggregate[key]
    for assignment in _rows(state.get("assignments")):
        if (
            assignment.get("type") != "kehoach"
            or str(assignment.get("targetId")) != source_id
        ):
            continue
        cloned_assignment = _clean_record(assignment)
        cloned_assignment.update({
            "id": create_id("assignments"),
            "targetId": target_plan_id,
            "type": "kehoach",
        })
        payload["assignments"].append(cloned_assignment)
    return payload
