import json
from pathlib import Path

from backend.sync.bid_evaluation_rules import (
    COMBINED_TECHNICAL_PRICE,
    normalize_evaluation_method,
    parse_technical_score,
    requires_technical_score,
)


DOMAIN_CASES = json.loads(
    (Path(__file__).parent / "fixtures" / "evaluation_domain_cases.json").read_text(
        encoding="utf-8"
    )
)


def test_backend_normalizes_canonical_evaluation_codes_and_legacy_labels():
    for vector in DOMAIN_CASES["methods"]:
        assert normalize_evaluation_method(vector["input"]) == vector["code"]
    assert COMBINED_TECHNICAL_PRICE == "COMBINED_TECHNICAL_PRICE"
    assert requires_technical_score("Kết hợp kỹ thuật và giá") is True
    assert requires_technical_score(COMBINED_TECHNICAL_PRICE) is True


def test_backend_technical_score_parser_matches_shared_contract():
    for vector in DOMAIN_CASES["scores"]:
        parsed = parse_technical_score(vector["input"])
        assert (parsed is not None) is vector["valid"]
        if vector["valid"]:
            assert float(parsed) == vector["number"]
