"""Build the normalized context used by package timeline Word exports."""

from __future__ import annotations

import json
from copy import deepcopy
from datetime import datetime

from backend.shared.helpers import database
from backend.documents.docx_context_policy import project_docx_context
from backend.shared.date_utils import vietnam_now, vietnam_today


TIMELINE_TEMPLATE_VERSION = 1

TIMELINE_SECTIONS = (
    ("I", "KHLCNT + DỰ TOÁN", (
        ("1.1", "Chứng thư thẩm định giá, Báo giá", "Đơn vị thẩm định, đơn vị báo giá", False),
        ("1.2", "QĐ thành lập tổ", "Chủ đầu tư", False),
        ("1.3", "Tờ trình dự toán", "Chủ đầu tư", False),
        ("1.4", "QĐ phê duyệt dự toán", "Chủ đầu tư", False),
        ("1.5", "Tờ trình kế hoạch", "Chủ đầu tư", False),
        ("1.6", "QĐ phê duyệt kế hoạch", "Đơn vị có thẩm quyền/Chủ đầu tư", False),
        ("1.7", "Tờ trình kế hoạch + Dự toán", "Chủ đầu tư", False),
        ("1.8", "QĐ phê duyệt dự toán + kế hoạch", "Đơn vị có thẩm quyền/Chủ đầu tư", False),
    )),
    ("II", "TƯ VẤN LẬP", (
        ("2.1", "Thư mời", "Chủ đầu tư", False),
        ("2.2", "Đơn xin nhận thầu", "Tư vấn lập", False),
        ("2.3", "Biên bản hoàn thiện hợp đồng", "CĐT-TVL", False),
        ("2.4", "Tờ trình phê duyệt chỉ định TVL", "Chủ đầu tư", True),
        ("2.5", "QĐ chỉ định TVL", "Chủ đầu tư", True),
        ("2.6", "Hợp đồng TVL", "CĐT-TVL", False),
        ("2.7", "QĐ thành lập TCG", "Tư vấn lập", False),
        ("2.8", "BBNT E-HSMT", "CĐT-TVL", False),
        ("2.9", "BBNT BCĐG", "CĐT-TVL", False),
        ("2.10", "Xác định KL hoàn thành", "CĐT-TVL", False),
        ("2.11", "Đề nghị thanh toán", "Tư vấn lập", False),
        ("2.12", "Thanh lý HĐ", "CĐT-TVL", False),
    )),
    ("III", "TƯ VẤN THẨM", (
        ("3.1", "Thư mời", "Chủ đầu tư", False),
        ("3.2", "Đơn xin nhận thầu", "Tư vấn thẩm", False),
        ("3.3", "Biên bản hoàn thiện hợp đồng", "CĐT-TVT", False),
        ("3.4", "Tờ trình phê duyệt chỉ định TVT", "Chủ đầu tư", True),
        ("3.5", "QĐ chỉ định TVT", "Chủ đầu tư", True),
        ("3.6", "Hợp đồng TVT", "CĐT-TVT", False),
        ("3.7", "QĐ thành lập TTĐ", "Tư vấn thẩm", False),
        ("3.8", "BBNT BCTĐ E-HSMT", "CĐT-TVT", False),
        ("3.9", "BBNT BCTĐ KQLCNT", "CĐT-TVT", False),
        ("3.10", "Xác định KL hoàn thành", "CĐT-TVT", False),
        ("3.11", "Đề nghị thanh toán", "Tư vấn thẩm", False),
        ("3.12", "Thanh lý HĐ", "CĐT-TVT", False),
    )),
    ("IV", "E-HSMT", (
        ("4.1", "Tờ trình E-HSMT", "Tổ chuyên gia TVL", False),
        ("4.2", "Báo cáo thẩm định E-HSMT", "Tư vấn thẩm", True),
        ("4.3", "QĐ phê duyệt E-HSMT", "Chủ đầu tư", False),
    )),
    ("V", "KẾT QUẢ LCNT", (
        ("5.1", "BB Đóng mở thầu", "Chủ đầu tư", False),
        ("5.2", "Báo cáo đánh giá E-HSDT (E-HSĐXKT)", "Tổ chuyên gia TVL", False),
        ("5.3", "Báo cáo thẩm định nhà thầu đạt kỹ thuật", "Tư vấn thẩm", True),
        ("5.4", "Quyết định phê duyệt nhà thầu đạt kỹ thuật", "Chủ đầu tư", True),
        ("5.5", "BB Mở Tài chính", "Chủ đầu tư", True),
        ("5.6", "Báo cáo đánh giá E-HSĐXTC", "Tổ chuyên gia TVL", True),
        ("5.7", "Thư mời đối chiếu tài liệu", "Chủ đầu tư", False),
        ("5.8", "BB đối chiếu tài liệu", "Chủ đầu tư - Nhà thầu", False),
        ("5.9", "Thương thảo hợp đồng", "Chủ đầu tư - Nhà thầu", True),
        ("5.10", "Báo cáo thẩm định KQLCNT", "Tư vấn thẩm", True),
        ("5.11", "Phê duyệt KQLCNT", "Chủ đầu tư", False),
        ("5.12", "Thư chấp thuận và trao hợp đồng", "Chủ đầu tư", False),
        ("5.13", "BB hoàn thiện hợp đồng", "Chủ đầu tư - Nhà thầu", False),
    )),
)

