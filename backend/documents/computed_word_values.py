"""ADR 0105: precomputed Word values that templates cannot add up themselves.

Template expressions may not add, subtract or multiply (``template_security``),
so totals and the performance-security amount are computed here from the same
records the export already loads.  The module is pure: callers pass records.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

# Plan export scalars: context key -> label.
PLAN_TOTAL_LABELS = {
    "tong_gia_goi_thau_ke_hoach": "Tổng giá các gói thầu hiện hành của kế hoạch",
    "tong_gia_tri_cv_da_thuc_hien": "Tổng giá trị phần công việc đã thực hiện",
    "tong_gia_tri_cv_khong_ap_dung": "Tổng giá trị phần công việc không áp dụng hình thức LCNT",
    "tong_muc_dau_tu_tru_da_thuc_hien": "Tổng mức đầu tư/dự toán trừ giá trị phần công việc đã thực hiện",
}
PLAN_TOTAL_CONTEXT_KEYS = frozenset(PLAN_TOTAL_LABELS)
# Default Word variables (variable name, context key, description).
PLAN_TOTAL_WORD_MAPPINGS = [
    ("tong_gia_gt_kh", "tong_gia_goi_thau_ke_hoach", PLAN_TOTAL_LABELS["tong_gia_goi_thau_ke_hoach"]),
    ("tong_gia_tri_da_th", "tong_gia_tri_cv_da_thuc_hien", PLAN_TOTAL_LABELS["tong_gia_tri_cv_da_thuc_hien"]),
    ("tong_gia_tri_khong_ad", "tong_gia_tri_cv_khong_ap_dung", PLAN_TOTAL_LABELS["tong_gia_tri_cv_khong_ap_dung"]),
    ("tmdt_tru_da_th", "tong_muc_dau_tu_tru_da_thuc_hien", PLAN_TOTAL_LABELS["tong_muc_dau_tu_tru_da_thuc_hien"]),
]

# Bid-row field added to every bidder list item of package exports.
PERFORMANCE_SECURITY_FIELD = "gia_tri_bao_dam_thuc_hien_hd"

# ADR 0106: one row per contractor for lot-divided packages.
CONTRACTOR_SUMMARY_ROOT = "ds_nha_thau_tong_hop"
CONTRACTOR_SUMMARY_TECHNICAL_ROOT = "ds_nha_thau_tong_hop_dat_ky_thuat"
CONTRACTOR_SUMMARY_RANK_1_ROOT = "ds_nha_thau_tong_hop_xep_hang_1"
CONTRACTOR_SUMMARY_ROOTS = (
    CONTRACTOR_SUMMARY_ROOT,
    CONTRACTOR_SUMMARY_TECHNICAL_ROOT,
    CONTRACTOR_SUMMARY_RANK_1_ROOT,
)
CONTRACTOR_SUMMARY_LIST_MAPPINGS = [
    ("ds_nt_tong_hop", CONTRACTOR_SUMMARY_ROOT,
     "Tổng hợp theo nhà thầu: mọi nhà thầu tham dự, mỗi nhà thầu một dòng"),
    ("ds_nt_tong_hop_dat_kt", CONTRACTOR_SUMMARY_TECHNICAL_ROOT,
     "Tổng hợp theo nhà thầu: nhà thầu có ít nhất một phần lô đạt kỹ thuật"),
    ("ds_nt_tong_hop_hang_1", CONTRACTOR_SUMMARY_RANK_1_ROOT,
     "Tổng hợp theo nhà thầu: nhà thầu có ít nhất một phần lô xếp hạng 1"),
]
CONTRACTOR_SUMMARY_FIELD_LABELS = {
    "nha_thau_id": "Mã nội bộ nhà thầu",
    "ten_nha_thau": "Tên nhà thầu",
    "ma_nha_thau": "Mã định danh nhà thầu",
    "ma_so_thue": "Mã số thuế nhà thầu",
    "danh_gia_hop_le": "Tính hợp lệ (tổng hợp các phần lô)",
    "danh_gia_nang_luc": "Năng lực và kinh nghiệm (tổng hợp các phần lô)",
    "so_phan_tham_du": "Số phần lô tham dự",
    "so_phan_dat_nang_luc": "Số phần lô đạt năng lực và kinh nghiệm",
    "so_phan_khong_dat_nang_luc": "Số phần lô không đạt năng lực và kinh nghiệm",
    "so_phan_dat_ky_thuat": "Số phần lô đạt kỹ thuật",
    "so_phan_xep_hang_1": "Số phần lô xếp hạng 1",
    "tong_gia_phan_lo": "Tổng giá các phần lô tham dự",
    "tong_gia_du_thau": "Tổng giá dự thầu",
    "tong_gia_tri_giam_gia": "Tổng giá trị giảm giá",
    "tong_gia_sau_giam_gia": "Tổng giá dự thầu sau giảm giá",
    "tong_gia_tri_uu_dai": "Tổng giá trị ưu đãi",
    "tong_gia_danh_gia": "Tổng giá đánh giá",
    "tong_gia_du_thau_dat_ky_thuat": "Tổng giá dự thầu của các phần lô đạt kỹ thuật",
    "tong_gia_tri_giam_gia_dat_ky_thuat": "Tổng giá trị giảm giá của các phần lô đạt kỹ thuật",
    "tong_gia_sau_giam_gia_dat_ky_thuat": "Tổng giá sau giảm giá của các phần lô đạt kỹ thuật",
    "tong_gia_tri_uu_dai_dat_ky_thuat": "Tổng giá trị ưu đãi của các phần lô đạt kỹ thuật",
    "tong_gia_danh_gia_dat_ky_thuat": "Tổng giá đánh giá của các phần lô đạt kỹ thuật",
    "tong_gia_phan_lo_xep_hang_1": "Tổng giá các phần lô xếp hạng 1",
    "tong_gia_du_thau_xep_hang_1": "Tổng giá dự thầu của các phần lô xếp hạng 1",
    "tong_gia_tri_giam_gia_xep_hang_1": "Tổng giá trị giảm giá của các phần lô xếp hạng 1",
    "tong_gia_sau_giam_gia_xep_hang_1": "Tổng giá sau giảm giá của các phần lô xếp hạng 1",
}
CONTRACTOR_SUMMARY_FIELDS = frozenset(CONTRACTOR_SUMMARY_FIELD_LABELS)


def parse_amount(value) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    text = str(value).strip().replace(" ", "")
    if not text:
        return None
    # Accept stored numbers and Vietnamese display strings such as "288.000.000".
    if "," in text or text.count(".") > 1:
        text = text.replace(".", "").replace(",", ".")
    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def _whole(value: Decimal) -> int:
    return int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _sum(items, field) -> int:
    total = Decimal(0)
    for item in items or ():
        if isinstance(item, dict):
            total += parse_amount(item.get(field)) or Decimal(0)
    return _whole(total)


def plan_total_context(plan, packages) -> dict:
    """Totals of the plan's work parts and current packages (integers, VND)."""

    plan = plan or {}
    done = _sum(plan.get("cv_da_thuc_hien"), "gia_tri")
    investment = parse_amount(plan.get("tong_muc_dau_tu"))
    return {
        "tong_gia_goi_thau_ke_hoach": _sum(packages, "gia_goi_thau"),
        "tong_gia_tri_cv_da_thuc_hien": done,
        "tong_gia_tri_cv_khong_ap_dung": _sum(plan.get("cv_khong_ap_dung"), "gia_tri"),
        # Missing investment total stays empty instead of printing a negative.
        "tong_muc_dau_tu_tru_da_thuc_hien": (
            _whole(investment - done) if investment is not None else ""
        ),
    }


def performance_security_amount(rate_percent, contract_price) -> int | None:
    """Security amount = rate (%) x contract price, rounded half up to whole VND."""

    rate = parse_amount(rate_percent)
    price = parse_amount(contract_price)
    if rate is None or price is None or rate <= 0 or price <= 0:
        return None
    return _whole(price * rate / Decimal(100))

