"""Persist one serialized sync row and its owned relations."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable


_QUERY_CHUNK_SIZE = 500


@dataclass(frozen=True, slots=True)
class SyncRecordWriteResult:
    conflict_error: dict[str, Any] | None = None


class SyncRecordWriter:
    def __init__(
        self,
        transaction_context,
        *,
        sync_version: int,
        mutation_tracker,
        clean_record_id: Callable[[str, Any], str | None],
        ownership_scoped_tables: set[str],
        defer_latest_flag,
        map_database_record,
        save_children,
    ):
        self.transaction = transaction_context
        self.sync_version = sync_version
        self.mutation_tracker = mutation_tracker
        self.clean_record_id = clean_record_id
        self.ownership_scoped_tables = ownership_scoped_tables
        self.defer_latest_flag = defer_latest_flag
        self.map_database_record = map_database_record
        self.save_children = save_children

    def write(
        self,
        *,
        payload_key: str,
        table_name: str,
        item: dict[str, Any],
        db_row_data: dict[str, Any],
        previous_record: dict[str, Any] | None,
    ) -> SyncRecordWriteResult:
        cursor = self.transaction.cursor
        actor = self.transaction.actor
        organization_id = actor.organization_id
        owner_type = self.transaction.owner_type
        self.defer_latest_flag(table_name, db_row_data)
        self._replace_singleton_rows(table_name, db_row_data)

        existing_version_row = cursor.execute(
            f"""SELECT row_version FROM {table_name}
                WHERE organization_id = ? AND id = ? LIMIT 1""",
            (organization_id, db_row_data["id"]),
        ).fetchone()
        if existing_version_row:
            expected_version = item.get("expectedVersion", item.get("rowVersion"))
            db_row_data["row_version"] = int(expected_version) + 1
            update_columns = [
                key
                for key in db_row_data
                if key not in {"id", "organization_id", "created_at"}
            ]
            assignments = ", ".join(f"{key} = ?" for key in update_columns)
            params = [db_row_data[key] for key in update_columns]
            params.extend([db_row_data["id"], organization_id, expected_version])
            cursor.execute(
                f"""UPDATE {table_name} SET {assignments}
                    WHERE id = ? AND organization_id = ? AND row_version = ?""",
                tuple(params),
            )
            if cursor.rowcount != 1:
                latest = cursor.execute(
                    f"""SELECT * FROM {table_name}
                        WHERE organization_id = ? AND id = ? LIMIT 1""",
                    (organization_id, db_row_data["id"]),
                ).fetchone()
                latest_record = dict(latest) if latest else None
                return SyncRecordWriteResult(conflict_error={
                    "table": table_name,
                    "id": db_row_data["id"],
                    "field": "expectedVersion",
                    "code": "ROW_VERSION_CONFLICT",
                    "message": (
                        "Bản ghi đã được thay đổi bởi một phiên làm việc khác."
                    ),
                    "expectedVersion": expected_version,
                    "currentVersion": (
                        latest_record.get("row_version")
                        if latest_record
                        else None
                    ),
                    "serverRecord": (
                        self.map_database_record(table_name, latest_record)
                        if latest_record
                        else None
                    ),
                })
        else:
            db_row_data["row_version"] = 1
            columns = ", ".join(db_row_data)
            placeholders = ", ".join(["?"] * len(db_row_data))
            cursor.execute(
                f"INSERT INTO {table_name} ({columns}) VALUES ({placeholders})",
                tuple(db_row_data.values()),
            )

        if table_name in self.ownership_scoped_tables:
            lineage_root = (
                self.clean_record_id(
                    table_name,
                    item.get("rootId") or item.get("id_goc"),
                )
                or db_row_data["id"]
            )
            cursor.execute(
                """INSERT INTO record_edit_ownership (
                       organization_id, table_name, record_id, user_id
                   ) VALUES (?, ?, ?, ?)
                   ON CONFLICT (organization_id, table_name, record_id)
                   DO NOTHING""",
                (
                    organization_id,
                    table_name,
                    lineage_root,
                    actor.user_id,
                ),
            )

        self.mutation_tracker.record_row_version(
            payload_key,
            db_row_data["id"],
            db_row_data["row_version"],
        )
        self.save_children(
            cursor,
            table_name,
            item,
            organization_id,
            owner_type,
            self.sync_version,
            self.transaction.current_time,
            actor.user_id,
        )
        self._replace_contract_packages(table_name, item)
        self.mutation_tracker.track_record(table_name, previous_record)
        self.mutation_tracker.track_record(table_name, db_row_data)
        self.mutation_tracker.track_activity(table_name, previous_record, db_row_data)
        return SyncRecordWriteResult()

    def _replace_singleton_rows(
        self,
        table_name: str,
        db_row_data: dict[str, Any],
    ) -> None:
        cursor = self.transaction.cursor
        if table_name == "ma_tran_phan_quyen":
            cursor.execute(
                """DELETE FROM ma_tran_phan_quyen
                   WHERE organization_id = ? AND emp_id = ? AND id != ?""",
                (
                    db_row_data.get("organization_id"),
                    db_row_data.get("emp_id"),
                    db_row_data.get("id"),
                ),
            )

    def _replace_contract_packages(
        self,
        table_name: str,
        item: dict[str, Any],
    ) -> None:
        if table_name != "hop_dong":
            return
        cursor = self.transaction.cursor
        organization_id = self.transaction.actor.organization_id
        contract_id = self.clean_record_id("hop_dong", item.get("id"))
        cursor.execute(
            """DELETE FROM hop_dong_goi_thau
               WHERE organization_id = ? AND hop_dong_id = ?""",
            (organization_id, contract_id),
        )
        package_ids = list(dict.fromkeys(
            package_id
            for raw_package_id in item.get("goiThauIds", [])
            if raw_package_id
            if (
                package_id := self.clean_record_id(
                    "goi_thau",
                    raw_package_id,
                )
            ) is not None
        ))
        existing_ids = set()
        for offset in range(0, len(package_ids), _QUERY_CHUNK_SIZE):
            chunk = package_ids[offset:offset + _QUERY_CHUNK_SIZE]
            placeholders = ", ".join("?" for _ in chunk)
            rows = cursor.execute(
                f"""SELECT id FROM goi_thau
                    WHERE organization_id = ? AND id IN ({placeholders})""",
                (organization_id, *chunk),
            ).fetchall()
            existing_ids.update(str(row[0]) for row in rows)
        missing_ids = [
            package_id
            for package_id in package_ids
            if str(package_id) not in existing_ids
        ]
        if missing_ids:
            raise ValueError(
                f"Goi thau {missing_ids[0]} khong thuoc owner hien tai."
            )
        if package_ids:
            cursor.executemany(
                """INSERT INTO hop_dong_goi_thau (
                       organization_id, owner_type, hop_dong_id, goi_thau_id
                   ) VALUES (?, ?, ?, ?)
                   ON CONFLICT (organization_id, hop_dong_id, goi_thau_id)
                   DO UPDATE SET owner_type = EXCLUDED.owner_type,
                                 updated_at = CURRENT_TIMESTAMP""",
                [
                    (
                        organization_id,
                        self.transaction.owner_type,
                        contract_id,
                        package_id,
                    )
                    for package_id in package_ids
                ],
            )
