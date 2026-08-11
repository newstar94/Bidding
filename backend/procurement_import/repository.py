"""PostgreSQL persistence for procurement import commands and provenance."""

from __future__ import annotations

from copy import deepcopy
import json
from datetime import datetime, timezone
from uuid import NAMESPACE_URL, uuid5

from backend.procurement_import.domain import (
    ImportConflict,
    canonical_digest,
    revision_sort_key,
)
from backend.db.schema import MONEY_COLUMNS
from backend.shared.helpers import SCHEMA_DINH_NGHIA
from backend.shared.date_utils import normalize_datetime_value
from backend.sync.command import SyncActorContext, SyncTransactionContext
from backend.sync.mapper import (
    get_payload_value,
    json_key_for_column,
    save_child_payloads,
)
from backend.sync.mutation_tracker import clean_sync_record_id
from backend.sync.record_serializer import SyncRecordSerializer
from backend.versioning.aggregate_snapshot import snapshot_package_aggregate
from backend.versioning.repository import AggregateVersionRepository


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _stable_id(*parts):
    return str(uuid5(NAMESPACE_URL, ":".join(map(str, parts))))


class _CloneMutationTracker:
    def record_image_cleanup(self, _path):
        return None


class ProcurementImportRepository:
    def __init__(self, cursor):
        self.cursor = cursor

    def lock_family(self, organization_id, provider, family_no):
        lock_key = f"procurement:{organization_id}:{provider}:{family_no}"
        self.cursor.execute("SELECT pg_advisory_xact_lock(hashtext(?))", (lock_key,))
        return lock_key

    def load_family(self, organization_id, provider, family_no):
        revision_rows = self.cursor.execute(
            """SELECT revision_uuid, revision_no, disposition, digest
                 FROM procurement_source_revision
                WHERE organization_id = ? AND provider = ?
                  AND entity_kind = 'PLAN' AND family_key = ?""",
            (organization_id, provider, family_no),
        ).fetchall()
        observed_revisions = {
            str(row[0]): {
                "revisionNumber": row[1], "disposition": row[2],
                "digest": row[3],
            }
            for row in revision_rows
        }
        applied_numbers = [
            row[1] for row in revision_rows if row[2] == "APPLIED"
        ]
        latest_external = (
            max(applied_numbers, key=revision_sort_key)
            if applied_numbers else None
        )
        family_state = {
            "latestPlan": None,
            "packages": [],
            "observedRevisions": observed_revisions,
            "latestAppliedExternalRevision": latest_external,
        }
        plan = self.cursor.execute(
            """SELECT id, COALESCE(NULLIF(id_goc, ''), id) AS root_id,
                      phien_ban, row_version
                 FROM ke_hoach_lcnt
                WHERE organization_id = ? AND upper(ma_ke_hoach) = ?
                  AND is_latest = 1 AND archived_at IS NULL
                ORDER BY phien_ban DESC, id DESC LIMIT 1 FOR UPDATE""",
            (organization_id, family_no.upper()),
        ).fetchone()
        if plan is None:
            return family_state
        latest_plan = {
            "id": plan[0], "rootId": plan[1], "localVersion": int(plan[2] or 0),
            "rowVersion": int(plan[3] or 1), "familyNo": family_no,
        }
        rows = self.cursor.execute(
            """SELECT package.id,
                      COALESCE(NULLIF(package.id_goc, ''), package.id),
                      package.phien_ban, package.ma_goi_thau,
                      package.ten_goi_thau, package.row_version,
                      binding.symbol, binding.canonical_fields_json,
                      package.gia_goi_thau, package.loai_hop_dong,
                      package.hinh_thuc_lua_chon, package.phuong_thuc_lua_chon,
                      package.qua_mang, package.trong_nuoc_quoc_te,
                      package.thoi_gian_thuc_hien, package.nguon_von,
                      package.linh_vuc, package.thoi_gian_to_chuc,
                      package.thoi_gian_bat_dau_to_chuc,
                      package.phuong_phap_danh_gia,
                      (SELECT assignment.id_nhan_vien
                         FROM phan_cong_nhan_su AS assignment
                        WHERE assignment.organization_id = package.organization_id
                          AND assignment.loai_doi_tuong = 'goithau'
                          AND assignment.id_muc_tieu = package.id
                        ORDER BY assignment.id LIMIT 1) AS assignee_user_id,
                      binding.stable_external_id,
                      binding.family_key, binding.plan_revision_uuid,
                      binding.id_detail, binding.match_method,
                      binding.confirmed_by, package.ke_hoach_id,
                      package.trang_thai, package.thoi_gian_dong_thau,
                      package.thoi_gian_mo_thau
                 FROM goi_thau AS package
            LEFT JOIN procurement_source_binding AS binding
                   ON binding.organization_id = package.organization_id
                  AND binding.local_snapshot_id = package.id
                WHERE package.organization_id = ? AND package.ke_hoach_id = ?
                  AND package.is_latest = 1 AND package.archived_at IS NULL
                ORDER BY package.id FOR UPDATE OF package""",
            (organization_id, plan[0]),
        ).fetchall()
        packages = []
        for row in rows:
            try:
                source_fields = json.loads(row[7] or "{}")
            except (TypeError, json.JSONDecodeError):
                source_fields = {}
            local_fields = {
                "symbol": row[6], "name": row[4],
                "priceVnd": None if row[8] is None else int(row[8]),
                "contractType": row[9], "selectionForm": row[10],
                "selectionMode": row[11], "onlineMode": row[12],
                "domesticOrInternational": row[13],
                "executionPeriod": row[14], "capitalDetail": row[15],
                "field": row[16], "selectionDuration": row[17],
                "selectionStart": row[18], "evaluationMethod": row[19],
            }
            if "noticeLink" in source_fields:
                local_notice = dict(source_fields.get("noticeLink") or {})
                local_notice.update({
                    "state": "LINKED" if row[3] else "UNLINKED",
                    "noticeNo": row[3],
                })
                local_fields["noticeLink"] = local_notice
            local_fields = {
                key: value for key, value in local_fields.items()
                if value is not None or key in source_fields
            }
            packages.append({
                "id": row[0], "rootId": row[1], "localVersion": int(row[2] or 0),
                "noticeNo": row[3], "name": row[4], "rowVersion": int(row[5] or 1),
                "symbol": row[6], "sourceFields": source_fields,
                "localFields": local_fields, "assigneeUserId": row[20],
                "stableExternalId": row[21], "planSnapshotId": row[27],
                "noticeKind": (
                    (source_fields.get("noticeLink") or {}).get("kind")
                    or "UNKNOWN"
                ),
                "noticeFields": deepcopy(source_fields.get("noticeFields") or {}),
                "binding": {
                    "familyNo": row[22], "planRevisionId": row[23],
                    "idDetail": row[24], "stableExternalId": row[21],
                    "symbol": row[6], "noticeNo": row[3],
                    "matchMethod": row[25], "confirmedBy": row[26],
                } if row[23] and row[24] else None,
            })
        return {
            **family_state, "latestPlan": latest_plan, "packages": packages,
        }

    def find_revision(self, organization_id, provider, revision_id):
        row = self.cursor.execute(
            """SELECT family_key, revision_no, digest, disposition,
                      schema_version, canonical_snapshot_json,
                      idempotency_key
                 FROM procurement_source_revision
                WHERE organization_id = ? AND provider = ?
                  AND entity_kind = 'PLAN' AND revision_uuid = ?""",
            (organization_id, provider, revision_id),
        ).fetchone()
        if row is None:
            return None
        return {
            "organizationId": organization_id, "provider": provider, "kind": "PLAN",
            "familyNo": row[0], "revisionNumber": row[1], "revisionId": revision_id,
            "digest": row[2], "disposition": row[3], "schemaVersion": row[4],
            "normalizedSnapshot": json.loads(row[5]), "idempotencyKey": row[6],
        }

    def find_notice_revision(self, organization_id, provider, revision_id):
        row = self.cursor.execute(
            """SELECT family_key, revision_no, digest, disposition,
                      schema_version, canonical_snapshot_json,
                      idempotency_key, local_root_id, local_snapshot_id,
                      match_method
                 FROM procurement_source_revision
                WHERE organization_id = ? AND provider = ?
                  AND entity_kind = 'NOTICE' AND revision_uuid = ?""",
            (organization_id, provider, revision_id),
        ).fetchone()
        if row is None:
            return None
        return {
            "organizationId": organization_id, "provider": provider,
            "kind": "NOTICE", "familyNo": row[0],
            "revisionNumber": row[1], "revisionId": revision_id,
            "digest": row[2], "disposition": row[3],
            "schemaVersion": row[4], "normalizedSnapshot": json.loads(row[5]),
            "idempotencyKey": row[6], "localRootId": row[7],
            "localSnapshotId": row[8], "matchMethod": row[9],
        }

    def latest_notice_revision_for_package(
        self, organization_id, provider, local_root_id
    ):
        row = self.cursor.execute(
            """SELECT revision_uuid, revision_no, canonical_snapshot_json,
                      digest, disposition, idempotency_key, local_snapshot_id,
                      match_method
                 FROM procurement_source_revision
                WHERE organization_id = ? AND provider = ?
                  AND entity_kind = 'NOTICE' AND local_root_id = ?
                ORDER BY CASE WHEN revision_no ~ '^[0-9]+$'
                              THEN revision_no::BIGINT ELSE -1 END DESC,
                         revision_no DESC, created_at DESC LIMIT 1""",
            (organization_id, provider, local_root_id),
        ).fetchone()
        if row is None:
            return None
        return {
            "organizationId": organization_id, "provider": provider,
            "kind": "NOTICE", "revisionId": row[0],
            "revisionNumber": row[1], "normalizedSnapshot": json.loads(row[2]),
            "digest": row[3], "disposition": row[4],
            "idempotencyKey": row[5], "localRootId": local_root_id,
            "localSnapshotId": row[6], "matchMethod": row[7],
        }

    def resolve_notice_target(
        self, organization_id, provider, notice_no, relationship,
        target_root_id=None,
    ):
        relationship = relationship or {}
        family_no = str(relationship.get("planNo") or "").strip().upper()
        if not family_no and target_root_id:
            row = self.cursor.execute(
                """SELECT upper(plan.ma_ke_hoach)
                     FROM goi_thau AS package
                     JOIN ke_hoach_lcnt AS plan
                       ON plan.organization_id = package.organization_id
                      AND plan.id = package.ke_hoach_id
                    WHERE package.organization_id = ?
                      AND COALESCE(NULLIF(package.id_goc, ''), package.id) = ?
                      AND package.is_latest = 1 AND plan.is_latest = 1
                    LIMIT 2""",
                (organization_id, str(target_root_id)),
            ).fetchall()
            family_no = str(row[0][0]) if len(row) == 1 else ""
        if not family_no:
            rows = self.cursor.execute(
                """SELECT DISTINCT upper(plan.ma_ke_hoach)
                     FROM goi_thau AS package
                     JOIN ke_hoach_lcnt AS plan
                       ON plan.organization_id = package.organization_id
                      AND plan.id = package.ke_hoach_id
                LEFT JOIN procurement_source_binding AS binding
                       ON binding.organization_id = package.organization_id
                      AND binding.provider = ?
                      AND binding.local_root_id =
                          COALESCE(NULLIF(package.id_goc, ''), package.id)
                    WHERE package.organization_id = ?
                      AND package.is_latest = 1 AND plan.is_latest = 1
                      AND (
                        upper(COALESCE(package.ma_goi_thau, '')) = ?
                        OR upper(COALESCE(binding.notify_no, '')) = ?
                      )
                    LIMIT 2""",
                (provider, organization_id, notice_no, notice_no),
            ).fetchall()
            family_no = str(rows[0][0]) if len(rows) == 1 else ""
        if not family_no:
            return None
        packages = self.load_family(
            organization_id, provider, family_no
        ).get("packages") or []
        direct = [
            row for row in packages
            if str(row.get("noticeNo") or "").strip().upper() == notice_no
            or str((row.get("binding") or {}).get("noticeNo") or "").strip().upper()
            == notice_no
        ]
        if len(direct) == 1:
            return direct[0]
        if len(direct) > 1:
            return None
        if target_root_id:
            selected = [
                row for row in packages
                if str(row.get("rootId") or row["id"]) == str(target_root_id)
            ]
            return selected[0] if len(selected) == 1 else None
        id_detail = str(relationship.get("planDetailRevisionId") or "").strip()
        stable_id = str(relationship.get("stablePackageId") or "").strip()
        symbol = str(relationship.get("symbol") or "").strip().casefold()
        candidates = [
            row for row in packages
            if (
                id_detail
                and str((row.get("binding") or {}).get("idDetail") or "")
                == id_detail
            ) or (
                stable_id
                and str(row.get("stableExternalId") or "") == stable_id
            ) or (
                symbol and str(row.get("symbol") or "").strip().casefold() == symbol
            )
        ]
        return candidates[0] if len(candidates) == 1 else None

    def latest_applied_revision(self, organization_id, provider, family_no):
        row = self.cursor.execute(
            """SELECT revision_no
                 FROM procurement_source_revision
                WHERE organization_id = ? AND provider = ?
                  AND entity_kind = 'PLAN' AND family_key = ?
                  AND disposition = 'APPLIED'
                ORDER BY CASE WHEN revision_no ~ '^[0-9]+$'
                              THEN revision_no::BIGINT ELSE -1 END DESC,
                         revision_no DESC LIMIT 1""",
            (organization_id, provider, family_no),
        ).fetchone()
        return None if row is None else {"revisionNumber": row[0]}

    def _active_member(self, organization_id, user_id):
        row = self.cursor.execute(
            """SELECT 1 FROM thanh_vien_to_chuc AS membership
                 JOIN tai_khoan AS account ON account.id = membership.user_id
                WHERE membership.organization_id = ? AND membership.user_id = ?
                  AND COALESCE(account.trang_thai, 'active') = 'active'""",
            (organization_id, user_id),
        ).fetchone()
        return row is not None

    def _insert_plan(self, organization_id, row):
        self.cursor.execute(
            """UPDATE ke_hoach_lcnt SET is_latest = 0,
                      row_version = row_version + 1, updated_at = CURRENT_TIMESTAMP
                WHERE organization_id = ? AND upper(ma_ke_hoach) = ?
                  AND is_latest = 1""",
            (organization_id, row["familyNo"]),
        )
        self.cursor.execute(
            """INSERT INTO ke_hoach_lcnt (
                   id, organization_id, owner_type, id_goc, ma_ke_hoach,
                   phien_ban, is_latest, ten_ke_hoach, ten_du_an_du_toan,
                   loai_hinh_mua_sam, chu_dau_tu_id, ngay_phe_duyet,
                   quyet_dinh_phe_duyet, tong_muc_dau_tu, nguon_von,
                   thoi_gian_dang_tai, row_version)
               VALUES (?, ?, 'organization', ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)""",
            (
                row["id"], organization_id,
                None if row["rootId"] == row["id"] else row["rootId"],
                row["familyNo"], row["localVersion"], row.get("name") or row["familyNo"],
                row.get("projectName") or row.get("name") or row["familyNo"],
                row.get("planType") or "Dự toán mua sắm", row.get("investorId"),
                row.get("approvalDecisionDate"), row.get("approvalDecisionNo"),
                row.get("totalAmountVnd"), row.get("capitalDetail"), row.get("publishedAt"),
            ),
        )

    def _insert_package(self, organization_id, row):
        fields = row.get("sourceFields") or {}
        notice_fields = row.get("noticeFields") or fields.get("noticeFields") or {}
        exact_tbmt = bool(
            row.get("noticeNo") and row.get("noticeKind") == "TBMT"
            and row.get("noticeRevisionId") and row.get("noticeVersion") is not None
        )
        mapped_status = str(row.get("initialStatus") or "UNKNOWN").upper()
        if mapped_status not in {"UNKNOWN", "PREPARING", "INVITED"}:
            mapped_status = "UNKNOWN"
        if not exact_tbmt and mapped_status == "INVITED":
            mapped_status = "UNKNOWN"
        self.cursor.execute(
            """INSERT INTO goi_thau (
                   id, organization_id, owner_type, id_goc, ma_goi_thau,
                   phien_ban, is_latest, ke_hoach_id, ten_goi_thau,
                   gia_goi_thau, loai_hop_dong, hinh_thuc_lua_chon,
                   phuong_thuc_lua_chon, qua_mang, trong_nuoc_quoc_te,
                   thoi_gian_thuc_hien, nguon_von, linh_vuc,
                   thoi_gian_to_chuc, thoi_gian_bat_dau_to_chuc,
                   phuong_phap_danh_gia, thoi_gian_dong_thau,
                   thoi_gian_mo_thau, trang_thai, row_version)
               VALUES (?, ?, 'organization', ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?,
                       ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)""",
            (
                row["id"], organization_id,
                None if row["rootId"] == row["id"] else row["rootId"],
                row.get("noticeNo"), row["localVersion"], row["planSnapshotId"],
                row.get("name") or fields.get("name"), fields.get("priceVnd"),
                fields.get("contractType"), fields.get("selectionForm"),
                fields.get("selectionMode"), fields.get("onlineMode") or "Qua mạng",
                fields.get("domesticOrInternational") or "Trong nước",
                fields.get("executionPeriod"), fields.get("capitalDetail"),
                fields.get("field"), fields.get("selectionDuration"),
                fields.get("selectionStart"), fields.get("evaluationMethod"),
                normalize_datetime_value(notice_fields.get("bidClosingAt")),
                normalize_datetime_value(notice_fields.get("bidOpeningAt")),
                mapped_status,
            ),
        )

    def _apply_notice_enrichment(self, organization_id, row):
        notice_fields = row.get("noticeFields") or {}
        exact_tbmt = bool(
            row.get("noticeNo") and row.get("noticeKind") == "TBMT"
            and row.get("noticeRevisionId") and row.get("noticeVersion") is not None
        )
        if not exact_tbmt:
            return
        status = str(notice_fields.get("status") or "").upper()
        closing_at = normalize_datetime_value(notice_fields.get("bidClosingAt"))
        opening_at = normalize_datetime_value(notice_fields.get("bidOpeningAt"))
        self.cursor.execute(
            """UPDATE goi_thau
                  SET thoi_gian_dong_thau = COALESCE(?, thoi_gian_dong_thau),
                      thoi_gian_mo_thau = COALESCE(?, thoi_gian_mo_thau),
                      trang_thai = CASE
                          WHEN ? = 'PUBLISHED' AND trang_thai = 'PREPARING'
                          THEN 'INVITED' ELSE trang_thai END
                WHERE organization_id = ? AND id = ?""",
            (closing_at, opening_at, status, organization_id, row["id"]),
        )

    def _build_inherited_package_snapshot(self, organization_id, row):
        source_id = row.get("cloneFromSnapshotId")
        if not source_id:
            return None
        state = AggregateVersionRepository(self.cursor).load_package_state(
            organization_id, source_id
        )
        source = next((
            package for package in state.get("goithau", [])
            if str(package.get("id")) == str(source_id)
        ), None)
        if source is None:
            raise LookupError("PROCUREMENT_MATCH_DECISION_INVALID")
        counter = 0

        def create_id(kind):
            nonlocal counter
            counter += 1
            return _stable_id("procurement-clone", row["id"], kind, counter)

        return snapshot_package_aggregate(
            state,
            source,
            target_package_id=row["id"],
            target_plan_id=row["planSnapshotId"],
            package_version=row["localVersion"],
            timestamp=datetime.now(timezone.utc).isoformat(),
            create_id=create_id,
        )

    def _inherit_package_base(self, organization_id, target_id, source_id):
        source_owned_columns = {
            "ma_goi_thau", "ten_goi_thau", "gia_goi_thau", "loai_hop_dong",
            "hinh_thuc_lua_chon", "phuong_thuc_lua_chon", "qua_mang",
            "trong_nuoc_quoc_te", "thoi_gian_thuc_hien", "nguon_von",
            "linh_vuc", "thoi_gian_to_chuc", "thoi_gian_bat_dau_to_chuc",
            "phuong_phap_danh_gia",
        }
        protected = {
            "id", "organization_id", "owner_type", "id_goc", "phien_ban",
            "is_latest", "archived_at", "ke_hoach_id", "row_version",
            "sync_version", "updated_at",
            *source_owned_columns,
        }
        inherited_columns = [
            column for column in SCHEMA_DINH_NGHIA["goi_thau"]["columns"]
            if column not in protected
        ]
        assignments = ", ".join(
            f"{column} = source.{column}" for column in inherited_columns
        )
        self.cursor.execute(
            f"""UPDATE goi_thau AS target SET {assignments}
                  FROM goi_thau AS source
                 WHERE target.organization_id = ? AND target.id = ?
                   AND source.organization_id = target.organization_id
                   AND source.id = ?""",  # noqa: S608 - schema-owned columns only.
            (organization_id, target_id, source_id),
        )
        if self.cursor.rowcount != 1:
            raise LookupError("PROCUREMENT_MATCH_DECISION_INVALID")

    def _insert_inherited_relations(
        self, organization_id, actor_user_id, package_id, inherited
    ):
        current_time = datetime.now(timezone.utc).isoformat()
        actor = SyncActorContext(
            request=None, role="employee", user_id=actor_user_id,
            organization_id=organization_id, owner_type="organization",
            can_upload_workspace_assets=False,
        )
        transaction = SyncTransactionContext(
            connection=None, cursor=self.cursor, actor=actor,
            owner_type="organization", current_time=current_time,
        )
        tracker = _CloneMutationTracker()
        serializer = SyncRecordSerializer(
            transaction,
            sync_version=0,
            newly_written_images=set(),
            mutation_tracker=tracker,
            clean_record_id=clean_sync_record_id,
            schema_definition=SCHEMA_DINH_NGHIA,
            money_columns=MONEY_COLUMNS,
            field_name_for_column=json_key_for_column,
            payload_value_for_column=get_payload_value,
        )
        relation_specs = (
            ("goithauhanghoa", "goi_thau_hang_hoa"),
            ("thongtinmothau", "thong_tin_mo_thau"),
            ("hanghoaduthaunhathau", "hang_hoa_du_thau_nha_thau"),
        )
        for payload_key, table_name in relation_specs:
            for item in inherited.get(payload_key, []):
                db_row = serializer.serialize(table_name, item)
                columns = ", ".join(db_row)
                placeholders = ", ".join("?" for _ in db_row)
                self.cursor.execute(
                    f"INSERT INTO {table_name} ({columns}) VALUES ({placeholders})",  # noqa: S608 - fixed relation registry.
                    tuple(db_row.values()),
                )
                save_child_payloads(
                    self.cursor, table_name, item, organization_id,
                    "organization", 0, current_time, actor_user_id,
                )
        for assignment in inherited.get("assignments", []):
            self._insert_assignment(
                organization_id, "goithau", package_id,
                assignment.get("empId") or assignment.get("idNhanVien"),
            )

    def _insert_assignment(self, organization_id, target_type, target_id, user_id):
        if not user_id or not self._active_member(organization_id, user_id):
            return
        assignment_id = _stable_id("procurement-assignment", target_id, user_id)
        self.cursor.execute(
            """INSERT INTO phan_cong_nhan_su
                   (id, organization_id, owner_type, id_nhan_vien,
                    id_muc_tieu, loai_doi_tuong)
               VALUES (?, ?, 'organization', ?, ?, ?)
               ON CONFLICT DO NOTHING""",
            (assignment_id, organization_id, user_id, target_id, target_type),
        )

    def persist_revision(self, result):
        evidence = result["provenance"]
        organization_id = evidence["organizationId"]
        for plan in result.get("createdPlans", []):
            self._insert_plan(organization_id, plan)
            self._insert_assignment(
                organization_id, "kehoach", plan["id"], evidence.get("actorUserId")
            )
        for package in result.get("createdPackages", []):
            superseded_id = package.get("supersedeSnapshotId")
            if superseded_id:
                self.cursor.execute(
                    """UPDATE goi_thau
                          SET is_latest = 0, row_version = row_version + 1,
                              updated_at = CURRENT_TIMESTAMP
                        WHERE organization_id = ? AND id = ? AND is_latest = 1""",
                    (organization_id, superseded_id),
                )
                if self.cursor.rowcount != 1:
                    raise ImportConflict("PROCUREMENT_PREVIEW_STALE")
            inherited = self._build_inherited_package_snapshot(
                organization_id, package
            )
            self._insert_package(organization_id, package)
            if inherited:
                self._inherit_package_base(
                    organization_id, package["id"],
                    package.get("cloneFromSnapshotId"),
                )
                save_child_payloads(
                    self.cursor, "goi_thau", inherited["packageRecord"],
                    organization_id, "organization", 0,
                    datetime.now(timezone.utc).isoformat(),
                    evidence.get("actorUserId"),
                )
                self._insert_inherited_relations(
                    organization_id, evidence.get("actorUserId"),
                    package["id"], inherited,
                )
            self._apply_notice_enrichment(organization_id, package)
            self._insert_assignment(
                organization_id, "goithau", package["id"],
                package.get("assigneeUserId") or evidence.get("actorUserId"),
            )
        revision_row_id = _stable_id(
            organization_id, evidence["provider"], evidence["kind"], evidence["revisionId"]
        )
        self.cursor.execute(
            """INSERT INTO procurement_source_revision (
                   id, organization_id, provider, entity_kind, family_key,
                   revision_uuid, revision_no, canonical_snapshot_json, digest,
                   schema_version, disposition, applied_at, operation_id,
                   idempotency_key,
                   public_url, local_entity_type, local_root_id,
                   local_snapshot_id, match_method, confirmed_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                       CASE WHEN ? = 'APPLIED' THEN CURRENT_TIMESTAMP ELSE NULL END,
                       ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT DO NOTHING""",
            (
                revision_row_id, organization_id, evidence["provider"], evidence["kind"],
                evidence["familyNo"], evidence["revisionId"], evidence["revisionNumber"],
                _json(evidence["normalizedSnapshot"]), evidence["digest"],
                evidence["schemaVersion"], evidence["disposition"],
                evidence["disposition"], evidence.get("operationId"),
                evidence["idempotencyKey"],
                evidence.get("publicUrl"), evidence.get("localEntityType"),
                evidence.get("localRootId"), evidence.get("localSnapshotId"),
                evidence.get("matchMethod"), evidence.get("confirmedBy"),
            ),
        )
        for package in (
            result.get("createdPackages", [])
            if evidence.get("kind") != "NOTICE" else []
        ):
            notice_no = str(package.get("noticeNo") or "").strip().upper()
            notice_revision_id = str(
                package.get("noticeRevisionId") or ""
            ).strip()
            notice_version = package.get("noticeVersion")
            if not notice_no or not notice_revision_id or notice_version is None:
                continue
            notice_snapshot = {
                "noticeLink": {
                    "state": "LINKED", "noticeNo": notice_no,
                    "kind": package.get("noticeKind") or "UNKNOWN",
                    "noticeRevisionId": notice_revision_id,
                    "noticeVersion": str(notice_version),
                },
                "noticeFields": deepcopy(package.get("noticeFields") or {}),
            }
            self.cursor.execute(
                """INSERT INTO procurement_source_revision (
                       id, organization_id, provider, entity_kind, family_key,
                       revision_uuid, revision_no, parent_plan_revision_uuid,
                       canonical_snapshot_json, digest, schema_version,
                       disposition, applied_at, local_entity_type,
                       local_root_id, local_snapshot_id, match_method,
                       operation_id, idempotency_key, public_url)
                   VALUES (?, ?, ?, 'NOTICE', ?, ?, ?, ?, ?, ?, ?, 'APPLIED',
                           CURRENT_TIMESTAMP, 'goithau', ?, ?,
                           'LINKED_NOTICE_EXACT', ?, ?, ?)
                   ON CONFLICT DO NOTHING""",
                (
                    _stable_id(
                        organization_id, evidence["provider"], "NOTICE",
                        notice_revision_id,
                    ),
                    organization_id, evidence["provider"], notice_no,
                    notice_revision_id, str(notice_version), evidence["revisionId"],
                    _json(notice_snapshot), canonical_digest(notice_snapshot),
                    evidence["schemaVersion"], package["rootId"], package["id"],
                    evidence.get("operationId"),
                    f"{evidence['idempotencyKey']}:notice:{notice_revision_id}",
                    (package.get("noticeFields") or {}).get("publicUrl"),
                ),
            )
        for binding in result.get("bindings", []):
            package = next(
                row for row in result["createdPackages"]
                if row["id"] == binding["localSnapshotId"]
            )
            canonical_fields = (
                package.get("canonicalSourceFields")
                or package.get("sourceFields") or {}
            )
            self.cursor.execute(
                """INSERT INTO procurement_source_binding (
                       id, organization_id, provider, family_key,
                       plan_revision_uuid, id_detail, stable_external_id,
                       symbol, notify_no,
                       local_entity_type, local_root_id, local_snapshot_id,
                       match_method, confirmed_by, canonical_fields_json, digest)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'goithau', ?, ?, ?, ?, ?, ?)
                   ON CONFLICT DO NOTHING""",
                (
                    _stable_id(
                        binding["observationKey"], organization_id,
                        binding["localSnapshotId"],
                    ),
                    organization_id, binding["provider"], binding["familyNo"],
                    binding["planRevisionId"], binding["idDetail"],
                    binding.get("stableExternalId"), binding.get("symbol"),
                    binding.get("noticeNo"),
                    binding["localRootId"], binding["localSnapshotId"],
                    binding["matchMethod"], binding.get("confirmedBy"),
                    _json(canonical_fields),
                    canonical_digest(canonical_fields),
                ),
            )

    def create_operation(self, operation):
        self.cursor.execute(
            """INSERT INTO procurement_import_operation (
                   id, organization_id, provider, family_key, mode, status,
                   next_revision_index, total_revisions, bundle_digest,
                   revision_results_json, idempotency_key, request_hash,
                   actor_user_id)
               VALUES (?, ?, ?, ?, 'ALL', 'PENDING', 0, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (organization_id, provider, idempotency_key) DO NOTHING""",
            (
                operation["id"], operation["organizationId"], operation["provider"],
                operation["familyNo"], operation["totalRevisions"],
                operation["bundleDigest"], _json(operation.get("revisionResults", [])),
                operation["idempotencyKey"], operation["requestHash"],
                operation["actorUserId"],
            ),
        )
        stored = self.get_operation(operation["organizationId"], operation["id"])
        if stored is None:
            raise RuntimeError("PROCUREMENT_OPERATION_NOT_FOUND")
        if stored.get("requestHash") != operation["requestHash"]:
            raise ImportConflict("PROCUREMENT_IDEMPOTENCY_CONFLICT")
        return stored

    def update_operation(self, organization_id, operation_id, *, cursor, results, status):
        self.cursor.execute(
            """UPDATE procurement_import_operation
                  SET next_revision_index = ?, revision_results_json = ?, status = ?,
                      updated_at = CURRENT_TIMESTAMP
                WHERE organization_id = ? AND id = ?
                  AND next_revision_index <= ?""",
            (cursor, _json(results), status, organization_id, operation_id, cursor),
        )

    def get_operation(self, organization_id, operation_id):
        row = self.cursor.execute(
            """SELECT id, provider, family_key, mode, status,
                      next_revision_index, total_revisions, bundle_digest,
                      revision_results_json, idempotency_key, actor_user_id,
                      request_hash
                 FROM procurement_import_operation
                WHERE organization_id = ? AND id = ?""",
            (organization_id, operation_id),
        ).fetchone()
        if row is None:
            return None
        return {
            "operationId": row[0], "provider": row[1], "familyNo": row[2],
            "mode": row[3], "status": row[4], "nextRevisionIndex": int(row[5]),
            "totalRevisions": int(row[6]), "bundleDigest": row[7],
            "revisionResults": json.loads(row[8]), "idempotencyKey": row[9],
            "actorUserId": row[10], "requestHash": row[11],
        }
