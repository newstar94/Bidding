"""Validate canonical sync records before any row is written."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

from backend.shared.access_policy import (
    authorize_record_write_from_context,
    build_batch_write_authorization_context,
    can_read_record,
)
from backend.shared.helpers import clean_id
from backend.sync.delete_policy import ARCHIVABLE_TABLES
from backend.sync.mapper import map_db_to_json
from backend.sync.conflict_projection import project_conflict_record
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
from backend.sync.package_goods import (
    validate_package_goods_batch,
    validate_package_goods_configuration_change,
)
from backend.sync.bidder_goods import validate_bidder_goods_batch
from backend.sync.aggregate_mutability import (
    build_aggregate_mutability_context,
    historical_parent_mutation_error,
)
from backend.sync.bid_evaluation_rules import (
    is_inherited_legacy_technical_result,
    parse_technical_score,
    requires_technical_score,
)
from backend.sync.validator import validate_sync_item


_QUERY_CHUNK_SIZE = 500
_VERSIONED_IMMUTABLE_HISTORY_TABLES = frozenset({"ke_hoach_lcnt", "goi_thau"})


def historical_record_mutation_error(table_name, current_record):
    if (
        table_name in _VERSIONED_IMMUTABLE_HISTORY_TABLES
        and current_record
        and "is_latest" in current_record
        and int(current_record.get("is_latest") or 0) != 1
    ):
        return {
            "field": "$record",
            "code": "HISTORICAL_RECORD_IMMUTABLE",
            "message": "Phiên bản lịch sử là ảnh chụp bất biến.",
        }
    return None


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
        server_inherited_assignment_ids=None,
        trusted_import_package_ids=None,
        allow_new_historical_parents=False,
    ):
        self.transaction = transaction_context
        self.payload = payload
        self.payload_index = payload_index
        self.mutation_tracker = mutation_tracker
        self.clean_record_id = clean_record_id
        self.schema_definition = schema_definition
        self.iter_payloads = iter_payloads
        self.canonicalize_item = canonicalize_item
        self.server_inherited_assignment_ids = {
            str(record_id)
            for record_id in (server_inherited_assignment_ids or ())
            if record_id
        }
        self.trusted_import_package_ids = {
            str(record_id)
            for record_id in (trusted_import_package_ids or ())
            if record_id
        }
        self.allow_new_historical_parents = allow_new_historical_parents

    def validate_payload(self) -> list[dict[str, Any]]:
        cursor = self.transaction.cursor
        actor = self.transaction.actor
        organization_id = actor.organization_id
        bidder_goods_items = self.payload.get("hanghoaduthaunhathau", [])
        opening_items = self.payload.get("thongtinmothau", [])
        for item in bidder_goods_items:
            if not isinstance(item, dict):
                continue
            manual_override = item.get(
                "uuDaiManualOverride",
                item.get("uu_dai_manual_override", False),
            ) in (True, 1, "1", "true", "True")
            if manual_override:
                # Actor identity is authoritative server context, never client input.
                item["uuDaiManualActorId"] = actor.user_id
                item["uuDaiManualUpdatedAt"] = datetime.now(timezone.utc).isoformat()
        opening_payload_ids = {
            clean_id(item.get("id"))
            for item in opening_items
            if isinstance(item, dict)
        }
        missing_recompute_openings = {
            clean_id(item.get("thongTinMoThauId") or item.get("thong_tin_mo_thau_id"))
            for item in bidder_goods_items
            if isinstance(item, dict)
            and item.get("isDraft", item.get("is_draft", True))
                in (False, 0, "0", "false", "False")
        } - opening_payload_ids - {None}
        validation_errors = [{
            "table": "hang_hoa_du_thau_nha_thau",
            "id": None,
            "field": "thongTinMoThauId",
            "code": "BIDDER_GOODS_OPENING_RECOMPUTE_REQUIRED",
            "message": (
                "Phải đồng bộ cùng bản ghi mở thầu để máy chủ lưu "
                "tổng giá sau ưu đãi có thẩm quyền."
            ),
        } for _opening_id in sorted(missing_recompute_openings)]
        validation_errors.extend(validate_opening_participant_uniqueness(
            cursor,
            organization_id,
            opening_items,
        ))
        validation_errors.extend(validate_package_goods_batch(
            cursor,
            organization_id,
            self.payload.get("goithauhanghoa", []),
        ))
        validation_errors.extend(validate_bidder_goods_batch(
            cursor,
            organization_id,
            bidder_goods_items,
            opening_items,
            incoming_records_by_table=self.payload_index.incoming_records_by_table,
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
        evaluation_methods_by_package = self._load_evaluation_methods_by_package(
            payloads,
            current_records_by_table,
            organization_id,
        )
        tombstones_by_table = self._load_tombstones(
            payloads,
            organization_id,
        )
        retention_row = cursor.execute(
            "SELECT min_available_version FROM sync_metadata WHERE organization_id = ?",
            (organization_id,),
        ).fetchone()
        min_available_version = int(retention_row[0] or 0) if retention_row else 0
        base_sync_version = int(self.payload.get("baseSyncVersion") or 0)
        records_by_table = {}
        for _payload_key, table_name, items in payloads:
            records_by_table.setdefault(table_name, []).extend(items)
        authorization_context = build_batch_write_authorization_context(
            cursor,
            actor.role,
            actor.user_id,
            organization_id,
            records_by_table,
            current_records_by_table,
        )
        if self.allow_new_historical_parents:
            # The finalize command has already validated a wholly unpersisted,
            # closed plan/package graph against the server in this transaction.
            for table in (
                "ke_hoach_lcnt",
                "goi_thau",
                "goi_thau_hang_hoa",
                "thong_tin_mo_thau",
                "hang_hoa_du_thau_nha_thau",
            ):
                for record in records_by_table.get(table, ()):
                    record_id = self.clean_record_id(table, record.get("id"))
                    if record_id and record_id not in current_records_by_table.get(table, {}):
                        authorization_context.new_plan_draft_records.add((table, record_id))
        authorization_context.server_inherited_assignment_ids.update(
            self.server_inherited_assignment_ids
        )
        uniqueness_context = build_domain_uniqueness_context(
            cursor,
            organization_id,
            records_by_table,
        )
        aggregate_mutability_context = build_aggregate_mutability_context(
            cursor,
            organization_id,
            records_by_table,
            current_records_by_table,
        )
        if self.allow_new_historical_parents:
            for plan in records_by_table.get("ke_hoach_lcnt", ()):
                plan_id = self.clean_record_id("ke_hoach_lcnt", plan.get("id"))
                if plan_id and plan_id not in current_records_by_table.get("ke_hoach_lcnt", {}):
                    aggregate_mutability_context.plan_is_latest_by_id[str(plan_id)] = True
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
                    validation_errors.append({
                        "table": table_name,
                        "id": item.get("id"),
                        "field": "$record",
                        "code": "RECORD_ACCESS_DENIED",
                        "message": "Không có quyền thực hiện thay đổi này.",
                    })
                    continue

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
                        history_error = historical_record_mutation_error(
                            table_name, current_record
                        )
                        if history_error:
                            item_errors.append(history_error)
                        expected_version = item.get(
                            "expectedVersion",
                            item.get("rowVersion"),
                        )
                        current_version = int(
                            current_record.get("row_version") or 1
                        )
                        if expected_version != current_version:
                            if not can_read_record(
                                cursor,
                                actor.role,
                                actor.user_id,
                                organization_id,
                                payload_key,
                                table_name,
                                current_record,
                            ):
                                validation_errors.append({
                                    "table": table_name,
                                    "id": item.get("id"),
                                    "field": "$record",
                                    "code": "RECORD_ACCESS_DENIED",
                                    "message": "Không có quyền thực hiện thay đổi này.",
                                })
                                continue
                            item_errors.append({
                                "field": "expectedVersion",
                                "code": "ROW_VERSION_CONFLICT",
                                "message": (
                                    "Bản ghi đã được thay đổi bởi một phiên "
                                    "làm việc khác."
                                ),
                                "expectedVersion": expected_version,
                                "currentVersion": current_version,
                                "serverRecord": project_conflict_record(
                                    map_db_to_json(table_name, current_record)
                                ),
                            })
                    else:
                        tombstone = tombstones_by_table.get(table_name, {}).get(record_id)
                        expected_version = item.get(
                            "expectedVersion",
                            item.get("rowVersion"),
                        )
                        if tombstone or expected_version is not None:
                            if base_sync_version < min_available_version:
                                code = "FULL_SYNC_REQUIRED"
                                message = "Con trỏ đồng bộ đã quá cũ; cần tải lại dữ liệu đầy đủ."
                            elif tombstone:
                                code = "RECORD_DELETED"
                                message = "Bản ghi đã bị xóa trên máy chủ."
                            else:
                                code = "RECORD_NOT_FOUND"
                                message = "Bản ghi cần cập nhật không còn tồn tại."
                            validation_errors.append({
                                "table": table_name,
                                "id": item.get("id"),
                                "field": "$record",
                                "code": code,
                                "message": message,
                                **(
                                    {"requiresFullSync": True}
                                    if code == "FULL_SYNC_REQUIRED"
                                    else {}
                                ),
                            })
                            continue
                if record_id and table_name in ARCHIVABLE_TABLES:
                    archived_record = current_records_by_table.get(
                        table_name,
                        {},
                    ).get(record_id)
                    if archived_record and archived_record.get("archived_at"):
                        item_errors.append(
                            "Bản ghi đã được lưu trữ và không thể chỉnh sửa."
                        )

                parent_history_error = historical_parent_mutation_error(
                    aggregate_mutability_context,
                    table_name,
                    item,
                    current_record,
                )
                if parent_history_error:
                    item_errors.append(parent_history_error)

                if table_name == "goi_thau":
                    item, pure_errors, _requested_statuses = validate_sync_item(
                        table_name,
                        item,
                        allowed_statuses,
                        allow_source_option_without_items=(
                            record_id in self.trusted_import_package_ids
                        ),
                    )
                else:
                    item, pure_errors, _requested_statuses = validate_sync_item(
                        table_name,
                        item,
                        allowed_statuses,
                    )
                item_errors.extend(pure_errors)
                if table_name == "thong_tin_mo_thau" and "danhGiaKyThuat" in item:
                    package_id = self._opening_package_id(item, current_record)
                    if (
                        requires_technical_score(evaluation_methods_by_package.get(package_id))
                        and parse_technical_score(item.get("danhGiaKyThuat")) is None
                        and not self._is_legacy_snapshot_result(item, package_id)
                    ):
                        item_errors.append({
                            "field": "danhGiaKyThuat",
                            "code": "TECHNICAL_SCORE_REQUIRED",
                            "message": (
                                "Gói thầu kết hợp kỹ thuật và giá bắt buộc nhập "
                                "điểm kỹ thuật bằng số; không được nhập Đạt/Không đạt."
                            ),
                        })
                if table_name == "goi_thau" and current_record:
                    item_errors.extend(validate_package_status_transition(
                        current_record.get("trang_thai"),
                        item,
                        allow_source_reconciliation=(
                            record_id in self.trusted_import_package_ids
                        ),
                    ))
                    item_errors.extend(validate_package_locked_fields(
                        current_record,
                        item,
                        allow_source_reconciliation=(
                            record_id in self.trusted_import_package_ids
                        ),
                    ))
                    item_errors.extend(validate_package_goods_configuration_change(
                        cursor,
                        organization_id,
                        current_record,
                        item,
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

    def _is_legacy_snapshot_result(self, item, package_id):
        if self.payload_index.stored_record("thong_tin_mo_thau", self.clean_record_id(
            "thong_tin_mo_thau", item.get("id"),
        )):
            return False
        package = self.payload_index.incoming_records_by_table.get("goi_thau", {}).get(
            package_id,
        )
        if not package:
            return False
        target_plan_id = self.clean_record_id("ke_hoach_lcnt", package.get("keHoachId"))
        target_plan = self.payload_index.incoming_records_by_table.get(
            "ke_hoach_lcnt", {},
        ).get(target_plan_id)
        if not target_plan:
            return False
        return is_inherited_legacy_technical_result(
            self.transaction.cursor,
            self.transaction.actor.organization_id,
            self.clean_record_id("goi_thau", package.get("rootId") or package.get("id")),
            package.get("phienBan"),
            target_plan_id,
            self.clean_record_id(
                "ke_hoach_lcnt",
                target_plan.get("rootId") or target_plan.get("id"),
            ),
            self.clean_record_id("nha_thau", item.get("nhaThauId") or item.get("nha_thau_id")),
            item.get("maPhanLo") or item.get("ma_phan_lo"),
            item.get("danhGiaKyThuat"),
        )

    def _load_evaluation_methods_by_package(
        self,
        payloads,
        current_records_by_table,
        organization_id: str,
    ) -> dict[str, str]:
        opening_records = current_records_by_table.get("thong_tin_mo_thau", {})
        package_ids = {
            package_id
            for _payload_key, table_name, items in payloads
            if table_name == "thong_tin_mo_thau"
            for item in items
            if "danhGiaKyThuat" in item
            if (
                package_id := self._opening_package_id(
                    item,
                    opening_records.get(
                        self.clean_record_id(table_name, item.get("id")) or ""
                    ),
                )
            )
        }
        if not package_ids:
            return {}

        methods = {}
        for _payload_key, table_name, items in payloads:
            if table_name != "goi_thau":
                continue
            for item in items:
                package_id = self.clean_record_id(table_name, item.get("id"))
                if package_id not in package_ids or "phuongPhapDanhGia" not in item:
                    continue
                methods[package_id] = str(item.get("phuongPhapDanhGia") or "").strip()

        missing_ids = sorted(package_ids - methods.keys())
        for offset in range(0, len(missing_ids), _QUERY_CHUNK_SIZE):
            chunk = missing_ids[offset:offset + _QUERY_CHUNK_SIZE]
            placeholders = ", ".join("?" for _ in chunk)
            rows = self.transaction.cursor.execute(
                f"""SELECT id, phuong_phap_danh_gia FROM goi_thau
                    WHERE organization_id = ? AND id IN ({placeholders})""",  # noqa: S608 - placeholders are generated from validated IDs
                (organization_id, *chunk),
            ).fetchall()
            for row in rows:
                if isinstance(row, dict):
                    package_id = self.clean_record_id("goi_thau", row.get("id"))
                    method = row.get("phuong_phap_danh_gia")
                else:
                    package_id = self.clean_record_id("goi_thau", row[0])
                    method = row[1] if len(row) > 1 else ""
                if package_id:
                    methods[package_id] = str(method or "").strip()
        return methods

    def _opening_package_id(self, item, current_record) -> str | None:
        return self.clean_record_id(
            "goi_thau",
            item.get("goiThauId")
            or item.get("goi_thau_id")
            or (current_record or {}).get("goi_thau_id"),
        )

    def _load_tombstones(
        self,
        payloads,
        organization_id: str,
    ) -> dict[str, dict[str, int]]:
        cursor = self.transaction.cursor
        tombstones_by_table: dict[str, dict[str, int]] = {}
        for _payload_key, table_name, items in payloads:
            record_ids = list(dict.fromkeys(
                record_id
                for item in items
                if (
                    record_id := self.clean_record_id(table_name, item.get("id"))
                )
            ))
            table_tombstones = tombstones_by_table.setdefault(table_name, {})
            for offset in range(0, len(record_ids), _QUERY_CHUNK_SIZE):
                chunk = record_ids[offset:offset + _QUERY_CHUNK_SIZE]
                placeholders = ", ".join("?" for _ in chunk)
                tombstone_sql = f"SELECT record_id, delete_version FROM deleted_records WHERE organization_id = ? AND table_name = ? AND record_id IN ({placeholders})"  # noqa: S608 - generated placeholders only
                rows = cursor.execute(
                    tombstone_sql,
                    (organization_id, table_name, *chunk),
                ).fetchall()
                table_tombstones.update(
                    (str(row[0]), int(row[1] or 0))
                    for row in rows
                )
        return tombstones_by_table

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
