"""Allowlisted read-only search across BiddingFlow business data.

The model sees one small tool interface.  Entity names, tables, searchable
fields, projections, routes and workspace visibility rules remain code-owned.
This gives the data assistant broad coverage without exposing arbitrary SQL or
system/security tables.
"""

# ruff: noqa: S608

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from backend.ai.errors import ai_error
from backend.ai.types import AiRequestContext, ToolResult
from backend.analytics.query_scope import visibility_clause
from backend.shared.domain_enums import enum_filter_value, is_user_defined_enum_filter


@dataclass(frozen=True)
class EntitySpec:
    key: str
    label: str
    table: str
    module: str
    route: str
    projection: tuple[tuple[str, str], ...]
    searchable: tuple[str, ...]
    scope_entity: str | None = None
    parent_column: str | None = None
    status_column: str | None = None
    latest: bool = False
    archived: bool = False
    order_column: str = "updated_at"


def _spec(
    key: str,
    label: str,
    table: str,
    module: str,
    route: str,
    projection: tuple[tuple[str, str], ...],
    searchable: tuple[str, ...],
    *,
    scope_entity: str | None = None,
    parent_column: str | None = None,
    status_column: str | None = None,
    latest: bool = False,
    archived: bool = False,
    order_column: str = "updated_at",
) -> EntitySpec:
    return EntitySpec(
        key,
        label,
        table,
        module,
        route,
        projection,
        searchable,
        scope_entity,
        parent_column,
        status_column,
        latest,
        archived,
        order_column,
    )


