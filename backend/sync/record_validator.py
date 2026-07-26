"""Validate canonical sync records before any row is written."""

from __future__ import annotations

from typing import Any, Callable

from backend.shared.access_policy import authorize_record_write
from backend.shared.helpers import clean_id
from backend.sync.delete_policy import ARCHIVABLE_TABLES
from backend.sync.mapper import map_db_to_json
from backend.sync.opening_uniqueness import validate_opening_participant_uniqueness
from backend.sync.ownership import validate_owner_scoped_references
from backend.sync.payload_validation import (
    validate_package_locked_fields,
    validate_package_status_transition,
)
from backend.sync.uniqueness import validate_domain_uniqueness
from backend.sync.validator import validate_sync_item


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

        for payload_key, table_name, items in self.iter_payloads(self.payload):
            for raw_item in items:
                item = self.canonicalize_item(table_name, raw_item)
                item_errors: list[Any] = []
                current_record = None
                access_decision = authorize_record_write(
                    cursor,
                    actor.role,
                    actor.user_id,
                    organization_id,
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
                    current_row = cursor.execute(
                        f"""SELECT * FROM {table_name}
                            WHERE organization_id = ? AND id = ? LIMIT 1""",
                        (organization_id, record_id),
                    ).fetchone()
                    if current_row:
                        current_record = dict(current_row)
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
                    archived_row = cursor.execute(
                        f"""SELECT archived_at FROM {table_name}
                            WHERE organization_id = ? AND id = ?""",
                        (organization_id, record_id),
                    ).fetchone()
                    if archived_row and archived_row[0]:
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
                )
                if table_name == "phan_cong_nhan_su" and reference_errors:
                    self.payload_index.skip(table_name, record_id)
                    self.mutation_tracker.record_orphan(table_name, record_id)
                    continue
                item_errors.extend(reference_errors)
                item_errors.extend(validate_domain_uniqueness(
                    cursor,
                    organization_id,
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
        has_stored = self.transaction.cursor.execute(
            """SELECT 1 FROM phan_cong_nhan_su
               WHERE organization_id = ? AND id_muc_tieu = ?
                 AND loai_doi_tuong = ? LIMIT 1""",
            (
                self.transaction.actor.organization_id,
                record_id,
                target_type,
            ),
        ).fetchone() is not None
        if not has_incoming and not has_stored:
            return ["Bản ghi phải có một chuyên viên phụ trách chính."]
        return []

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
