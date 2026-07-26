"""Canonical indexes shared by sync validation and record persistence."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from backend.sync.mapper import canonicalize_payload_item
from backend.sync.serializer import iter_sync_table_payloads


@dataclass(slots=True)
class SyncPayloadIndex:
    incoming_ids_by_table: dict[str, set[str]] = field(default_factory=dict)
    incoming_records_by_table: dict[str, dict[str, dict[str, Any]]] = field(
        default_factory=dict
    )
    stored_records_by_table: dict[str, dict[str, dict[str, Any]]] = field(
        default_factory=dict
    )
    skipped_records: set[tuple[str, str]] = field(default_factory=set)
    incoming_contract_status_names: set[str] = field(default_factory=set)

    @classmethod
    def build(
        cls,
        payload: dict[str, Any],
        clean_record_id: Callable[[str, Any], str | None],
    ) -> "SyncPayloadIndex":
        index = cls()
        for _payload_key, table_name, items in iter_sync_table_payloads(payload):
            table_records = index.incoming_records_by_table.setdefault(
                table_name, {}
            )
            table_ids = index.incoming_ids_by_table.setdefault(table_name, set())
            for item in items:
                if not isinstance(item, dict):
                    continue
                canonical_item = canonicalize_payload_item(table_name, item)
                record_id = clean_record_id(table_name, canonical_item.get("id"))
                if record_id:
                    normalized_id = str(record_id)
                    table_ids.add(normalized_id)
                    table_records[normalized_id] = canonical_item
        index.incoming_contract_status_names = {
            str(item.get("name") or item.get("tenTrangThai") or "").strip()
            for item in payload.get("customcontractstatuses", [])
            if isinstance(item, dict)
            and str(item.get("name") or item.get("tenTrangThai") or "").strip()
        }
        return index

    def allowed_contract_status_names(self, cursor, organization_id: str) -> set[str]:
        existing = {
            str(row[0] or "").strip()
            for row in cursor.execute(
                """SELECT name FROM danh_muc_trang_thai_hop_dong
                   WHERE organization_id = ?""",
                (organization_id,),
            ).fetchall()
            if str(row[0] or "").strip()
        }
        return existing | self.incoming_contract_status_names

    def remember_stored_record(
        self,
        table_name: str,
        record_id: str,
        record: dict[str, Any],
    ) -> None:
        self.stored_records_by_table.setdefault(table_name, {})[
            str(record_id)
        ] = record

    def stored_record(self, table_name: str, record_id: str | None):
        return self.stored_records_by_table.get(table_name, {}).get(str(record_id))

    def skip(self, table_name: str, record_id: str | None) -> None:
        self.skipped_records.add((table_name, str(record_id)))

    def should_skip(self, table_name: str, record_id: str | None) -> bool:
        return (table_name, str(record_id)) in self.skipped_records