ENTITY_SPECS: dict[str, EntitySpec] = {
    "investors": _spec(
        "investors", "chủ đầu tư", "chu_dau_tu", "chudautu", "/chu-dau-tu",
        (("id", "id"), ("code", "ma_chu_dau_tu"), ("name", "ten_chu_dau_tu"), ("shortName", "ten_viet_tat"), ("taxCode", "ma_so_thue"), ("representative", "dai_dien_cdt"), ("address", "dia_chi"), ("phone", "so_dien_thoai"), ("email", "email")),
        ("ma_chu_dau_tu", "ten_chu_dau_tu", "ten_viet_tat", "ma_so_thue", "dai_dien_cdt"),
        latest=True, archived=True,
    ),
    "plans": _spec(
        "plans", "kế hoạch lựa chọn nhà thầu", "ke_hoach_lcnt", "kehoach", "/ke-hoach",
        (("id", "id"), ("code", "ma_ke_hoach"), ("name", "ten_ke_hoach"), ("project", "ten_du_an_du_toan"), ("procurementType", "loai_hinh_mua_sam"), ("investmentValue", "tong_muc_dau_tu"), ("approvalDate", "ngay_phe_duyet"), ("approvalStatus", "phe_duyet")),
        ("ma_ke_hoach", "ten_ke_hoach", "ten_du_an_du_toan", "loai_hinh_mua_sam"),
        scope_entity="plans", status_column="phe_duyet", latest=True, archived=True,
    ),
    "plan_tasks": _spec(
        "plan_tasks", "công việc kế hoạch", "ke_hoach_cong_viec", "kehoach", "/ke-hoach",
        (("id", "id"), ("planId", "ke_hoach_id"), ("type", "loai"), ("name", "ten_cong_viec"), ("value", "gia_tri"), ("executor", "don_vi_thuc_hien"), ("approvalDocument", "van_ban_phe_duyet")),
        ("loai", "ten_cong_viec", "don_vi_thuc_hien", "van_ban_phe_duyet"),
        scope_entity="plans", parent_column="ke_hoach_id",
    ),
    "contractors": _spec(
        "contractors", "nhà thầu", "nha_thau", "nhathau", "/nha-thau",
        (("id", "id"), ("code", "ma_nha_thau"), ("name", "ten_nha_thau"), ("shortName", "ten_viet_tat"), ("type", "loai_nha_thau"), ("taxCode", "ma_so_thue"), ("representative", "nguoi_dai_dien"), ("phone", "so_dien_thoai"), ("email", "email"), ("address", "dia_chi")),
        ("ma_nha_thau", "ten_nha_thau", "ten_viet_tat", "ma_so_thue", "nguoi_dai_dien"),
        latest=True, archived=True,
    ),
    "contractor_members": _spec(
        "contractor_members", "thành viên liên danh nhà thầu", "nha_thau_lien_danh_thanh_vien", "nhathau", "/nha-thau",
        (("id", "id"), ("contractorId", "nha_thau_id"), ("memberId", "thanh_vien_nha_thau_id"), ("name", "ten_nha_thau"), ("code", "ma_nha_thau"), ("taxCode", "ma_so_thue"), ("role", "vai_tro")),
        ("ten_nha_thau", "ma_nha_thau", "ma_so_thue", "vai_tro"),
        scope_entity="contractors", parent_column="nha_thau_id",
    ),
    "packages": _spec(
        "packages", "gói thầu", "goi_thau", "goithau", "/goi-thau",
        (("id", "id"), ("code", "ma_goi_thau"), ("name", "ten_goi_thau"), ("planId", "ke_hoach_id"), ("value", "gia_goi_thau"), ("contractType", "loai_hop_dong"), ("selectionMethod", "hinh_thuc_lua_chon"), ("status", "trang_thai"), ("bidOpeningTime", "thoi_gian_mo_thau"), ("awardValue", "gia_trung_thau")),
        ("ma_goi_thau", "ten_goi_thau", "loai_hop_dong", "hinh_thuc_lua_chon", "trang_thai"),
        scope_entity="packages", status_column="trang_thai", latest=True, archived=True,
    ),
    "package_lots": _spec(
        "package_lots", "lô thầu", "goi_thau_phan_lo", "goithau", "/goi-thau",
        (("id", "id"), ("packageId", "goi_thau_id"), ("code", "ma_phan_lo"), ("name", "ten_phan_lo"), ("value", "gia_tri_phan_lo"), ("awardValue", "gia_trung_thau")),
        ("ma_phan_lo", "ten_phan_lo"),
        scope_entity="packages", parent_column="goi_thau_id", archived=True,
    ),
    "package_goods": _spec(
        "package_goods", "hàng hóa trong gói thầu", "goi_thau_hang_hoa", "goithau", "/goi-thau",
        (("id", "id"), ("packageId", "goi_thau_id"), ("lotId", "phan_lo_id"), ("code", "ma_hang_hoa"), ("name", "ten_hang_hoa"), ("category", "nhom_hang_hoa"), ("unit", "don_vi_tinh"), ("quantity", "so_luong"), ("technicalRequirement", "yeu_cau_ky_thuat"), ("estimatedUnitPrice", "don_gia_du_toan"), ("estimatedTotal", "thanh_tien_du_toan")),
        ("ma_hang_hoa", "ten_hang_hoa", "nhom_hang_hoa", "yeu_cau_ky_thuat"),
        scope_entity="packages", parent_column="goi_thau_id",
    ),
    "package_optional_purchases": _spec(
        "package_optional_purchases", "mua thêm tùy chọn", "goi_thau_tuy_chon_mua_them", "goithau", "/goi-thau",
        (("id", "id"), ("packageId", "goi_thau_id"), ("item", "hang_muc"), ("unit", "don_vi"), ("quantity", "so_luong"), ("rate", "ty_le"), ("estimatedValue", "gia_tri_uoc_tinh")),
        ("hang_muc", "don_vi"),
        scope_entity="packages", parent_column="goi_thau_id",
    ),
    "package_extensions": _spec(
        "package_extensions", "gia hạn gói thầu", "goi_thau_gia_han", "goithau", "/goi-thau",
        (("id", "id"), ("packageId", "goi_thau_id"), ("closingTime", "thoi_gian_dong_thau"), ("reason", "ly_do_gia_han")),
        ("ly_do_gia_han",),
        scope_entity="packages", parent_column="goi_thau_id",
    ),
    "package_clarifications": _spec(
        "package_clarifications", "làm rõ gói thầu", "goi_thau_lam_ro", "goithau", "/goi-thau",
        (("id", "id"), ("packageId", "goi_thau_id"), ("type", "loai"), ("time", "thoi_gian"), ("content", "noi_dung")),
        ("loai", "noi_dung"),
        scope_entity="packages", parent_column="goi_thau_id",
    ),
    "package_milestones": _spec(
        "package_milestones", "mốc tiến độ gói thầu", "goi_thau_moc_tien_do", "goithau", "/goi-thau",
        (("id", "id"), ("packageId", "goi_thau_id"), ("group", "ten_nhom"), ("milestone", "cong_viec"), ("expectedDate", "ngay_du_kien"), ("actualDate", "ngay_thuc_te"), ("status", "trang_thai"), ("note", "ghi_chu")),
        ("ten_nhom", "cong_viec", "so_van_ban", "ghi_chu", "trang_thai"),
        scope_entity="packages", parent_column="goi_thau_id", status_column="trang_thai",
    ),
    "package_process_batches": _spec(
        "package_process_batches", "đợt xử lý lô thầu", "dot_xu_ly_phan_lo", "goithau", "/goi-thau",
        (("id", "id"), ("packageId", "goi_thau_id"), ("sequence", "sequence_no"), ("procedureKind", "procedure_kind"), ("approvalMode", "approval_mode"), ("status", "status"), ("closedAt", "closed_at")),
        ("procedure_kind", "approval_mode", "status", "policy_version"),
        scope_entity="packages", parent_column="goi_thau_id", status_column="status",
    ),
    "lot_dependency_groups": _spec(
        "lot_dependency_groups", "nhóm phụ thuộc lô thầu", "nhom_phu_thuoc_phan_lo", "goithau", "/goi-thau",
        (("id", "id"), ("packageId", "goi_thau_id"), ("kind", "dependency_kind"), ("reason", "reason"), ("mustMoveTogether", "must_move_together"), ("active", "is_active")),
        ("dependency_kind", "reason", "policy_version"),
        scope_entity="packages", parent_column="goi_thau_id",
    ),
    "evaluation_rounds": _spec(
        "evaluation_rounds", "vòng đánh giá", "vong_danh_gia", "goithau", "/goi-thau",
        (("id", "id"), ("packageId", "goi_thau_id"), ("type", "loai_vong"), ("order", "thu_tu"), ("status", "trang_thai"), ("reportNumber", "so_bao_cao"), ("reportDate", "ngay_bao_cao"), ("completedAt", "hoan_thanh_luc")),
        ("loai_vong", "trang_thai", "so_bao_cao"),
        scope_entity="packages", parent_column="goi_thau_id", status_column="trang_thai",
    ),
    "evaluation_results": _spec(
        "evaluation_results", "kết quả đánh giá nhà thầu", "ket_qua_danh_gia_nha_thau", "goithau", "/goi-thau",
        (("id", "id"), ("packageId", "goi_thau_id"), ("openingId", "thong_tin_mo_thau_id"), ("validity", "danh_gia_hop_le"), ("capacity", "danh_gia_nang_luc"), ("technical", "danh_gia_ky_thuat"), ("financial", "danh_gia_tai_chinh"), ("rankingPrice", "gia_xep_hang"), ("proposedAwardPrice", "gia_de_nghi_trung_thau"), ("conclusion", "danh_gia_ket_luan"), ("score", "diem"), ("rejectionReason", "ly_do_loai")),
        ("danh_gia_hop_le", "danh_gia_nang_luc", "danh_gia_ky_thuat", "danh_gia_tai_chinh", "danh_gia_ket_luan", "ly_do_loai"),
        scope_entity="packages", parent_column="goi_thau_id",
    ),
    "package_adjustments": _spec(
        "package_adjustments", "điều chỉnh hồ sơ mời thầu", "goi_thau_dieu_chinh_hsmt", "goithau", "/goi-thau",
        (("id", "id"), ("packageId", "goi_thau_id"), ("sequence", "sequence"), ("reason", "reason"), ("submissionNumber", "submission_number"), ("submissionDate", "submission_date"), ("approvalDecisionNumber", "approval_decision_number"), ("approvalDecisionDate", "approval_decision_date"), ("publishedAt", "published_at")),
        ("reason", "submission_number", "approval_decision_number"),
        scope_entity="packages", parent_column="goi_thau_id", archived=True,
    ),
    "experts": _spec(
        "experts", "chuyên gia", "chuyen_gia", "chuyengia", "/chuyen-gia",
        (("id", "id"), ("name", "ho_ten"), ("certificateNumber", "so_chung_chi"), ("certificateIssuedDate", "ngay_cap_chung_chi"), ("certificateIssuer", "don_vi_cap_chung_chi"), ("certificateIssuePlace", "noi_cap_cccd")),
        ("ho_ten", "so_chung_chi", "don_vi_cap_chung_chi"),
        latest=True, archived=True,
    ),
    "package_experts": _spec(
        "package_experts", "phân công chuyên gia cho gói thầu", "goi_thau_chuyen_gia", "goithau", "/goi-thau",
        (("packageId", "goi_thau_id"), ("expertId", "chuyen_gia_id"), ("type", "loai"), ("role", "chuc_vu"), ("work", "cong_viec")),
        ("loai", "chuc_vu", "cong_viec"),
        scope_entity="packages", parent_column="goi_thau_id", order_column="created_at",
    ),
    "contracts": _spec(
        "contracts", "hợp đồng", "hop_dong", "hopdong", "/hop-dong",
        (("id", "id"), ("number", "so_hop_dong"), ("name", "ten_hop_dong"), ("signedDate", "ngay_ky"), ("investorId", "chu_dau_tu_id"), ("contractorId", "nha_thau_id"), ("value", "gia_tri"), ("type", "loai_hop_dong"), ("duration", "thoi_gian_thuc_hien"), ("status", "trang_thai_hop_dong")),
        ("so_hop_dong", "ten_hop_dong", "loai_hop_dong", "trang_thai_hop_dong"),
        scope_entity="contracts", status_column="trang_thai_hop_dong", latest=True, archived=True,
    ),
    "contract_packages": _spec(
        "contract_packages", "liên kết hợp đồng và gói thầu", "hop_dong_goi_thau", "hopdong", "/hop-dong",
        (("contractId", "hop_dong_id"), ("packageId", "goi_thau_id")),
        ("hop_dong_id", "goi_thau_id"),
        scope_entity="contracts", parent_column="hop_dong_id", order_column="updated_at",
    ),
    "bid_openings": _spec(
        "bid_openings", "dữ liệu mở thầu", "thong_tin_mo_thau", "goithau", "/goi-thau",
        (("id", "id"), ("packageId", "goi_thau_id"), ("contractorId", "nha_thau_id"), ("lotCode", "ma_phan_lo"), ("contractorName", "ten_nha_thau"), ("bidPrice", "gia_du_thau"), ("discountedPrice", "gia_sau_giam_gia"), ("status", "trang_thai_tinh_uu_dai")),
        ("ma_phan_lo", "ten_nha_thau", "ma_dinh_danh", "trang_thai_tinh_uu_dai"),
        scope_entity="packages", parent_column="goi_thau_id", status_column="trang_thai_tinh_uu_dai",
    ),
    "bid_participants": _spec(
        "bid_participants", "nhà thầu tham dự mở thầu", "nha_thau_tham_du_mo_thau", "goithau", "/goi-thau",
        (("id", "id"), ("openingId", "thong_tin_mo_thau_id"), ("packageId", "goi_thau_id"), ("sourceContractorId", "nha_thau_goc_id"), ("versionContractorId", "nha_thau_phien_ban_id")),
        ("goi_thau_id", "nha_thau_goc_id"),
        scope_entity="packages", parent_column="goi_thau_id",
    ),
    "bidder_goods": _spec(
        "bidder_goods", "hàng hóa dự thầu", "hang_hoa_du_thau_nha_thau", "goithau", "/goi-thau",
        (("id", "id"), ("packageId", "goi_thau_id"), ("openingId", "thong_tin_mo_thau_id"), ("lotId", "phan_lo_id"), ("name", "danh_muc_hang_hoa"), ("brand", "nhan_hieu"), ("origin", "xuat_xu"), ("unit", "don_vi_tinh"), ("quantity", "khoi_luong"), ("unitPrice", "don_gia_du_thau"), ("total", "thanh_tien_du_thau"), ("mappingStatus", "mapping_status")),
        ("danh_muc_hang_hoa", "nhan_hieu", "xuat_xu", "hang_san_xuat", "mapping_status"),
        scope_entity="packages", parent_column="goi_thau_id",
    ),
    "package_documents": _spec(
        "package_documents", "tài liệu gói thầu", "tai_lieu_goi_thau", "goithau", "/goi-thau",
        (("id", "id"), ("packageId", "goi_thau_id"), ("documentType", "document_type"), ("filename", "original_filename"), ("contentType", "content_type"), ("uploadedAt", "uploaded_at")),
        ("document_type", "original_filename", "content_type"),
        scope_entity="packages", parent_column="goi_thau_id",
    ),
    "assignments": _spec(
        "assignments", "phân công nhân sự", "phan_cong_nhan_su", "goithau", "/tong-quan",
        (("id", "id"), ("employeeId", "id_nhan_vien"), ("targetId", "id_muc_tieu"), ("targetType", "loai_doi_tuong")),
        ("id_nhan_vien", "id_muc_tieu", "loai_doi_tuong"),
        order_column="updated_at",
    ),
    "contract_statuses": _spec(
        "contract_statuses", "trạng thái hợp đồng", "danh_muc_trang_thai_hop_dong", "hopdong", "/hop-dong",
        (("id", "id"), ("name", "name"), ("color", "color")),
        ("name",),
        order_column="updated_at",
    ),
}


