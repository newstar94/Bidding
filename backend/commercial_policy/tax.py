"""Deterministic VND arithmetic for explicitly configured tax policies."""

SUPPORTED_TAX_ROUNDING = frozenset({"half_up", "floor", "ceil"})
SUPPORTED_INVOICE_TRIGGERS = frozenset({"verified_payment", "activation_applied", "manual", "disabled"})


def tax_arithmetic_configured(policy):
    return (
        isinstance(policy, dict)
        and type(policy.get("taxInclusive")) is bool
        and type(policy.get("taxBasisPoints")) is int
        and 0 <= policy["taxBasisPoints"] <= 10_000
        and isinstance(policy.get("rounding"), str)
        and policy["rounding"] in SUPPORTED_TAX_ROUNDING
    )


def _rounded_ratio(numerator, denominator, rounding):
    quotient, remainder = divmod(numerator, denominator)
    if rounding == "ceil":
        return quotient + int(remainder > 0)
    if rounding == "half_up":
        return quotient + int(remainder * 2 >= denominator)
    return quotient


def calculate_tax_price(amount, policy, *, period="one_time"):
    """The amount is gross when inclusive, net when exclusive.

    Older immutable releases without tax decisions retain their existing zero
    tax credit-pack amount. New live releases must pass document validation.
    """
    amount = int(amount)
    if amount < 0:
        raise ValueError("Tax price amount must be nonnegative.")
    tax = 0
    inclusive = False
    if tax_arithmetic_configured(policy):
        inclusive = policy["taxInclusive"]
        denominator = 10_000 + policy["taxBasisPoints"] if inclusive else 10_000
        tax = _rounded_ratio(amount * policy["taxBasisPoints"], denominator, policy["rounding"])
    subtotal = amount - tax if inclusive else amount
    return {"subtotal": subtotal, "tax": tax, "total": subtotal + tax, "currency": "VND", "period": period}
