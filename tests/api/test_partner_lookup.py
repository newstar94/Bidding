from backend.app import app  # noqa: F401 - initializes backend import paths
from starlette.testclient import TestClient
from backend.partners import address_parser
from backend.partners.address_parser import compose_internal_address
from backend.partners.partner_lookup_service import (
    _build_muasamcong_partner_info,
    fetch_muasamcong_info,
    lookup_partner_info,
    normalize_procurement_org_code,
    request_partner_enrichment,
)


def test_normalizes_supported_procurement_organization_codes():
    assert normalize_procurement_org_code("VN-0201814390") == "vn0201814390"
    assert normalize_procurement_org_code("vnz 0201814390") == "vnz0201814390"
    assert normalize_procurement_org_code("vnp.0201814390") == "vnp0201814390"
    assert normalize_procurement_org_code("NT-ECO") is None


def test_maps_procurement_response_to_partner_lookup_contract():
    raw_data = {
        "orgFullName": "Cong ty TNHH VQN Viet Nam",
        "orgEnName": "Viet Nam VQN Company Limited",
        "orgCode": "vn0201814390",
        "taxCode": "0201814390",
        "officeAdd": "So 133 Ngo Gia Tu",
        "officeDis": "00127",
        "officePro": "01",
        "repName": "Vu Van Tuyen",
        "repPosition": "Chu tich Hoi dong thanh vien",
        "businesses": [{"code": "4299", "main": 1}],
    }

    info = _build_muasamcong_partner_info(
        raw_data,
        "vn0201814390",
        {"00127": "Phuong Viet Hung", "01": "Thanh pho Ha Noi"},
    )

    assert info["name"] == raw_data["orgFullName"]
    assert info["address"] == "So 133 Ngo Gia Tu, Phuong Viet Hung, Thanh pho Ha Noi"
    assert info["representative_name"] == "Vu Van Tuyen"
    assert info["source"] == "MuaSamCong"
    assert info["procurement_data"] == raw_data


def test_removes_repeated_administrative_parts_from_procurement_address():
    raw_data = {
        "orgFullName": "Cong ty tai KCN VSIP",
        "orgCode": "vn0100000000",
        "taxCode": "0100000000",
        "officeAdd": (
            "So 42 VSIP duong so 4, Khu cong nghiep Viet Nam - Singapore-"
            "Phuong Binh Hoa, Thanh pho Ho Chi Minh"
        ),
        "officeDis": "ward-code",
        "officePro": "province-code",
    }

    info = _build_muasamcong_partner_info(
        raw_data,
        "vn0100000000",
        {
            "ward-code": "Phuong Binh Hoa",
            "province-code": "Thanh pho Ho Chi Minh",
        },
    )

    assert info["address"] == (
        "So 42 VSIP duong so 4, Khu cong nghiep Viet Nam - Singapore, "
        "Phuong Binh Hoa, Thanh pho Ho Chi Minh"
    )
    assert info["address"].count("Phuong Binh Hoa") == 1
    assert info["address"].count("Thanh pho Ho Chi Minh") == 1


def test_internal_address_keeps_ward_and_province_once():
    address = compose_internal_address(
        "So 42 VSIP duong so 4-Phuong Binh Hoa, Thanh pho Ho Chi Minh",
        "Phuong Binh Hoa",
        "Thanh pho Ho Chi Minh",
    )

    assert address == (
        "So 42 VSIP duong so 4 | Phuong Binh Hoa | Thanh pho Ho Chi Minh"
    )


def test_parses_address_without_vietnam_country_suffix(monkeypatch):
    monkeypatch.setattr(
        address_parser,
        "_PROVINCES_CACHE",
        [{"name": "Thành phố Hồ Chí Minh", "code": 79}],
    )
    monkeypatch.setattr(
        address_parser,
        "_WARDS_CACHE",
        {79: [{"name": "Phường Gò Vấp", "code": 26884}]},
    )

    parsed = address_parser.parse_vietnam_address_to_internal(
        "86/11 Thống Nhất, Phường Gò Vấp, Thành phố Hồ Chí Minh, Việt Nam"
    )

    assert parsed == (
        "86/11 Thống Nhất | Phường Gò Vấp | Thành phố Hồ Chí Minh"
    )


def test_maps_contractor_representative_fields_and_trims_source_whitespace():
    raw_data = {
        "orgFullName": "CÔNG TY TNHH TƯ VẤN VÀ ĐẦU TƯ THƯƠNG MẠI HCP",
        "orgCode": "vn0109965278",
        "taxCode": "0109965278",
        "repName": "ĐỖ VĂN XỨNG ",
        "repPosition": " Giám đốc ",
    }

    info = _build_muasamcong_partner_info(raw_data, "vn0109965278")

    assert info["representative_name"] == "Đỗ Văn Xứng"
    assert info["representative_position"] == "Giám đốc"


