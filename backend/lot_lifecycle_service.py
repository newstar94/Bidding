"""Transactional query/command service for lot-scoped selection batches."""

from __future__ import annotations

from collections import defaultdict

from backend.db.id_utils import generate_record_id
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
        """SELECT id, owner_type, phan_lo, phuong_thuc_lua_chon
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
