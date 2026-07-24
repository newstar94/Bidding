"""Transactional query/command service for lot-scoped selection batches."""

from __future__ import annotations

from collections import defaultdict
from hashlib import sha256
import json

from backend.db.id_utils import generate_record_id
from backend.shared.date_utils import vietnam_now_sql
from backend.sync.mapper import save_child_payloads
from backend.sync.repository import next_sync_version
from backend.lot_selection_lifecycle import (
    ApprovalMode,
    DependencyGroup,
    DependencyKind,
    LotOutcome,
    LotProgress,
    LotStage,
    PackageLifecycleContext,
    ProcedureKind,
    assess_batch_start,
    assess_partial_result_publication,
    project_package_status,
)


POLICY_VERSION = 1


class LotLifecycleNotFoundError(LookupError):
    pass


class LotLifecycleInputError(ValueError):
    pass


def _procedure_kind(value) -> ProcedureKind:
    normalized = " ".join(str(value or "").strip().casefold().split())
    if "hai túi" in normalized or "2 túi" in normalized or "1g2t" in normalized:
        return ProcedureKind.ONE_STAGE_TWO_ENVELOPE
    return ProcedureKind.ONE_STAGE_ONE_ENVELOPE


def _package_row(cursor, organization_id, package_id, *, for_update=False):
    suffix = " FOR UPDATE" if for_update else ""
    row = cursor.execute(
        """SELECT id, owner_type, phan_lo, phuong_thuc_lua_chon, row_version
           FROM goi_thau
           WHERE organization_id = ? AND id = ? AND archived_at IS NULL"""
        + suffix,
        (organization_id, package_id),
    ).fetchone()
    if not row:
        raise LotLifecycleNotFoundError("Không tìm thấy gói thầu.")
    result = dict(row)
    if str(result.get("phan_lo") or "").strip() != "Có":
        raise LotLifecycleInputError("Chỉ gói thầu có phần lô mới dùng vòng đời theo lô.")
    return result


def _lot_progress(cursor, organization_id, package_id):
    rows = cursor.execute(
        """SELECT id, ma_phan_lo, ten_phan_lo, sort_order
           FROM goi_thau_phan_lo
           WHERE organization_id = ? AND goi_thau_id = ?
             AND archived_at IS NULL
           ORDER BY sort_order, id""",
        (organization_id, package_id),
    ).fetchall()
    latest_details = {}
    detail_rows = cursor.execute(
        """SELECT detail.lot_id, detail.batch_id, detail.current_stage,
                  detail.outcome, detail.lifecycle_revision, detail.is_active,
                  batch.sequence_no
           FROM dot_xu_ly_phan_lo_chi_tiet AS detail
           JOIN dot_xu_ly_phan_lo AS batch
             ON batch.organization_id = detail.organization_id
            AND batch.id = detail.batch_id
           WHERE detail.organization_id = ? AND batch.goi_thau_id = ?
           ORDER BY detail.lot_id, batch.sequence_no DESC""",
        (organization_id, package_id),
    ).fetchall()
    for raw in detail_rows:
        item = dict(raw)
        latest_details.setdefault(item["lot_id"], item)
    result = {}
    display = {}
    for raw in rows:
        row = dict(raw)
        detail = latest_details.get(row["id"], {})
        stage = LotStage(detail.get("current_stage") or LotStage.NOT_STARTED.value)
        outcome_value = detail.get("outcome")
        result[row["id"]] = LotProgress(
            lot_id=row["id"],
            stage=stage,
            outcome=LotOutcome(outcome_value) if outcome_value else None,
            active_batch_id=detail.get("batch_id") if detail.get("is_active") else None,
        )
        row["lifecycle_revision"] = detail.get("lifecycle_revision") or 0
        display[row["id"]] = row
    return result, display


