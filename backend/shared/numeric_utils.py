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
    integer = int(amount)
    if integer < 0 or integer > MAX_SIGNED_64BIT_INTEGER:
        return None
    return integer


def money_json_value(value):
    """Money is always serialized as a decimal string to stay BigInt-safe."""
    if value is None or value == "":
        return None
    return str(int(value))
