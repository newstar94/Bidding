"""Serialize one canonical sync item into database column values."""

from __future__ import annotations

import json
import re
from typing import Any, Callable

from backend.db.id_utils import generate_record_id
from backend.shared.date_utils import (
    is_datetime_column,
    normalize_date_value,
    normalize_datetime_value,
)
from backend.shared.domain_enums import enum_code
from backend.shared.media_helper import normalize_managed_image_path
from backend.shared.numeric_utils import parse_vnd_amount
from backend.shared.text_utils import normalize_lot_code, normalize_person_name
from backend.shared.helpers import safe_float, safe_int


class SyncRecordSerializer:
    def __init__(
        self,
        transaction_context,
        *,
        sync_version: int,
        newly_written_images: set[str],
        mutation_tracker,
        clean_record_id: Callable[[str, Any], str | None],
        schema_definition: dict[str, Any],
        money_columns: set[tuple[str, str]],
        field_name_for_column: Callable[[str, str], str],
        payload_value_for_column: Callable[[str, dict[str, Any], str], Any],
    ):
        self.transaction = transaction_context
        self.sync_version = sync_version
        self.newly_written_images = newly_written_images
        self.mutation_tracker = mutation_tracker
        self.clean_record_id = clean_record_id
        self.schema_definition = schema_definition
        self.money_columns = money_columns
        self.field_name_for_column = field_name_for_column
        self.payload_value_for_column = payload_value_for_column

    def serialize(
        self,
        table_name: str,
        item: dict[str, Any],
        previous_record: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        table_spec = self.schema_definition[table_name]
        explicit_json = set(table_spec.get("json_fields", []))
        db_row_data: dict[str, Any] = {}
        for column, raw_column_type in table_spec["columns"].items():
            if table_name == "thong_tin_mo_thau" and column in {
                "violation_status",
                "violation_bid_closing_at",
                "violation_checked_at",
            }:
                # Server-authoritative lookup state is read-only to sync clients.
                continue
            if column == "organization_id":
                db_row_data[column] = self.transaction.actor.organization_id
                continue
            if column == "owner_type":
                db_row_data[column] = self.transaction.owner_type
                continue
            if column == "updated_at":
                db_row_data[column] = self.transaction.current_time
                continue
            if column == "sync_version":
                db_row_data[column] = self.sync_version
                continue
            if column == "id_goc":
                db_row_data[column] = (
                    self.clean_record_id(table_name, item.get("rootId"))
                    or self.clean_record_id(
                        table_name,
                        previous_record.get("id_goc") if previous_record else None,
                    )
                    or self.clean_record_id(table_name, item.get("id"))
                )
                continue

            payload_key = self.field_name_for_column(table_name, column)
            if payload_key not in item:
                continue
            value = self.payload_value_for_column(table_name, item, column)
            if column == "id" or column.endswith("_id") or column == "id_goc":
                value = self.clean_record_id(table_name, value)

            is_json_column = (
                column in explicit_json
                or column.endswith("_list")
                or column.startswith("cv_")
            )
            if isinstance(value, (list, dict)):
                value = json.dumps(value)
            elif is_json_column:
                if value is None:
                    value = "[]"
                elif not isinstance(value, str):
                    value = json.dumps(value)

            if (
                isinstance(value, str)
                and not is_json_column
                and column != "goi_thau_ids"
                and not value.startswith("[")
                and not value.startswith("{")
            ):
                value = value.strip()

            if (
                (table_name == "chu_dau_tu" and column == "dai_dien_cdt")
                or (table_name == "nha_thau" and column == "nguoi_dai_dien")
            ):
                value = normalize_person_name(value)

            if column.startswith("ngay_"):
                value = normalize_date_value(value)
            elif is_datetime_column(column):
                value = normalize_datetime_value(value)

            column_type = str(raw_column_type).upper()
            if (table_name, column) in self.money_columns:
                value = parse_vnd_amount(value)
            elif "REAL" in column_type:
                value = safe_float(value)
            elif "INTEGER" in column_type and value is not None:
                value = safe_int(value)

            if value is None and "DEFAULT" in column_type:
                default_match = re.search(r"DEFAULT\s+'([^']+)'", column_type)
                if default_match:
                    value = default_match.group(1)

            value = self._validate_managed_image(
                table_name,
                column,
                item,
                value,
            )
            if value is None and "NOT NULL" in column_type:
                continue
            db_row_data[column] = enum_code(table_name, column, value)

        if not db_row_data.get("id"):
            db_row_data["id"] = generate_record_id(table_name)
        if table_name == "thong_tin_mo_thau" and "ma_phan_lo" in db_row_data:
            db_row_data["ma_phan_lo_normalized"] = normalize_lot_code(
                db_row_data.get("ma_phan_lo")
            )
        if not item.get("id"):
            item["id"] = db_row_data["id"]
        return db_row_data

    def _validate_managed_image(
        self,
        table_name: str,
        column: str,
        item: dict[str, Any],
        value: Any,
    ) -> Any:
        is_expert_image = table_name == "chuyen_gia" and column in {
            "anh_chung_chi",
            "anh_chu_ky",
        }
        is_contractor_image = table_name == "nha_thau" and column == "anh_dau"
        if not (is_expert_image or is_contractor_image):
            return value

        cursor = self.transaction.cursor
        organization_id = self.transaction.actor.organization_id
        previous_image = ""
        record_id = self.clean_record_id(table_name, item.get("id"))
        if record_id:
            previous_row = cursor.execute(
                f"""SELECT {column} FROM {table_name}
                    WHERE organization_id = ? AND id = ? LIMIT 1""",
                (organization_id, record_id),
            ).fetchone()
            if previous_row:
                previous_image = normalize_managed_image_path(previous_row[0])

        is_new_image_data = isinstance(value, str) and value.startswith("data:image")
        proposed_image = normalize_managed_image_path(value)
        allowed_images = {previous_image} if previous_image else set()
        if proposed_image in self.newly_written_images:
            allowed_images.add(proposed_image)
        if proposed_image and proposed_image not in allowed_images:
            owned_row = cursor.execute(
                f"""SELECT 1 FROM {table_name}
                    WHERE organization_id = ? AND {column} = ? LIMIT 1""",
                (organization_id, proposed_image),
            ).fetchone()
            if owned_row:
                allowed_images.add(proposed_image)

        if value:
            if is_new_image_data:
                raise ValueError("Ảnh phải được xử lý trước transaction.")
            expected_prefix = (
                "images/chuyen_gia/"
                if is_expert_image
                else "images/nha_thau/"
            )
            if (
                not proposed_image
                or not proposed_image.startswith(expected_prefix)
                or proposed_image not in allowed_images
            ):
                raise ValueError("Ảnh không thuộc bản ghi hoặc tổ chức này.")
            value = proposed_image

        current_image = normalize_managed_image_path(value)
        if is_new_image_data and current_image:
            self.newly_written_images.add(current_image)
        if previous_image and previous_image != current_image:
            if not value or current_image:
                self.mutation_tracker.record_image_cleanup(previous_image)
        return value
