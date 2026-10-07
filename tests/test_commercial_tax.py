from backend.commercial_policy.tax import calculate_tax_price


def test_configurable_tax_price_inclusive_and_exclusive_use_integer_vnd():
    policy = {"taxInclusive": True, "taxBasisPoints": 800, "rounding": "half_up"}
    assert calculate_tax_price(108_000, policy) == {"subtotal": 100_000, "tax": 8_000, "total": 108_000, "currency": "VND", "period": "one_time"}
    policy["taxInclusive"] = False
    assert calculate_tax_price(100_000, policy) == {"subtotal": 100_000, "tax": 8_000, "total": 108_000, "currency": "VND", "period": "one_time"}


def test_tax_rounding_and_unconfigured_legacy_amount_remain_explicit():
    for rounding, tax in [("half_up", 1), ("floor", 0), ("ceil", 1)]:
        assert calculate_tax_price(7, {"taxInclusive": False, "taxBasisPoints": 800, "rounding": rounding})["tax"] == tax
    assert calculate_tax_price(99_000, {})["total"] == 99_000
    assert calculate_tax_price(99_000, {})["tax"] == 0
