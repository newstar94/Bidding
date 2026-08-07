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
