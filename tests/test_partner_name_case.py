from backend.partners.name_case import normalize_procurement_partner_name


def test_all_uppercase_partner_name_is_cased_without_changing_words_or_acronyms():
    assert normalize_procurement_partner_name(
        "CÔNG TY TNHH DƯỢC PHẨM THANH PHƯỢNG"
    ) == "Công ty TNHH Dược phẩm Thanh Phượng"


def test_mixed_case_and_source_spacing_are_preserved():
    value = "Công ty TNHH ABC"
    assert normalize_procurement_partner_name(value) == value
    assert normalize_procurement_partner_name("CÔNG TY 123 ABC") == "Công ty 123 Abc"
    assert normalize_procurement_partner_name("CÔNG TY TNHH DƯỢC PHẨM SANTA VIỆT NAM") == "Công ty TNHH Dược phẩm Santa Việt Nam"