SOURCE_BY_MILESTONE = {
    "1.3": ("plan.ngay_trinh_du_toan", "", "ngay_trinh_du_toan"),
    "1.4": ("plan.qd_phe_duyet_du_toan", "so_qd_phe_duyet_du_toan", "ngay_phe_duyet_du_toan"),
    "1.5": ("plan.ngay_trinh_ke_hoach", "", "ngay_trinh_ke_hoach"),
    "1.6": ("plan.qd_phe_duyet", "quyet_dinh_phe_duyet", "ngay_phe_duyet"),
    "1.7": ("plan.trinh_ke_hoach_du_toan", "", "ngay_trinh_ke_hoach"),
    "1.8": ("plan.qd_phe_duyet", "quyet_dinh_phe_duyet", "ngay_phe_duyet"),
    "4.1": ("package.to_trinh_hsmt", "so_to_trinh_hsmt", "ngay_trinh_hsmt"),
    "4.2": ("package.bao_cao_tham_dinh_hsmt", "so_bao_cao_tham_dinh_hsmt", "ngay_bao_cao_tham_dinh_hsmt"),
    "4.3": ("package.qd_hsmt", "so_quyet_dinh", "ngay_quyet_dinh"),
    "5.1": ("package.mo_thau", "", "thoi_gian_mo_thau"),
    "5.5": ("package.mo_tai_chinh", "", "thoi_gian_mo_ehsdxtc"),
    "5.11": ("package.qd_kqlcnt", "so_quyet_dinh_ket_qua", "ngay_quyet_dinh_ket_qua"),
}
EVALUATION_SOURCE_CODES = {"5.2", "5.3", "5.6", "5.10"}
SEPARATE_PLAN_APPROVAL_CODES = {"1.3", "1.4", "1.5", "1.6"}
COMBINED_PLAN_APPROVAL_CODES = {"1.7", "1.8"}
TWO_ENVELOPE_CODES = {"5.3", "5.4", "5.5", "5.6"}
COMPETITIVE_QUOTATION_APPRAISAL_CODES = {"4.2", "5.3", "5.10"}


def _normalized_label(value):
    return str(value or "").strip().casefold()


def _timeline_item_is_applicable(item, package, plan):
    code = str(item.get("ma_moc") or "")
    approval_type = _normalized_label(plan.get("phe_duyet"))
    if approval_type == "dự toán và kế hoạch" and code in SEPARATE_PLAN_APPROVAL_CODES:
        return False
    if approval_type == "kế hoạch" and code in COMBINED_PLAN_APPROVAL_CODES:
        return False

    selection_method = _normalized_label(package.get("hinh_thuc_lua_chon"))
    is_competitive_quotation = selection_method == "chào hàng cạnh tranh"
    if is_competitive_quotation and (
        code.startswith("3.") or code in COMPETITIVE_QUOTATION_APPRAISAL_CODES
    ):
        return False

    appraisal_required = _normalized_label(package.get("yeu_cau_tham_dinh_hsmt"))
    if code == "4.2" and appraisal_required == "không":
        return False

    selection_procedure = _normalized_label(package.get("phuong_thuc_lua_chon"))
    is_two_envelope = selection_procedure == "một giai đoạn hai túi hồ sơ"
    if selection_procedure and not is_two_envelope and code in TWO_ENVELOPE_CODES:
        return False
    return True


def _number_section_items(items):
    for index, item in enumerate(items, start=1):
        section_number = str(item.get("ma_moc") or "").split(".", maxsplit=1)[0]
        item["display_code"] = f"{section_number}.{index}"
    return items