def _dependency_groups(cursor, organization_id, package_id):
    rows = cursor.execute(
        """SELECT dependency.id, dependency.dependency_kind,
                  dependency.reason, dependency.must_move_together,
                  member.lot_id
           FROM nhom_phu_thuoc_phan_lo AS dependency
           JOIN nhom_phu_thuoc_phan_lo_thanh_vien AS member
             ON member.organization_id = dependency.organization_id
            AND member.dependency_group_id = dependency.id
           WHERE dependency.organization_id = ?
             AND dependency.goi_thau_id = ?
             AND dependency.is_active = 1
           ORDER BY dependency.id, member.lot_id""",
        (organization_id, package_id),
    ).fetchall()
    grouped = defaultdict(list)
    metadata = {}
    for raw in rows:
        row = dict(raw)
        grouped[row["id"]].append(row["lot_id"])
        metadata[row["id"]] = row
    return tuple(
        DependencyGroup(
            group_id=group_id,
            kind=DependencyKind(metadata[group_id]["dependency_kind"]),
            lot_ids=frozenset(lot_ids),
            reason=metadata[group_id]["reason"],
            must_move_together=bool(metadata[group_id]["must_move_together"]),
        )
        for group_id, lot_ids in grouped.items()
    )


def _context(cursor, organization_id, package_id, approval_mode=None):
    package = _package_row(cursor, organization_id, package_id)
    lots, display = _lot_progress(cursor, organization_id, package_id)
    mode = approval_mode or ApprovalMode.CONSOLIDATED
    return (
        PackageLifecycleContext(
            package_id=package_id,
            procedure_kind=_procedure_kind(package.get("phuong_thuc_lua_chon")),
            approval_mode=mode,
            lots=lots,
            dependency_groups=_dependency_groups(cursor, organization_id, package_id),
        ),
        display,
    )


def query_lifecycle(cursor, organization_id, package_id):
    context, display = _context(cursor, organization_id, package_id)
    batches = [
        dict(row)
        for row in cursor.execute(
            """SELECT id, sequence_no, procedure_kind, approval_mode, status,
                      policy_version, staged_approval_authorized,
                      authorization_basis, created_by_id, closed_at,
                      row_version, created_at, updated_at
               FROM dot_xu_ly_phan_lo
               WHERE organization_id = ? AND goi_thau_id = ?
               ORDER BY sequence_no, id""",
            (organization_id, package_id),
        ).fetchall()
    ]
    batch_lots = defaultdict(list)
    if batches:
        batch_ids = [batch["id"] for batch in batches]
        placeholders = ", ".join("?" for _ in batch_ids)
        for raw in cursor.execute(
            f"""SELECT batch_id, lot_id, current_stage, outcome,
                       lifecycle_revision, is_active, row_version
                FROM dot_xu_ly_phan_lo_chi_tiet
                WHERE organization_id = ? AND batch_id IN ({placeholders})
                ORDER BY batch_id, created_at, id""",
            (organization_id, *batch_ids),
        ).fetchall():
            row = dict(raw)
            batch_lots[row.pop("batch_id")].append(row)
    for batch in batches:
        batch["lots"] = batch_lots.get(batch["id"], [])

    lot_items = []
    for lot_id, progress in context.lots.items():
        source = display[lot_id]
        lot_items.append(
            {
                "id": lot_id,
                "code": source.get("ma_phan_lo") or "",
                "name": source.get("ten_phan_lo") or "",
                "sortOrder": source.get("sort_order") or 0,
                "stage": progress.stage.value,
                "outcome": progress.outcome.value if progress.outcome else None,
                "activeBatchId": progress.active_batch_id,
                "revision": source.get("lifecycle_revision") or 0,
            }
        )
    status = project_package_status(context.lots.values())
    completed = sum(lot.is_completed for lot in context.lots.values())
    return {
        "packageId": package_id,
        "procedureKind": context.procedure_kind.value,
        "packageStatus": status.value,
        "counts": {
            "totalLots": len(context.lots),
            "completedLots": completed,
            "pendingLots": len(context.lots) - completed,
        },
        "lots": lot_items,
        "batches": batches,
        "policyVersion": POLICY_VERSION,
    }


