"""Validate canonical sync records before any row is written."""

from __future__ import annotations

from typing import Any, Callable

from backend.shared.access_policy import (
    authorize_record_write_from_context,
    build_batch_write_authorization_context,
)
from backend.shared.helpers import clean_id
from backend.sync.delete_policy import ARCHIVABLE_TABLES
from backend.sync.mapper import map_db_to_json
from backend.sync.opening_uniqueness import validate_opening_participant_uniqueness
from backend.sync.ownership import (
    build_owner_reference_context,
    validate_owner_scoped_references,
)
from backend.sync.payload_validation import (
    validate_package_locked_fields,
    validate_package_status_transition,
)
from backend.sync.uniqueness import (
    build_domain_uniqueness_context,
    validate_domain_uniqueness_from_context,
)
from backend.sync.validator import validate_sync_item


_QUERY_CHUNK_SIZE = 500


class SyncRecordValidator:
    def __init__(
        self,
        transaction_context,
        payload,
        payload_index,
        mutation_tracker,
        *,
        clean_record_id: Callable[[str, Any], str | None],
        schema_definition: dict[str, Any],
        iter_payloads,
        canonicalize_item,
    ):
        self.transaction = transaction_context
        self.payload = payload
        self.payload_index = payload_index
        self.mutation_tracker = mutation_tracker
        self.clean_record_id = clean_record_id
        self.schema_definition = schema_definition
        self.iter_payloads = iter_payloads
        self.canonicalize_item = canonicalize_item
        self.existing_assignment_targets: set[tuple[str, str]] = set()

    def validate_payload(self) -> list[dict[str, Any]]:
        cursor = self.transaction.cursor
        actor = self.transaction.actor
        organization_id = actor.organization_id
        validation_errors = list(validate_opening_participant_uniqueness(
            cursor,
            organization_id,
            self.payload.get("thongtinmothau", []),
        ))
        allowed_statuses = self.payload_index.allowed_contract_status_names(
            cursor,
            organization_id,
        )
        payloads = [
            (
                payload_key,
                table_name,
                [
                    self.canonicalize_item(table_name, raw_item)
                    for raw_item in items
                ],
            )
            for payload_key, table_name, items in self.iter_payloads(self.payload)
        ]
        current_records_by_table = self._load_current_records(
            payloads,
            organization_id,
        )
        records_by_table = {}
        for _payload_key, table_name, items in payloads:
            records_by_table.setdefault(table_name, []).extend(items)
        authorization_context = build_batch_write_authorization_context(
            cursor,
            actor.role,
            actor.user_id,
            organization_id,
            records_by_table,
        )
        self.existing_assignment_targets = self._load_existing_assignment_targets(
            payloads,
            organization_id,
        )
        uniqueness_context = build_domain_uniqueness_context(
            cursor,
            organization_id,
            records_by_table,
        )
        owner_reference_context = build_owner_reference_context(
            cursor,
            organization_id,
            records_by_table,
            self.payload_index.incoming_ids_by_table,
        )

        for payload_key, table_name, items in payloads:
            for item in items:
                item_errors: list[Any] = []
                current_record = None
                access_decision = authorize_record_write_from_context(
                    authorization_context,
                    payload_key,
                    table_name,
                    item,
                )
                if not access_decision.allowed:
                    item_errors.append(access_decision.message)

                record_id = self.clean_record_id(table_name, item.get("id"))
                root_id = (
                    self.clean_record_id(table_name, item.get("rootId"))
                    or record_id
                )
                if (
                    record_id
                    and "row_version"
                    in self.schema_definition[table_name]["columns"]
                ):
                    current_record = current_records_by_table.get(
                        table_name,
                        {},
                    ).get(record_id)
                    if current_record:
                        self.payload_index.remember_stored_record(
                            table_name,
                            record_id,
                            current_record,
                        )
                        expected_version = item.get(
                            "expectedVersion",
                            item.get("rowVersion"),
                        )
                        current_version = int(
                            current_record.get("row_version") or 1
                        )
                        if expected_version != current_version:
                            item_errors.append({
                                "field": "expectedVersion",
                                "code": "ROW_VERSION_CONFLICT",
                                "message": (
                                    "Bản ghi đã được thay đổi bởi một phiên "
                                    "làm việc khác."
                                ),
                                "expectedVersion": expected_version,
                                "currentVersion": current_version,
                                "serverRecord": map_db_to_json(
                                    table_name,
                                    current_record,
                                ),
                            })
                if record_id and table_name in ARCHIVABLE_TABLES:
                    archived_record = current_records_by_table.get(
                        table_name,
                        {},
                    ).get(record_id)
                    if archived_record and archived_record.get("archived_at"):
                        item_errors.append(
                            "Bản ghi đã được lưu trữ và không thể chỉnh sửa."
                        )

                item, pure_errors, _requested_statuses = validate_sync_item(
                    table_name,
                    item,
                    allowed_statuses,
                )
                item_errors.extend(pure_errors)
                if table_name == "goi_thau" and current_record:
                    item_errors.extend(validate_package_status_transition(
                        current_record.get("trang_thai"),
                        item,
                    ))
                    item_errors.extend(validate_package_locked_fields(
                        current_record,
                        item,
                    ))
                item_errors.extend(self._assignment_errors(
                    table_name,
                    item,
                    record_id,
                ))
                reference_errors = validate_owner_scoped_references(
                    cursor,
                    organization_id,
                    table_name,
                    item,
                    self.payload_index.incoming_ids_by_table,
                    self.payload_index.incoming_records_by_table,
                    owner_reference_context,
                )
                if table_name == "phan_cong_nhan_su" and reference_errors:
                    self.payload_index.skip(table_name, record_id)
                    self.mutation_tracker.record_orphan(table_name, record_id)
                    continue
                item_errors.extend(reference_errors)
                item_errors.extend(validate_domain_uniqueness_from_context(
                    uniqueness_context,
                    table_name,
                    item,
                    record_id,
                    root_id,
                ))
                validation_errors.extend(self._format_errors(
                    table_name,
                    item,
                    item_errors,
                ))
        return validation_errors

    def _load_current_records(
        self,
        payloads,
        organization_id: str,
    ) -> dict[str, dict[str, dict[str, Any]]]:
        cursor = self.transaction.cursor
        records_by_table = {}
        for _payload_key, table_name, items in payloads:
            columns = self.schema_definition[table_name]["columns"]
            if table_name not in ARCHIVABLE_TABLES and "row_version" not in columns:
                continue
            record_ids = list(dict.fromkeys(
                record_id
                for item in items
                if (
                    record_id := self.clean_record_id(
                        table_name,
                        item.get("id"),
                    )
                )
            ))
            table_records = records_by_table.setdefault(table_name, {})
            for offset in range(0, len(record_ids), _QUERY_CHUNK_SIZE):
                chunk = record_ids[offset:offset + _QUERY_CHUNK_SIZE]
                placeholders = ", ".join("?" for _ in chunk)
                rows = cursor.execute(
                    f"""SELECT * FROM {table_name}
                        WHERE organization_id = ?
                          AND id IN ({placeholders})""",
                    (organization_id, *chunk),
                ).fetchall()
                for raw_row in rows:
                    row = dict(raw_row)
                    row_id = self.clean_record_id(table_name, row.get("id"))
                    if row_id:
                        table_records[row_id] = row
        return records_by_table

    def _assignment_errors(
        self,
        table_name: str,
        item: dict[str, Any],
        record_id: str | None,
    ) -> list[str]:
        if (
            self.transaction.owner_type != "organization"
            or table_name not in {"ke_hoach_lcnt", "goi_thau", "hop_dong"}
            or not record_id
        ):
            return []
        target_type = {
            "ke_hoach_lcnt": "kehoach",
            "goi_thau": "goithau",
            "hop_dong": "hopdong",
        }[table_name]
        has_incoming = any(
            clean_id(
                assignment.get("targetId") or assignment.get("id_muc_tieu")
            ) == record_id
            and str(
                assignment.get("type")
                or assignment.get("loai_doi_tuong")
                or ""
            ).strip() == target_type
            for assignment in self.payload.get("assignments", [])
            if isinstance(assignment, dict)
        )
        has_stored = (target_type, record_id) in self.existing_assignment_targets
        if not has_incoming and not has_stored:
            return ["Bản ghi phải có một chuyên viên phụ trách chính."]
        return []

    def _load_existing_assignment_targets(
        self,
        payloads,
        organization_id: str,
    ) -> set[tuple[str, str]]:
        target_tables = {"ke_hoach_lcnt", "goi_thau", "hop_dong"}
        target_ids = list(dict.fromkeys(
            record_id
            for _payload_key, table_name, items in payloads
            if table_name in target_tables
            for item in items
            if (
                record_id := self.clean_record_id(
                    table_name,
                    item.get("id"),
                )
            )
        ))
        existing_targets = set()
        for offset in range(0, len(target_ids), _QUERY_CHUNK_SIZE):
            chunk = target_ids[offset:offset + _QUERY_CHUNK_SIZE]
            placeholders = ", ".join("?" for _ in chunk)
            rows = self.transaction.cursor.execute(
                f"""SELECT id_muc_tieu, loai_doi_tuong
                    FROM phan_cong_nhan_su
                    WHERE organization_id = ?
                      AND id_muc_tieu IN ({placeholders})
                      AND loai_doi_tuong IN ('kehoach', 'goithau', 'hopdong')""",
                (organization_id, *chunk),
            ).fetchall()
            existing_targets.update(
                (str(row[1]), str(row[0]))
                for row in rows
            )
        return existing_targets

    @staticmethod
    def _format_errors(
        table_name: str,
        item: dict[str, Any],
        errors: list[Any],
    ) -> list[dict[str, Any]]:
        display_name = (
            item.get("tenChuDauTu")
            or item.get("tenKeHoach")
            or item.get("tenGoiThau")
            or item.get("tenNhaThau")
            or item.get("hoTen")
            or item.get("tenHopDong")
            or item.get("id")
        )
        formatted = []
        for error in errors:
            detail = error if isinstance(error, dict) else {"message": error}
            value = {
                "table": table_name,
                "id": item.get("id"),
                "message": f"[{display_name}]: {detail.get('message', '')}",
                "field": detail.get("field") or "$record",
                "code": detail.get("code") or "SYNC_ITEM_INVALID",
            }
            if detail.get("conflictingId"):
                value["conflictingId"] = detail["conflictingId"]
            for key in ("expectedVersion", "currentVersion", "serverRecord"):
                if key in detail:
                    value[key] = detail[key]
            formatted.append(value)
        return formatted
