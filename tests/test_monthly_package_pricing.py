from copy import deepcopy

import pytest

from backend.commercial_policy.document import build_initial_draft_document, validate_document
from backend.commercial_policy.tax import calculate_tax_price


def document_with_monthly_base(*, tax_basis_points=0):
    document = build_initial_draft_document()
    # Recreate an annual-only historical source for counterpart compatibility.
    document["offers"] = document["offers"][:8]
    document["taxInvoice"]["taxBasisPoints"] = tax_basis_points
    for offer in document["offers"]:
        offer["price"] = calculate_tax_price(offer["price"]["total"], document["taxInvoice"], period="yearly")
    offer = document["offers"][0]
    offer["price"] = {**calculate_tax_price(20000, document["taxInvoice"], period="yearly"), "monthlyBaseAmount": 2000}
    return document


def pricing_errors(document):
    return [item for item in validate_document(document)["errors"] if item["code"] in {"MONTHLY_BASE_PRICE_INVALID", "MONTHLY_ANNUAL_PRICE_MISMATCH", "TAX_PRICE_MISMATCH"}]


def test_monthly_base_rule_keeps_tax_and_legacy_offers_compatible():
    assert not pricing_errors(build_initial_draft_document())
    for rate in (0, 750, 1000):
        document = document_with_monthly_base(tax_basis_points=rate)
        assert not pricing_errors(document)


@pytest.mark.parametrize("base", [None, True, -1, "2000", 1.5])
def test_monthly_base_requires_integer_vnd(base):
    document = document_with_monthly_base()
    document["offers"][0]["price"]["monthlyBaseAmount"] = base
    assert any(item["code"] == "MONTHLY_BASE_PRICE_INVALID" for item in pricing_errors(document))


def test_validator_rejects_a_tampered_annual_price_or_a_different_monthly_price():
    document = document_with_monthly_base()
    document["offers"][0]["price"]["total"] = 24000
    document["offers"][0]["price"]["subtotal"] = 24000
    assert any(item["code"] == "MONTHLY_ANNUAL_PRICE_MISMATCH" for item in pricing_errors(document))
    document = document_with_monthly_base()
    monthly = deepcopy(document["offers"][0])
    monthly["code"] = "personal.internal.monthly"
    monthly["price"] = calculate_tax_price(2000, document["taxInvoice"], period="monthly")
    document["offers"].append(monthly)
    assert not pricing_errors(document)
    monthly["price"] = calculate_tax_price(2500, document["taxInvoice"], period="monthly")
    assert any(item["code"] == "MONTHLY_ANNUAL_PRICE_MISMATCH" for item in pricing_errors(document))