def create_batch(
    cursor,
    organization_id,
    package_id,
    lot_ids,
    *,
    approval_mode,
    staged_approval_authorized=False,
    authorization_basis="",
    actor_user_id=None,
):
    package = _package_row(cursor, organization_id, package_id, for_update=True)
    try:
        mode = ApprovalMode(approval_mode)
    except ValueError as exc:
        raise LotLifecycleInputError("Chế độ phê duyệt không hợp lệ.") from exc
    if staged_approval_authorized and not str(authorization_basis or "").strip():
        raise LotLifecycleInputError(
            "Phê duyệt theo đợt phải lưu căn cứ nghiệp vụ/pháp lý."
        )

    context, _display = _context(cursor, organization_id, package_id, mode)
    decision = assess_batch_start(context, lot_ids)
    decision.require_allowed()

    sequence_row = cursor.execute(
        """SELECT COALESCE(MAX(sequence_no), 0) + 1
           FROM dot_xu_ly_phan_lo
           WHERE organization_id = ? AND goi_thau_id = ?""",
        (organization_id, package_id),
    ).fetchone()
    sequence_no = int(sequence_row[0])
    batch_id = generate_record_id("dot_xu_ly_phan_lo")
    procedure = _procedure_kind(package.get("phuong_thuc_lua_chon"))
    initial_stage = (
        LotStage.TECHNICAL_DRAFT
        if procedure == ProcedureKind.ONE_STAGE_TWO_ENVELOPE
        else LotStage.EVALUATION_DRAFT
    )
    cursor.execute(
        """INSERT INTO dot_xu_ly_phan_lo (
               id, organization_id, owner_type, goi_thau_id, sequence_no,
               procedure_kind, approval_mode, status, policy_version,
               staged_approval_authorized, authorization_basis, created_by_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)""",
        (
            batch_id,
            organization_id,
            package["owner_type"],
            package_id,
            sequence_no,
            procedure.value,
            mode.value,
            POLICY_VERSION,
            1 if staged_approval_authorized else 0,
            str(authorization_basis or "").strip() or None,
            actor_user_id,
        ),
    )
    rows = [
        (
            generate_record_id("dot_xu_ly_phan_lo_chi_tiet"),
            organization_id,
            package["owner_type"],
            batch_id,
            lot_id,
            initial_stage.value,
        )
        for lot_id in sorted(decision.selected_lot_ids)
    ]
    cursor.executemany(
        """INSERT INTO dot_xu_ly_phan_lo_chi_tiet (
               id, organization_id, owner_type, batch_id, lot_id, current_stage
           ) VALUES (?, ?, ?, ?, ?, ?)""",
        rows,
    )
    return {
        "id": batch_id,
        "sequenceNo": sequence_no,
        "procedureKind": procedure.value,
        "approvalMode": mode.value,
        "status": "ACTIVE",
        "initialStage": initial_stage.value,
        "lotIds": sorted(decision.selected_lot_ids),
        "policyVersion": POLICY_VERSION,
    }