def _restricted(context: AiRequestContext) -> bool:
    return context.scope_type != "personal" and context.membership_role != "manager" and context.active_role not in {"manager", "super_admin"}


def _scope(spec: EntitySpec, context: AiRequestContext, alias: str) -> tuple[list[str], list[Any]]:
    if spec.scope_entity and spec.table in {"goi_thau", "ke_hoach_lcnt", "hop_dong"}:
        clause, params = visibility_clause(context, spec.scope_entity, alias)
        return [clause], list(params)
    if not spec.scope_entity or not _restricted(context) or context.scope_type == "personal":
        if spec.key == "assignments" and _restricted(context):
            return [f"{alias}.organization_id = ?", f"{alias}.id_nhan_vien = ?"], [context.organization_id, context.user_id]
        return [f"{alias}.organization_id = ?"], [context.organization_id]
    parent = f"{alias}.{spec.parent_column}"
    if spec.scope_entity == "packages":
        return [
            f"{alias}.organization_id = ?",
            "EXISTS (SELECT 1 FROM phan_cong_nhan_su pc WHERE pc.organization_id = "
            f"{alias}.organization_id AND pc.id_muc_tieu = {parent} AND pc.id_nhan_vien = ? AND pc.loai_doi_tuong = 'goithau')",
        ], [context.organization_id, context.user_id]
    if spec.scope_entity == "plans":
        return [
            f"{alias}.organization_id = ?",
            "EXISTS (SELECT 1 FROM phan_cong_nhan_su pc WHERE pc.organization_id = "
            f"{alias}.organization_id AND pc.id_muc_tieu = {parent} AND pc.id_nhan_vien = ? AND pc.loai_doi_tuong = 'kehoach')",
        ], [context.organization_id, context.user_id]
    if spec.scope_entity == "contracts":
        return [
            f"{alias}.organization_id = ?",
            "EXISTS (SELECT 1 FROM phan_cong_nhan_su pc WHERE pc.organization_id = "
            f"{alias}.organization_id AND pc.id_muc_tieu = {parent} AND pc.id_nhan_vien = ? AND pc.loai_doi_tuong = 'hopdong')",
        ], [context.organization_id, context.user_id]
    return [f"{alias}.organization_id = ?"], [context.organization_id]