def test_investor_lookup_uses_investor_endpoint_and_enriches_address(monkeypatch):
    calls = []
    raw_data = {
        "orgFullName": "Van phong HDND va UBND xa Hoang Thanh",
        "orgCode": "vnz000050923",
        "taxCode": None,
        "officeAdd": "44, Thon Lien Ha",
        "officePro": "38",
        "officeDis": "16000",
        "officeWar": None,
        "repName": "Le Thi Mao",
        "repPosition": "Pho chanh Van phong",
    }

    def fake_post(endpoint, payload, timeout=8, service_base=""):
        calls.append((endpoint, payload, service_base))
        return {"orgInfo": raw_data}

    area_names = {"38": "Tinh Thanh Hoa", "16000": "Xa Hoang Thanh"}
    monkeypatch.setattr("backend.partners.partner_lookup_service._post_muasamcong_json", fake_post)
    monkeypatch.setattr(
        "backend.partners.partner_lookup_service._fetch_muasamcong_area_name",
        lambda code, _service_base: area_names.get(code, ""),
    )

    info = fetch_muasamcong_info("000050923", "vnz000050923", role_name="CDT")

    assert calls[0][0] == "um/org/get-detail-info"
    assert "investor-approved-v2" in calls[0][2]
    assert info["name"] == raw_data["orgFullName"]
    assert info["org_code"] == "vnz000050923"
    assert info["tax_code"] == ""
    assert info["address"] == "44, Thon Lien Ha, Xa Hoang Thanh, Tinh Thanh Hoa"
    assert info["representative_name"] == "Le Thi Mao"
    assert info["representative_position"] == "Pho chanh Van phong"


def test_lookup_prefers_muasamcong_before_vietqr(monkeypatch):
    calls = []

    def fake_muasamcong(tax_code, org_code, role_name="NT"):
        calls.append(("muasamcong", tax_code, org_code, role_name))
        return {"name": "Procurement company", "source": "MuaSamCong"}

    def fail_vietqr(_tax_code):
        raise AssertionError("VietQR must not run when MuaSamCong succeeds")

    monkeypatch.setattr(
        "backend.partners.partner_lookup_service.fetch_muasamcong_info",
        fake_muasamcong,
    )
    monkeypatch.setattr(
        "backend.partners.partner_lookup_service.fetch_vietqr_info",
        fail_vietqr,
    )

    info = lookup_partner_info("0201814390", role_name="CDT")

    assert info["source"] == "MuaSamCong"
    assert calls == [("muasamcong", "0201814390", "vn0201814390", "CDT")]


def test_org_code_lookup_does_not_derive_or_fallback_tax_code(monkeypatch):
    calls = []

    def fake_muasamcong(tax_code, org_code, role_name="NT"):
        calls.append((tax_code, org_code, role_name))
        return {
            "name": "No-tax organization",
            "org_code": org_code,
            "tax_code": "",
            "source": "MuaSamCong",
        }

    monkeypatch.setattr(
        "backend.partners.partner_lookup_service.fetch_muasamcong_info",
        fake_muasamcong,
    )

    info = lookup_partner_info("", org_code="vnz000050923", role_name="CDT")

    assert info["tax_code"] == ""
    assert calls == [("", "vnz000050923", "CDT")]


def test_explicit_org_code_never_falls_back_to_tax_only_source(monkeypatch):
    calls = []

    def empty_muasamcong(tax_code, org_code, role_name="NT"):
        calls.append(("muasamcong", tax_code, org_code, role_name))
        return None

    def fail_vietqr(_tax_code):
        raise AssertionError("Tax-only fallback must not replace an explicit MuaSamCong record")

    monkeypatch.setattr(
        "backend.partners.partner_lookup_service.fetch_muasamcong_info",
        empty_muasamcong,
    )
    monkeypatch.setattr(
        "backend.partners.partner_lookup_service.fetch_vietqr_info",
        fail_vietqr,
    )

    info = lookup_partner_info(
        "3002293646",
        org_code="vn3000166995",
        role_name="CDT",
    )

    assert info is None
    assert calls == [("muasamcong", "3002293646", "vn3000166995", "CDT")]


def test_lookup_api_accepts_org_code_without_tax_code(monkeypatch):
    calls = []

    def fake_lookup(tax_code="", org_code=None, role_name="NT"):
        calls.append((tax_code, org_code, role_name))
        return {
            "name": "Procurement organization",
            "org_code": org_code,
            "tax_code": "",
            "source": "MuaSamCong",
        }

    monkeypatch.setattr(
        "backend.partners.partner_lookup_service.lookup_partner_info",
        fake_lookup,
    )

    with TestClient(app) as client:
        response = client.get(
            "/api/lookup-tax-code?orgCode=vnz000050923&role=CDT"
        )

    assert response.status_code == 200
    assert response.json()["tax_code"] == ""
    assert calls == [("", "vnz000050923", "CDT")]


def test_lookup_falls_back_to_vietqr_after_muasamcong(monkeypatch):
    calls = []

    def empty_muasamcong(*_args, **_kwargs):
        calls.append("muasamcong")
        return None

    def fake_vietqr(_tax_code):
        calls.append("vietqr")
        return {"name": "Fallback company", "source": "VietQR"}

    monkeypatch.setattr(
        "backend.partners.partner_lookup_service.fetch_muasamcong_info",
        empty_muasamcong,
    )
    monkeypatch.setattr(
        "backend.partners.partner_lookup_service.fetch_vietqr_info",
        fake_vietqr,
    )

    info = lookup_partner_info("0201814390")

    assert info["source"] == "VietQR"
    assert calls == ["muasamcong", "vietqr"]


def test_background_enrichment_is_started_and_woken_only_on_request(monkeypatch):
    calls = []

    class FakeEvent:
        def set(self):
            calls.append("wake")

    monkeypatch.setattr("backend.partners.partner_lookup_service.start_partner_background_service", lambda: calls.append("start"))
    monkeypatch.setattr("backend.partners.partner_lookup_service._partner_work_event", FakeEvent())

    request_partner_enrichment()

    assert calls == ["start", "wake"]
