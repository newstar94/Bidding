"""Exact numeric conversions for financial values crossing the API boundary."""

from decimal import Decimal, InvalidOperation


MAX_SIGNED_64BIT_INTEGER = 9_223_372_036_854_775_807


def parse_vnd_amount(value):
    """Return an exact integer đồng value, or ``None`` for an invalid amount."""
    if value is None or value == "" or isinstance(value, bool):
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        amount = Decimal(text)
    except (InvalidOperation, ValueError):
        return None
    if not amount.is_finite() or amount != amount.to_integral_value():
        return None
    # Check the Decimal before int(): a small exponential string can describe
    # an enormous integer that was already outside the accepted range.
    if amount < 0 or amount > MAX_SIGNED_64BIT_INTEGER:
        return None
    return int(amount)


def money_json_value(value):
    """Money is always serialized as a decimal string to stay BigInt-safe."""
    if value is None or value == "":
        return None
    return str(int(value))
