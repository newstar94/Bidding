from backend.partners import partner_lookup_service


ACTIVE = "\u0110ang ho\u1ea1t \u0111\u1ed9ng"
TERMINATED = "Ch\u1ea5m d\u1ee9t"
ACTIVE_NAME = "C\u00d4NG TY TNHH MTV TH\u1ecaNH PH\u00c1T TVVL"
TERMINATED_NAME = ACTIVE_NAME + "_CD"


def _stub_detail(monkeypatch, payload):
    monkeypatch.setattr(
        partner_lookup_service,
        "_post_muasamcong_json",
        lambda *_args, **_kwargs: payload,
    )


def test_exact_active_org_code_wins_over_stale_tax_code(monkeypatch):
    _stub_detail(monkeypatch, {
        "orgCode": "vn2100415280",
        "orgFullName": ACTIVE_NAME,
        "taxCode": "2100716104",
        "roleContractorHis": [
            {
                "type": "CHANGE_ROLE_STATUS",
                "value": ACTIVE,
                "createdDate": "2026-07-29T08:44:51.567",
            },
            {
                "type": "CHANGE_ROLE_STATUS",
                "value": TERMINATED,
                "createdDate": "2026-06-15T14:01:34.386",
            },
        ],
    })

    result = partner_lookup_service.fetch_muasamcong_info(
        "2100415280",
        "vn2100415280",
        role_name="NT",
    )

    assert result["org_code"] == "vn2100415280"
    assert result["tax_code"] == "2100716104"
    assert result["name"].casefold() == ACTIVE_NAME.casefold()


def test_terminated_contractor_detail_is_not_selected(monkeypatch):
    _stub_detail(monkeypatch, {
        "orgCode": "vn2100716104",
        "orgFullName": TERMINATED_NAME,
        "taxCode": "2100716104444",
        "roleContractorHis": [
            {
                "type": "CHANGE_ROLE_STATUS",
                "value": TERMINATED,
                "createdDate": "2026-05-25T08:00:00",
            },
        ],
    })

    assert partner_lookup_service.fetch_muasamcong_info(
        "2100716104444",
        "vn2100716104",
        role_name="NT",
    ) is None


def test_muasamcong_partner_fields_are_normalized_before_form_mapping():
    result = partner_lookup_service._build_muasamcong_partner_info(
        {
            "orgCode": " VN 3900786617 ",
            "orgFullName": "  Trung tâm   Y tế Khu vực Tân Châu ",
            "orgShortName": "  TTYT   TC ",
            "orgEnName": "  TAN   CHAU MEDICAL CENTER ",
            "taxCode": " 39.007.866.17 ",
            "repName": "  TRẦN   VIỆT HÙNG ",
            "repPosition": "  GIÁM   ĐỐC ",
            "officeAdd": "  Số 58,  đường   Lê Duẩn ",
            "officeDis": "25516",
            "officePro": "80",
            "officePhone": " (+84) 2763.875052 ",
            "businessType": "  NON_BUSINESS_UNIT ",
        },
        "vn3900786617",
        {"80": " Tỉnh  Tây Ninh ", "25516": " Xã  Tân Châu "},
    )

    assert result["org_code"] == "vn3900786617"
    assert result["tax_code"] == "3900786617"
    assert result["name"] == "Trung tâm Y tế Khu vực Tân Châu"
    assert result["short_name"] == "TTYT TC"
    assert result["english_name"] == "TAN CHAU MEDICAL CENTER"
    assert result["representative_name"] == "Trần Việt Hùng"
    assert result["representative_position"] == "GIÁM ĐỐC"
    assert result["address"] == "Số 58, đường Lê Duẩn, Xã Tân Châu, Tỉnh Tây Ninh"
    assert result["phone"] == "+842763875052"
    assert result["business_type"] == "NON_BUSINESS_UNIT"
    assert result["procurement_data"]["officePhone"] == " (+84) 2763.875052 "
