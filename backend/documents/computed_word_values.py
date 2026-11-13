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


def _amount(value) -> Decimal | None:
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
            total += _amount(item.get(field)) or Decimal(0)
    return _whole(total)


def plan_total_context(plan, packages) -> dict:
    """Totals of the plan's work parts and current packages (integers, VND)."""

    plan = plan or {}
    done = _sum(plan.get("cv_da_thuc_hien"), "gia_tri")
    investment = _amount(plan.get("tong_muc_dau_tu"))
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

    rate = _amount(rate_percent)
    price = _amount(contract_price)
    if rate is None or price is None or rate <= 0 or price <= 0:
        return None
    return _whole(price * rate / Decimal(100))
