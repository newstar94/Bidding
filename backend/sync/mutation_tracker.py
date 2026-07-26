"""Track derived sync effects without leaking bookkeeping across the transaction."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from backend.shared.helpers import clean_id
from backend.sync.repository import VERSIONED_TABLES


def clean_sync_record_id(table_name: str, raw_id: Any) -> str | None:
    if raw_id is None:
        return None
    if table_name in {"phan_cong_nhan_su", "danh_muc_trang_thai_hop_dong"}:
        return str(raw_id).strip()
    return clean_id(raw_id)


@dataclass(frozen=True, slots=True)
class SyncMutationOutcome:
    updated_row_versions: tuple[dict[str, Any], ...]
    orphaned_ids: tuple[dict[str, Any], ...]
    delete_impacts: tuple[dict[str, Any], ...]
    image_cleanup_candidates: frozenset[str]


class SyncMutationTracker:
    def __init__(self, clean_record_id: Callable[[str, Any], str | None]):
        self.clean_record_id = clean_record_id
        self._affected_version_families: dict[str, set[Any]] = {}
        self._affected_plan_ids: set[str] = set()
        self._updated_row_versions: list[dict[str, Any]] = []
        self._orphaned_ids: list[dict[str, Any]] = []
        self._delete_impacts: list[dict[str, Any]] = []
        self._image_cleanup_candidates: set[str] = set()

    def track_record(self, table_name: str, record: Any) -> None:
        if not isinstance(record, dict):
            return
        if table_name in VERSIONED_TABLES:
            root_id = self.clean_record_id(
                table_name,
                record.get("id_goc") or record.get("rootId") or record.get("id"),
            )
            if root_id:
                family_key: Any = root_id
                if table_name == "goi_thau":
                    plan_id = self.clean_record_id(
                        "ke_hoach_lcnt",
                        record.get("ke_hoach_id") or record.get("keHoachId"),
                    )
                    family_key = (root_id, plan_id or "")
                self._affected_version_families.setdefault(table_name, set()).add(
                    family_key
                )
        if table_name == "ke_hoach_lcnt":
            plan_id = self.clean_record_id(table_name, record.get("id"))
            if plan_id:
                self._affected_plan_ids.add(plan_id)
        elif table_name == "goi_thau":
            plan_id = self.clean_record_id(
                "ke_hoach_lcnt",
                record.get("ke_hoach_id") or record.get("keHoachId"),
            )
            if plan_id:
                self._affected_plan_ids.add(plan_id)

    def record_row_version(self, table: str, record_id: str, row_version: int) -> None:
        self._updated_row_versions.append(
            {"table": table, "id": record_id, "rowVersion": row_version}
        )

    def record_orphan(self, table: str, record_id: str) -> None:
        self._orphaned_ids.append({"table": table, "id": record_id})

    def record_image_cleanup(self, managed_path: str) -> None:
        if managed_path:
            self._image_cleanup_candidates.add(managed_path)

    def merge_deletion_result(self, result: dict[str, Any]) -> None:
        self._delete_impacts.extend(result.get("impacts") or [])
        for table_name, families in (
            result.get("affectedVersionFamilies") or {}
        ).items():
            self._affected_version_families.setdefault(table_name, set()).update(
                families
            )
        self._affected_plan_ids.update(result.get("affectedPlanIds") or set())
        self._image_cleanup_candidates.update(
            result.get("imageCleanupCandidates") or set()
        )

    def apply_recalculations(
        self,
        cursor,
        organization_id: str,
        *,
        recalculate_latest,
        recalculate_plan_total,
    ) -> None:
        for table_name, families in self._affected_version_families.items():
            recalculate_latest(
                cursor,
                table_name,
                organization_id=organization_id,
                affected_families=families,
            )
        if self._affected_plan_ids:
            recalculate_plan_total(
                cursor,
                organization_id=organization_id,
                plan_ids=self._affected_plan_ids,
            )

    def outcome(self) -> SyncMutationOutcome:
        return SyncMutationOutcome(
            updated_row_versions=tuple(self._updated_row_versions),
            orphaned_ids=tuple(self._orphaned_ids),
            delete_impacts=tuple(self._delete_impacts),
            image_cleanup_candidates=frozenset(self._image_cleanup_candidates),
        )