def _date_only(value):
    raw = str(value or "").strip()
    if not raw:
        return ""
    if len(raw) >= 10 and raw[4:5] == "-" and raw[7:8] == "-":
        return raw[:10]
    for pattern in ("%d/%m/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(raw[:10], pattern).date().isoformat()
        except ValueError:
            continue
    return ""


def _display_date(value):
    normalized = _date_only(value)
    if not normalized:
        return ""
    return datetime.strptime(normalized, "%Y-%m-%d").strftime("%d/%m/%Y")


def _default_items():
    rows = []
    order = 0
    for section_code, section_title, definitions in TIMELINE_SECTIONS:
        for code, work, issuer, optional in definitions:
            source = SOURCE_BY_MILESTONE.get(code)
            evaluation_source = code in EVALUATION_SOURCE_CODES
            rows.append({
                "id": "",
                "ma_nhom": section_code,
                "ten_nhom": section_title,
                "ma_moc": code,
                "cong_viec": work,
                "don_vi_ban_hanh": issuer,
                "so_van_ban": "",
                "ngay_du_kien": "",
                "ngay_thuc_te": "",
                "ghi_chu": "Nếu có" if optional else "",
                "source_key": source[0] if source else (f"evaluation.{code}" if evaluation_source else ""),
                "source_mode": "AUTO" if source or evaluation_source else "MANUAL",
                "is_optional": bool(optional),
                "trang_thai": "PENDING",
                "sort_order": order,
                "template_version": TIMELINE_TEMPLATE_VERSION,
            })
            order += 1
    return rows


def _row_dict(row):
    return dict(row) if row is not None else {}


def _parse_metadata(raw):
    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(raw or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}


def _evaluation_sources(cursor, organization_id, package_id):
    sources = {}
    rows = cursor.execute(
        """SELECT loai_vong, so_bao_cao, ngay_bao_cao, extension_json
           FROM vong_danh_gia
           WHERE organization_id = ? AND goi_thau_id = ?
           ORDER BY thu_tu""",
        (organization_id, package_id),
    ).fetchall()
    for raw_row in rows:
        row = _row_dict(raw_row)
        extension = _parse_metadata(row.get("extension_json"))
        round_type = row.get("loai_vong")
        if round_type in {"single", "technical"}:
            sources["5.2"] = (row.get("so_bao_cao") or "", row.get("ngay_bao_cao") or "")
            sources["5.3"] = (extension.get("soBctdKt") or "", extension.get("ngayBctdKt") or "")
        elif round_type == "financial":
            sources["5.6"] = (row.get("so_bao_cao") or "", row.get("ngay_bao_cao") or "")
    return sources


def _contract_sources(cursor, organization_id, package_id):
    sources = {}
    rows = cursor.execute(
        """SELECT hd.*
           FROM hop_dong hd
           JOIN hop_dong_goi_thau hgt
             ON hgt.organization_id = hd.organization_id AND hgt.hop_dong_id = hd.id
           WHERE hgt.organization_id = ? AND hgt.goi_thau_id = ?
             AND hd.archived_at IS NULL
           ORDER BY hd.is_latest DESC, hd.ngay_ky DESC""",
        (organization_id, package_id),
    ).fetchall()
    for raw_row in rows:
        row = _row_dict(raw_row)
        classification = str(row.get("phan_loai") or "").strip().lower()
        if "tvl" in classification or "tư vấn lập" in classification:
            prefix = "2"
        elif "tvt" in classification or "tư vấn thẩm" in classification:
            prefix = "3"
        else:
            continue
        sources[f"{prefix}.5"] = (
            row.get("so_qd_chi_dinh") or "",
            row.get("ngay_qd_chi_dinh") or "",
            f"contract.{prefix}.decision",
        )
        sources[f"{prefix}.6"] = (
            row.get("so_hop_dong") or "",
            row.get("ngay_ky") or "",
            f"contract.{prefix}.signed",
        )
        sources[f"{prefix}.12"] = (
            row.get("so_hop_dong") or "",
            row.get("ngay_thanh_ly") or "",
            f"contract.{prefix}.liquidated",
        )
    return sources


def _apply_sources(items, package, plan, evaluation_sources=None, contract_sources=None):
    evaluation_sources = evaluation_sources or {}
    contract_sources = contract_sources or {}
    for item in items:
        code = item["ma_moc"]
        extra_source = contract_sources.get(code)
        if extra_source and (not item.get("id") or item.get("source_mode") == "AUTO"):
            item["source_mode"] = "AUTO"
            item["source_key"] = extra_source[2]
            item["so_van_ban"] = str(extra_source[0] or "")
            item["ngay_thuc_te"] = _date_only(extra_source[1])
            if item["ngay_thuc_te"] and item.get("trang_thai") == "PENDING":
                item["trang_thai"] = "DONE"
            continue
        if item.get("source_mode") != "AUTO":
            continue
        source = SOURCE_BY_MILESTONE.get(code)
        number = actual_date = ""
        if source:
            source_record = plan if source[0].startswith("plan.") else package
            number = source_record.get(source[1]) if source[1] else ""
            actual_date = source_record.get(source[2]) if source[2] else ""
        elif code in evaluation_sources:
            number, actual_date = evaluation_sources[code]
            item["source_key"] = f"evaluation.{code}"
        item["so_van_ban"] = str(number or "")
        item["ngay_thuc_te"] = _date_only(actual_date)
        if item["ngay_thuc_te"] and item.get("trang_thai") == "PENDING":
            item["trang_thai"] = "DONE"
    return items


def _effective_items(cursor, organization_id, package, plan):
    defaults = _default_items()
    by_code = {item["ma_moc"]: item for item in defaults}
    stored_rows = cursor.execute(
        """SELECT * FROM goi_thau_moc_tien_do
           WHERE organization_id = ? AND goi_thau_id = ?
           ORDER BY sort_order, ma_moc""",
        (organization_id, package["id"]),
    ).fetchall()
    for stored_row in stored_rows:
        stored = _row_dict(stored_row)
        code = stored.get("ma_moc")
        if code not in by_code:
            continue
        for key in by_code[code]:
            if key in stored:
                by_code[code][key] = stored[key]
        by_code[code]["is_optional"] = bool(stored.get("is_optional"))
    items = sorted(by_code.values(), key=lambda row: (row["sort_order"], row["ma_moc"]))
    sourced_items = _apply_sources(
        items,
        package,
        plan,
        _evaluation_sources(cursor, organization_id, package["id"]),
        _contract_sources(cursor, organization_id, package["id"]),
    )
    return [
        item for item in sourced_items
        if _timeline_item_is_applicable(item, package, plan)
    ]


def build_timeline_context(package_id, user_id, organization_id):
    """Return a complete, presentation-ready timeline context for one package."""
    del user_id  # Access is enforced by the route; context stays tenant-scoped.
    conn = database.get_connection()
    try:
        cursor = conn.cursor()
        package = _row_dict(cursor.execute(
            "SELECT * FROM goi_thau WHERE organization_id = ? AND id = ?",
            (organization_id, package_id),
        ).fetchone())
        if not package:
            raise ValueError("Không tìm thấy gói thầu trong tổ chức hiện hành.")
        plan = _row_dict(cursor.execute(
            "SELECT * FROM ke_hoach_lcnt WHERE organization_id = ? AND id = ?",
            (organization_id, package.get("ke_hoach_id")),
        ).fetchone())
        investor = _row_dict(cursor.execute(
            "SELECT * FROM chu_dau_tu WHERE organization_id = ? AND id = ?",
            (organization_id, plan.get("chu_dau_tu_id")),
        ).fetchone()) if plan else {}
        organization = _row_dict(cursor.execute(
            "SELECT * FROM to_chuc WHERE id = ?", (organization_id,)
        ).fetchone())
        items = _effective_items(cursor, organization_id, package, plan)
    finally:
        conn.close()

    sections = []
    for code, title, _definitions in TIMELINE_SECTIONS:
        section_items = []
        for source_item in items:
            if source_item["ma_nhom"] != code:
                continue
            item = deepcopy(source_item)
            display_value = item.get("ngay_thuc_te") or item.get("ngay_du_kien") or ""
            item.update({
                "display_date": _display_date(display_value),
                "is_planned_date": bool(not item.get("ngay_thuc_te") and item.get("ngay_du_kien")),
                "is_overdue": bool(
                    item.get("ngay_du_kien")
                    and not item.get("ngay_thuc_te")
                    and item.get("trang_thai") not in {"DONE", "NOT_APPLICABLE"}
                    and _date_only(item.get("ngay_du_kien")) < vietnam_today().isoformat()
                ),
            })
            section_items.append(item)
        if section_items:
            _number_section_items(section_items)
            sections.append({"code": code, "title": title, "items": section_items})

    context = {
        "goi_thau": package,
        "ke_hoach": plan,
        "chu_dau_tu": investor,
        "to_chuc": organization,
        "timeline_sections": sections,
        "generated_date": vietnam_now().strftime("%d/%m/%Y"),
        "planned_date_note": "Ngày màu đỏ là ngày dự kiến/chưa xác nhận.",
    }
    return project_docx_context("timeline", context)
