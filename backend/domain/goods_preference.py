"""Authoritative goods-preference calculation.

All money values are integer VND. Rates are integer basis points so the
calculation is deterministic and does not use binary floating point.
"""

from __future__ import annotations

from decimal import Decimal, ROUND_FLOOR, ROUND_HALF_UP


PREFERENCE_RATE_BP = {0: 0, 1: 750, 2: 1000, 3: 1000, 4: 1200, 5: 1500}


def preference_rate_bp(code):
    try:
        normalized = int(code)
    except (TypeError, ValueError) as exc:
        raise ValueError("Mã ưu đãi phải là số nguyên từ 0 đến 5.") from exc
    if normalized not in PREFERENCE_RATE_BP:
        raise ValueError("Mã ưu đãi phải là số nguyên từ 0 đến 5.")
    return PREFERENCE_RATE_BP[normalized]


def _integer(value, label):
    try:
        parsed = Decimal(str(value))
    except Exception as exc:
        raise ValueError(f"{label} không hợp lệ.") from exc
    if not parsed.is_finite() or parsed < 0 or parsed != parsed.to_integral_value():
        raise ValueError(f"{label} phải là số nguyên VND không âm.")
    return int(parsed)


def _allocate_proportionally(amounts, target, stable_keys):
    """Largest-remainder allocation with stable sort-order/id tie breaking."""
    total = sum(amounts)
    if total == 0:
        if target != 0:
            raise ValueError("Không thể phân bổ giá sau giảm giá khi tổng dòng bằng 0.")
        return [0] * len(amounts)
    exact = [Decimal(value) * Decimal(target) / Decimal(total) for value in amounts]
    allocated = [int(value.to_integral_value(rounding=ROUND_FLOOR)) for value in exact]
    remainder = target - sum(allocated)
    order = sorted(
        range(len(amounts)),
        key=lambda index: (-(exact[index] - allocated[index]), stable_keys[index]),
    )
    for index in order[:remainder]:
        allocated[index] += 1
    return allocated


def calculate_goods_preference(lines, *, discount_rate=0, scope_after_discount=None,
                               evaluation_base=None):
    """Return authoritative per-line and scope preference breakdown."""
    normalized = []
    for index, line in enumerate(lines or ()):
        amount = _integer(
            line.get("thanhTienDuThau", line.get("thanh_tien_du_thau")),
            "Thành tiền dự thầu",
        )
        code = int(line.get("maUuDai", line.get("ma_uu_dai", 0)) or 0)
        rate = preference_rate_bp(code)
        normalized.append((line, amount, code, rate, (
            int(line.get("sortOrder", line.get("sort_order", index)) or index),
            str(line.get("id") or ""),
        )))
    if not normalized:
        raise ValueError("Chưa có hàng hóa để tính ưu đãi.")

    before_discount = sum(item[1] for item in normalized)
    if scope_after_discount is None:
        rate = Decimal(str(discount_rate or 0))
        if not rate.is_finite() or rate < 0 or rate > 100:
            raise ValueError("Tỷ lệ giảm giá phải từ 0 đến 100%.")
        scope_after_discount = int(
            (Decimal(before_discount) * (Decimal(100) - rate) / Decimal(100))
            .quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        )
    else:
        scope_after_discount = _integer(scope_after_discount, "Giá sau giảm giá")
    bases = _allocate_proportionally(
        [item[1] for item in normalized], scope_after_discount,
        [item[4] for item in normalized],
    )
    maximum = max(item[3] for item in normalized)
    results = []
    total_surcharge = 0
    for (line, _amount, code, intrinsic, _key), base in zip(normalized, bases):
        surcharge_rate = max(0, maximum - intrinsic)
        surcharge = int(
            (Decimal(base) * Decimal(surcharge_rate) / Decimal(10000))
            .quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        )
        total_surcharge += surcharge
        quantity = Decimal(str(line.get("khoiLuong", line.get("khoi_luong", 0)) or 0))
        unit_after = (
            str((Decimal(base + surcharge) / quantity).normalize())
            if quantity.is_finite() and quantity > 0 else None
        )
        results.append({
            "id": line.get("id"),
            "maUuDai": code,
            "heSoUuDaiGocBp": intrinsic,
            "heSoCongUuDaiBp": surcharge_rate,
            "giaTriCoSoSauGiamGia": base,
            "giaTriCongUuDai": surcharge,
            "thanhTienSauUuDai": base + surcharge,
            "giaDuThauSauUuDai": unit_after,
        })
    comparison_price = scope_after_discount + total_surcharge
    return {
        "lines": results,
        "tongTruocGiamGia": before_discount,
        "tongSauGiamGia": scope_after_discount,
        "heSoUuDaiCaoNhatBp": maximum,
        "tongGiaTriCongUuDai": total_surcharge,
        "giaSoSanhSauUuDai": comparison_price,
        "giaDanhGiaSauUuDai": (
            _integer(evaluation_base, "Giá đánh giá nền") + total_surcharge
            if evaluation_base not in (None, "") else None
        ),
        "trangThaiTinhUuDai": "ready",
    }