def finalize_batch(
    cursor,
    organization_id,
    package_id,
    batch_id,
    outcomes,
    *,
    actor_user_id=None,
):
    """Close one official evaluation round and project the package state."""

    _package_row(cursor, organization_id, package_id, for_update=True)
    batch_row = cursor.execute(
        """SELECT id, approval_mode, status
           FROM dot_xu_ly_phan_lo
           WHERE organization_id = ? AND goi_thau_id = ? AND id = ?""",
        (organization_id, package_id, batch_id),
    ).fetchone()
    if not batch_row:
        raise LotLifecycleNotFoundError("Không tìm thấy đợt đánh giá phần lô.")
    batch = dict(batch_row)
    if batch["status"] == "CLOSED":
        return query_lifecycle(cursor, organization_id, package_id)
    if batch["status"] != "ACTIVE":
        raise LotLifecycleInputError("Chỉ có thể phê duyệt kết quả của đợt đang xử lý.")

    detail_rows = [
        dict(row)
        for row in cursor.execute(
            """SELECT lot_id
               FROM dot_xu_ly_phan_lo_chi_tiet
               WHERE organization_id = ? AND batch_id = ? AND is_active = 1
               ORDER BY lot_id""",
            (organization_id, batch_id),
        ).fetchall()
    ]
    batch_lot_ids = [row["lot_id"] for row in detail_rows]
    if not batch_lot_ids:
        raise LotLifecycleInputError("Đợt đánh giá không có phần lô đang xử lý.")
    if set(outcomes or {}) != set(batch_lot_ids):
        raise LotLifecycleInputError(
            "Kết quả chính thức phải xác định kết quả cho từng phần lô trong đợt."
        )

    mode = ApprovalMode(batch["approval_mode"])
    context, _display = _context(cursor, organization_id, package_id, mode)
    publication = assess_partial_result_publication(
        context,
        batch_lot_ids,
        current_batch_id=batch_id,
    )
    publication.require_allowed()

    normalized_outcomes = {}
    for lot_id in batch_lot_ids:
        try:
            normalized_outcomes[lot_id] = LotOutcome(outcomes[lot_id])
        except (KeyError, ValueError) as exc:
            raise LotLifecycleInputError(
                f"Kết quả của phần lô {lot_id} không hợp lệ."
            ) from exc

    for lot_id, outcome in normalized_outcomes.items():
        cursor.execute(
            """UPDATE dot_xu_ly_phan_lo_chi_tiet
               SET current_stage = ?, outcome = ?, is_active = 0,
                   lifecycle_revision = lifecycle_revision + 1,
                   updated_at = CURRENT_TIMESTAMP
               WHERE organization_id = ? AND batch_id = ? AND lot_id = ?
                 AND is_active = 1""",
            (
                LotStage.RESULT_APPROVED.value,
                outcome.value,
                organization_id,
                batch_id,
                lot_id,
            ),
        )
    cursor.execute(
        """UPDATE dot_xu_ly_phan_lo
           SET status = 'CLOSED', closed_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE organization_id = ? AND goi_thau_id = ? AND id = ?""",
        (organization_id, package_id, batch_id),
    )
    lifecycle = query_lifecycle(cursor, organization_id, package_id)
    lifecycle["finalizedBatchId"] = batch_id
    lifecycle["finalizedById"] = actor_user_id
    return lifecycle


