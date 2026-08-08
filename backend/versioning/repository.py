"""Tenant-scoped SQL loader for official aggregate version snapshots."""

from __future__ import annotations

from backend.sync.mapper import attach_child_rows_to_items, map_db_to_json
from backend.sync.repository import get_current_sync_version


class AggregateVersionRepository:
    """Load version source aggregates through a transaction-owned cursor."""

    def __init__(
        self,
        cursor,
        *,
        map_record=map_db_to_json,
        attach_children=attach_child_rows_to_items,
    ):
        self.cursor = cursor
        self.map_record = map_record
        self.attach_children = attach_children

    def _mapped_rows(self, table_name, rows):
        return [self.map_record(table_name, dict(row)) for row in rows]

    def _load_package_relations(self, organization_id, package_ids):
        state = {
            "goithauhanghoa": [],
            "thongtinmothau": [],
            "hanghoaduthaunhathau": [],
            "assignments": [],
        }
        if not package_ids:
            return state
        placeholders = ", ".join("?" for _ in package_ids)
        relation_specs = (
            ("goithauhanghoa", "goi_thau_hang_hoa", "goi_thau_id"),
            ("thongtinmothau", "thong_tin_mo_thau", "goi_thau_id"),
            (
                "hanghoaduthaunhathau",
                "hang_hoa_du_thau_nha_thau",
                "goi_thau_id",
            ),
        )
        for payload_key, table_name, parent_column in relation_specs:
            rows = self.cursor.execute(
                f"""SELECT * FROM {table_name}
                    WHERE organization_id = ?
                      AND {parent_column} IN ({placeholders})
                    FOR UPDATE""",  # noqa: S608 - fixed repository identifiers
                (organization_id, *package_ids),
            ).fetchall()
            state[payload_key] = self._mapped_rows(table_name, rows)

        assignments = self.cursor.execute(
            f"""SELECT * FROM phan_cong_nhan_su
                WHERE organization_id = ?
                  AND loai_doi_tuong = 'goithau'
                  AND id_muc_tieu IN ({placeholders})
                FOR UPDATE""",  # noqa: S608 - placeholders only
            (organization_id, *package_ids),
        ).fetchall()
        state["assignments"] = self._mapped_rows(
            "phan_cong_nhan_su", assignments
        )
        self.attach_children(
            self.cursor,
            "thong_tin_mo_thau",
            state["thongtinmothau"],
            organization_id=organization_id,
        )
        return state

    def load_package_state(self, organization_id, source_id):
        row = self.cursor.execute(
            """SELECT * FROM goi_thau
               WHERE organization_id = ? AND id = ?
                 AND archived_at IS NULL
               FOR UPDATE""",
            (organization_id, source_id),
        ).fetchone()
        packages = self._mapped_rows("goi_thau", [row] if row else [])
        self.attach_children(
            self.cursor,
            "goi_thau",
            packages,
            organization_id=organization_id,
        )
        state = {"kehoach": [], "goithau": packages}
        state.update(
            self._load_package_relations(
                organization_id,
                [source_id] if row else [],
            )
        )
        return state

    def load_plan_state(self, organization_id, source_id):
        plan_row = self.cursor.execute(
            """SELECT * FROM ke_hoach_lcnt
               WHERE organization_id = ? AND id = ?
                 AND archived_at IS NULL
               FOR UPDATE""",
            (organization_id, source_id),
        ).fetchone()
        plans = self._mapped_rows(
            "ke_hoach_lcnt", [plan_row] if plan_row else []
        )
        self.attach_children(
            self.cursor,
            "ke_hoach_lcnt",
            plans,
            organization_id=organization_id,
        )

        package_rows = []
        if plan_row:
            package_rows = self.cursor.execute(
                """SELECT * FROM goi_thau
                   WHERE organization_id = ? AND ke_hoach_id = ?
                     AND is_latest = 1 AND archived_at IS NULL
                   ORDER BY id
                   FOR UPDATE""",
                (organization_id, source_id),
            ).fetchall()
        packages = self._mapped_rows("goi_thau", package_rows)
        self.attach_children(
            self.cursor,
            "goi_thau",
            packages,
            organization_id=organization_id,
        )
        state = {"kehoach": plans, "goithau": packages}
        state.update(
            self._load_package_relations(
                organization_id,
                [package["id"] for package in packages],
            )
        )
        if plan_row:
            plan_assignments = self.cursor.execute(
                """SELECT * FROM phan_cong_nhan_su
                   WHERE organization_id = ?
                     AND loai_doi_tuong = 'kehoach'
                     AND id_muc_tieu = ?
                   FOR UPDATE""",
                (organization_id, source_id),
            ).fetchall()
            state["assignments"].extend(
                self._mapped_rows("phan_cong_nhan_su", plan_assignments)
            )
        return state

    def current_sync_version(self, organization_id):
        return get_current_sync_version(self.cursor, organization_id)
