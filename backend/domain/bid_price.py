"""Bid price after error correction, deviation adjustment and discount (ADR 0107).

G = (giá dự thầu + giá trị sửa lỗi + giá trị hiệu chỉnh sai lệch) × (1 − tỷ lệ giảm giá).
The discount percentage applies to the corrected price. Amounts are integer VND;
corrections may be negative. Mirrors ``frontend/packages/bidEvaluationPriceDefaults.js``.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP


def _decimal(value):
    if value in (None, "") or isinstance(value, bool):
        return None
    try:
        parsed = Decimal(str(value).strip())
    except (InvalidOperation, ValueError):
        return None
    return parsed if parsed.is_finite() else None


def has_price_correction(error_correction, deviation_adjustment):
    return any(
        (amount := _decimal(value)) is not None and amount != 0
        for value in (error_correction, deviation_adjustment)
    )


def corrected_bid_price(bid_price, error_correction=None, deviation_adjustment=None,
                        discount_rate=0):
    """Return G as an integer VND, or ``None`` when the bid price is unknown."""
    price = _decimal(bid_price)
    if price is None:
        return None
    rate = _decimal(discount_rate) or Decimal(0)
    if rate < 0 or rate > 100:
        return None
    corrected = price + (_decimal(error_correction) or 0) + (_decimal(deviation_adjustment) or 0)
    return int((corrected * (Decimal(100) - rate) / Decimal(100)).quantize(
        Decimal("1"), rounding=ROUND_HALF_UP,
    ))