def finalize_batch_award(
    cursor,
    organization_id,
    package_id,
    batch_id,
    outcomes,
    package_award,
    *,
    actor_user_id=None,
):
    """Finalize a lot batch and persist its official package result atomically."""

    if not isinstance(package_award, dict):
        raise LotLifecycleInputError("Thiếu dữ liệu kết quả chính thức của gói thầu.")
    expected_version = package_award.get("expectedVersion")
    if (
        not isinstance(expected_version, int)
        or isinstance(expected_version, bool)
        or expected_version < 1
    ):
        raise LotLifecycleInputError("Phiên bản gói thầu không hợp lệ.")
    decision_number = str(
        package_award.get("decisionNumber") or ""
    ).strip()
    decision_date = str(package_award.get("decisionDate") or "").strip()
    if not decision_number or not decision_date:
        raise LotLifecycleInputError(
            "Kết quả chính thức phải có số và ngày quyết định."
        )
    metadata = package_award.get("metadata")
    if not isinstance(metadata, dict):
        raise LotLifecycleInputError("Dữ liệu đánh giá gói thầu không hợp lệ.")
    raw_lot_results = package_award.get("lotResults")
    if not isinstance(raw_lot_results, list):
        raise LotLifecycleInputError("Danh sách kết quả phần lô không hợp lệ.")

    package = _package_row(
        cursor,
        organization_id,
        package_id,
        for_update=True,
    )
    current_version = int(package.get("row_version") or 1)
    if current_version != expected_version:
        raise LotLifecycleInputError(
            "Gói thầu đã được thay đổi bởi một phiên làm việc khác."
        )

    lot_results = {}
    for raw_result in raw_lot_results:
        if not isinstance(raw_result, dict):
            raise LotLifecycleInputError("Kết quả phần lô không hợp lệ.")
        lot_id = str(raw_result.get("lotId") or "").strip()
        if not lot_id or lot_id in lot_results:
            raise LotLifecycleInputError(
                "Mỗi phần lô phải có đúng một kết quả chính thức."
            )
        winner_id = str(raw_result.get("winnerId") or "").strip()
        award_price = raw_result.get("awardPrice", 0)
        if (
            not isinstance(award_price, int)
            or isinstance(award_price, bool)
            or award_price < 0
        ):
            raise LotLifecycleInputError("Giá trúng thầu phần lô không hợp lệ.")
        lot_results[lot_id] = {
            "winner_id": winner_id or None,
            "award_price": award_price,
            "package_duration": str(
                raw_result.get("packageDuration") or ""
            ).strip(),
            "contract_duration": str(
                raw_result.get("contractDuration") or ""
            ).strip(),
        }
    if set(lot_results) != set(outcomes or {}):
        raise LotLifecycleInputError(
            "Kết quả lưu gói thầu phải khớp chính xác phạm vi phần lô của đợt."
        )
    for lot_id, outcome_value in outcomes.items():
        try:
            outcome = LotOutcome(outcome_value)
        except ValueError as exc:
            raise LotLifecycleInputError(
                f"Kết quả của phần lô {lot_id} không hợp lệ."
            ) from exc
        winner_id = lot_results[lot_id]["winner_id"]
        if outcome == LotOutcome.AWARDED and not winner_id:
            raise LotLifecycleInputError(
                "Phần lô trúng thầu phải xác định nhà thầu trúng thầu."
            )
        if outcome != LotOutcome.AWARDED and winner_id:
            raise LotLifecycleInputError(
                "Phần lô không trúng thầu không được gắn nhà thầu trúng."
            )

    winner_ids = sorted(
        {
            result["winner_id"]
            for result in lot_results.values()
            if result["winner_id"]
        }
    )
    if winner_ids:
        placeholders = ", ".join("?" for _ in winner_ids)
        existing_winners = {
            str(row[0])
            for row in cursor.execute(
                f"""SELECT id FROM nha_thau
                    WHERE organization_id = ?
                      AND archived_at IS NULL
                      AND id IN ({placeholders})""",
                (organization_id, *winner_ids),
            ).fetchall()
        }
        if existing_winners != set(winner_ids):
            raise LotLifecycleInputError(
                "Nhà thầu trúng không tồn tại trong phạm vi tổ chức hiện tại."
            )

    lifecycle = finalize_batch(
        cursor,
        organization_id,
        package_id,
        batch_id,
        outcomes,
        actor_user_id=actor_user_id,
    )
    sync_version = next_sync_version(cursor, organization_id)
    for lot_id, result in lot_results.items():
        cursor.execute(
            """UPDATE goi_thau_phan_lo
               SET nha_thau_trung_thau_id = ?, gia_trung_thau = ?,
                   thoi_gian_goi_thau = ?, thoi_gian_hop_dong = ?,
                   sync_version = ?, row_version = row_version + 1,
                   updated_at = CURRENT_TIMESTAMP
               WHERE organization_id = ? AND goi_thau_id = ? AND id = ?""",
            (
                result["winner_id"],
                result["award_price"],
                result["package_duration"],
                result["contract_duration"],
                sync_version,
                organization_id,
                package_id,
                lot_id,
            ),
        )
        if cursor.rowcount != 1:
            raise LotLifecycleInputError(
                f"Phần lô {lot_id} không thuộc gói thầu hiện tại."
            )

    all_lot_results = cursor.execute(
        """SELECT nha_thau_trung_thau_id, COALESCE(gia_trung_thau, 0)
           FROM goi_thau_phan_lo
           WHERE organization_id = ? AND goi_thau_id = ?
             AND archived_at IS NULL""",
        (organization_id, package_id),
    ).fetchall()
    all_winner_ids = {
        str(row[0]).strip()
        for row in all_lot_results
        if str(row[0] or "").strip()
    }
    package_winner_id = (
        next(iter(all_winner_ids)) if len(all_winner_ids) == 1 else None
    )
    total_award_price = sum(int(row[1] or 0) for row in all_lot_results)
    package_status = (
        "AWARDED"
        if lifecycle["packageStatus"] == "COMPLETED"
        else "PARTIALLY_AWARDED"
    )
    updated_package = cursor.execute(
        """UPDATE goi_thau
           SET trang_thai = ?, nha_thau_trung_thau_id = ?,
               gia_trung_thau = ?, so_quyet_dinh_ket_qua = ?,
               ngay_quyet_dinh_ket_qua = ?, sync_version = ?,
               row_version = row_version + 1,
               updated_at = CURRENT_TIMESTAMP
           WHERE organization_id = ? AND id = ? AND row_version = ?
           RETURNING row_version""",
        (
            package_status,
            package_winner_id,
            total_award_price,
            decision_number,
            decision_date,
            sync_version,
            organization_id,
            package_id,
            expected_version,
        ),
    ).fetchone()
    if not updated_package:
        raise LotLifecycleInputError(
            "Gói thầu đã được thay đổi bởi một phiên làm việc khác."
        )

    save_child_payloads(
        cursor,
        "goi_thau",
        {"id": package_id, "danhGiaHsdtMetadata": metadata},
        organization_id,
        package["owner_type"],
        sync_version,
        vietnam_now_sql(),
        actor_user_id,
    )

    snapshot = {
        "packageId": package_id,
        "batchId": batch_id,
        "outcomes": outcomes,
        "lotResults": raw_lot_results,
        "packageStatus": package_status,
        "decisionNumber": decision_number,
        "decisionDate": decision_date,
        "metadata": metadata,
    }
    snapshot_json = json.dumps(
        snapshot,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    scope_material = "|".join(sorted(lot_results))
    scope_hash = sha256(scope_material.encode("utf-8")).hexdigest()
    content_digest = sha256(snapshot_json.encode("utf-8")).hexdigest()
    artifact_id = generate_record_id("ho_so_nghiep_vu_lcnt")
    inserted_artifact = cursor.execute(
        """INSERT INTO ho_so_nghiep_vu_lcnt (
               id, organization_id, owner_type, batch_id, artifact_type,
               status, document_number, document_date, revision,
               snapshot_schema_version, snapshot_json, scope_hash,
               content_digest, finalized_by_id, finalized_at, sync_version
           ) VALUES (
               ?, ?, ?, ?, 'RESULT_APPROVAL_DECISION', 'FINAL',
               ?, ?, 1, 1, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?
           )
           ON CONFLICT (
               organization_id, batch_id, artifact_type, revision
           ) DO NOTHING
           RETURNING id""",
        (
            artifact_id,
            organization_id,
            package["owner_type"],
            batch_id,
            decision_number,
            decision_date,
            snapshot_json,
            scope_hash,
            content_digest,
            actor_user_id,
            sync_version,
        ),
    ).fetchone()
    if inserted_artifact:
        artifact_id = str(inserted_artifact[0])
    else:
        existing_artifact = cursor.execute(
            """SELECT id, content_digest
               FROM ho_so_nghiep_vu_lcnt
               WHERE organization_id = ? AND batch_id = ?
                 AND artifact_type = 'RESULT_APPROVAL_DECISION'
                 AND revision = 1""",
            (organization_id, batch_id),
        ).fetchone()
        if (
            not existing_artifact
            or str(existing_artifact[1] or "") != content_digest
        ):
            raise LotLifecycleInputError(
                "Đợt đã có kết quả chính thức khác với dữ liệu gửi lại."
            )
        artifact_id = str(existing_artifact[0])
    for lot_id in sorted(lot_results):
        cursor.execute(
            """INSERT INTO ho_so_nghiep_vu_lcnt_phan_lo (
                   id, organization_id, owner_type, artifact_id, lot_id,
                   sync_version
               ) VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT (organization_id, artifact_id, lot_id)
               DO NOTHING""",
            (
                generate_record_id("ho_so_nghiep_vu_lcnt_phan_lo"),
                organization_id,
                package["owner_type"],
                artifact_id,
                lot_id,
                sync_version,
            ),
        )
    lifecycle["packageRowVersion"] = int(updated_package[0])
    lifecycle["syncVersion"] = sync_version
    lifecycle["packageResult"] = {
        "status": package_status,
        "winnerId": package_winner_id or "",
        "awardPrice": total_award_price,
        "decisionNumber": decision_number,
        "decisionDate": decision_date,
    }
    return lifecycle