def workspace_search_tool_definitions() -> list[dict]:
    return [{
        "type": "function",
        "name": "search_workspace",
        "description": "Tra cứu đếm hoặc danh sách dữ liệu nghiệp vụ trong workspace hiện tại. Dùng cho mọi entity ứng dụng như chuyên gia, nhà thầu, chủ đầu tư, kế hoạch, gói thầu, lô, hàng hóa, mốc tiến độ, hợp đồng, mở thầu, đánh giá và tài liệu. Backend tự áp quyền; không truy vấn hệ thống, tài khoản, secret hoặc SQL tùy ý.",
        "parameters": {
            "type": "object",
            "properties": {
                "entity": {"type": "string", "enum": list(ENTITY_SPECS)},
                "operation": {"type": "string", "enum": ["count", "list"]},
                "query": {"type": "string"},
                "status": {"type": "string", "description": "Nhãn trạng thái hiển thị trong workspace; trạng thái hợp đồng có thể do người dùng tự đặt, nên giữ nguyên nhãn được hỏi."},
                "packageId": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 20},
            },
            "required": ["entity", "operation", "query", "status", "packageId", "limit"],
            "additionalProperties": False,
        },
        "strict": True,
    }]


def _value(row: Any, column: str) -> Any:
    try:
        return row[column]
    except (KeyError, TypeError, IndexError):
        return None


