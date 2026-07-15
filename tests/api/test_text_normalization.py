from backend.shared.text_utils import normalize_organization_name


def test_normalizes_uppercase_organization_and_geographic_name():
    assert normalize_organization_name(
        "TRUNG TÂM CUNG ỨNG DỊCH VỤ CÔNG XÃ MƯỜNG HAM"
    ) == "Trung tâm cung ứng dịch vụ công xã Mường Ham"


def test_preserves_acronyms_and_intentional_mixed_case():
    assert normalize_organization_name(
        "CÔNG TY TNHH MTV DỊCH VỤ AN PHÁT"
    ) == "Công ty TNHH MTV dịch vụ an phát"
    assert normalize_organization_name(
        "Công ty TNHH Dịch vụ An Phát"
    ) == "Công ty TNHH Dịch vụ An Phát"

