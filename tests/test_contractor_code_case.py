from backend.shared.text_utils import normalize_business_identifier
from backend.sync.mapper import canonicalize_payload_item


def test_contractor_code_preserves_original_case_during_sync():
    item = canonicalize_payload_item("nha_thau", {
        "maNhaThau": "VnAb-01",
        "tenNhaThau": "Nhà thầu thử nghiệm",
    })
    assert item["maNhaThau"] == "VnAb-01"


def test_investor_code_preserves_original_case_during_sync():
    item = canonicalize_payload_item("chu_dau_tu", {
        "maChuDauTu": "vn123456789",
        "tenChuDauTu": "Chủ đầu tư thử nghiệm",
    })
    assert item["maChuDauTu"] == "vn123456789"


def test_other_business_identifiers_keep_existing_canonical_behavior():
    assert normalize_business_identifier(" ib-01 ") == "IB-01"
    assert normalize_business_identifier(" VnAb-01 ", preserve_case=True) == "VnAb-01"