def _optional_filter(value: Any, maximum: int) -> str:
    normalized = str(value or "").strip()
    if normalized.casefold() in {"*", "all", "any", "tất cả", "tat ca", "mọi", "moi"}:
        return ""
    return normalized[:maximum]


def search_workspace_records(cursor, context: AiRequestContext, arguments: dict[str, Any]) -> ToolResult:
    entity = str(arguments.get("entity") or "").strip()
    spec = ENTITY_SPECS.get(entity)
    if not spec:
        raise ai_error("AI_TOOL_INVALID_ARGUMENTS", "Loại dữ liệu workspace không được hỗ trợ.")
    if not context.permissions.get(spec.module):
        raise ai_error("AI_PERMISSION_DENIED", "Bạn không có quyền xem loại dữ liệu này trong workspace hiện tại.")
    operation = str(arguments.get("operation") or "list").strip()
    if operation not in {"count", "list"}:
        raise ai_error("AI_TOOL_INVALID_ARGUMENTS", "operation không hợp lệ.")
    limit = arguments.get("limit", 20)
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 20:
        raise ai_error("AI_TOOL_INVALID_ARGUMENTS", "limit phải nằm trong khoảng 1-20.")
    query = _optional_filter(arguments.get("query"), 200)
    status = _optional_filter(arguments.get("status"), 120)
    package_id = _optional_filter(arguments.get("packageId"), 160)
    alias = "record"
    where, params = _scope(spec, context, alias)
    if spec.latest:
        where.append(f"{alias}.is_latest = 1")
    if spec.archived:
        where.append(f"{alias}.archived_at IS NULL")
    if status and spec.status_column:
        status = enum_filter_value(spec.table, spec.status_column, status)
        if is_user_defined_enum_filter(spec.table, spec.status_column):
            where.append(f"LOWER({alias}.{spec.status_column}) = LOWER(?)")
        else:
            where.append(f"{alias}.{spec.status_column} = ?")
        params.append(status)
    if package_id and spec.parent_column:
        where.append(f"{alias}.{spec.parent_column} = ?")
        params.append(package_id)
    elif package_id and spec.key == "packages":
        where.append(f"{alias}.id = ?")
        params.append(package_id)
    if query and spec.searchable:
        where.append("(" + " OR ".join(f"LOWER(COALESCE({alias}.{column}, '')) LIKE ?" for column in spec.searchable) + ")")
        params.extend([f"%{query.casefold()}%"] * len(spec.searchable))
    where_sql = " AND ".join(where)
    if operation == "count":
        row = cursor.execute(
            f"SELECT COUNT(*) AS record_count FROM {spec.table} AS {alias} WHERE {where_sql}",
            tuple(params),
        ).fetchone()
        count = int(_value(row, "record_count") or 0)
        records: list[dict[str, Any]] = []
    else:
        columns = ", ".join(f"{alias}.{column} AS {column}" for _, column in spec.projection)
        rows = cursor.execute(
            f"SELECT {columns} FROM {spec.table} AS {alias} WHERE {where_sql} "
            f"ORDER BY {alias}.{spec.order_column} DESC NULLS LAST LIMIT ?",
            tuple(params + [limit]),
        ).fetchall()
        records = [
            {output: _value(row, column) for output, column in spec.projection if _value(row, column) not in (None, "")}
            for row in rows
        ]
        count = len(records)
    summary = {"recordCount": count, "entity": entity, "entityLabel": spec.label}
    if operation == "list":
        summary["truncated"] = count >= limit
    return ToolResult(
        tool_name="search_workspace",
        scope={"organizationId": context.organization_id, "organizationName": context.organization_name},
        filters={"entity": entity, "query": query or None, "status": status or None, "packageId": package_id or None, "operation": operation},
        summary=summary,
        records=records,
        generated_at=datetime.now().astimezone().isoformat(),
        source_links=[{"type": "list", "label": f"Mở danh sách {spec.label}", "url": spec.route}],
    )


__all__ = ["ENTITY_SPECS", "search_workspace_records", "workspace_search_tool_definitions"]
