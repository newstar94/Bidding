import json
from pathlib import Path

import pytest

from backend.integrations.muasamcong_browser.canonical import normalize_opening_bundle
from backend.integrations.muasamcong_browser.procurement_source import MuaSamCongProcurementSource
from backend.integrations.muasamcong_browser.launchers import NodeBrowserRuntime


FIXTURES = Path(__file__).parent / "fixtures/muasamcong/opening/financial"


@pytest.mark.parametrize("name,opened,prices", [
    ("consulting", "2026-09-29T08:45:34", {None: 4374840000}),
    ("goods_lots", "2025-12-31T15:10:51", {
        "PP2500456845": 2502500000, "PP2500456846": 1820000000,
        "PP2500456847": 8960000000, "PP2500456848": 3050000000,
        "PP2500456849": 2668750000, "PP2500456850": 2550000000,
    }),
])
def test_supplied_financial_har_maps_phase_time_and_exact_lot_prices(name, opened, prices):
    fixture = json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))
    request = fixture["request"]
    opening = normalize_opening_bundle(
        fixture["raw"], notice_no=request["notifyNo"], revision_id=request["notifyId"],
    )
    assert opening["financialOpeningAt"] == opened
    assert opening["partial"] is False
    assert {bid["lotNo"]: bid["bidPrice"] for bid in opening["bidders"]} == prices
    for bid in opening["bidders"]:
        assert bid["phase"] == "FINANCIAL"
        assert bid["priceAfterDiscount"] == prices[bid["lotNo"]]
        assert bid["discountRate"] == 0
        assert bid["bidValidityDays"] == 90
    assert {lot["lotNo"] for lot in opening["lots"]} == (set(prices) - {None})


def test_financial_round_does_not_use_technical_completion_or_scheduled_time():
    opening = normalize_opening_bundle({"opening_round_2": {
        "bidoBidroundMngViewDTO": {
            "successBidOpenDate": "2026-09-17T08:28:31",
            "bidOpenDate": "2026-09-17T08:00:00",
        },
    }}, notice_no="IB2600512536", revision_id="revision")
    assert opening["financialOpeningAt"] is None


def test_financial_lot_prices_do_not_use_award_values_or_distribute_summary_discount():
    fixture = json.loads((FIXTURES / "goods_lots.json").read_text(encoding="utf-8"))
    raw = fixture["raw"]
    summary = raw["opening_bid_2"]["bidSubmissionByContractorViewResponse"]["bidSubmissionDTOList"][0]
    summary["saleNumber"] = 5
    for row in raw["opening_lot_detail_2"]:
        row["succBidderPrice"] = 1
    opening = normalize_opening_bundle(raw, notice_no="IB2500426513", revision_id="revision")
    assert len(opening["bidders"]) == 6
    assert all(bid["discountRate"] is None for bid in opening["bidders"])
    assert all(bid["bidPrice"] == bid["priceAfterDiscount"] > 1 for bid in opening["bidders"])


def test_financial_opening_uses_bid_created_time_when_round_completion_is_missing():
    fixture = json.loads((FIXTURES / "consulting.json").read_text(encoding="utf-8"))
    fixture["raw"]["opening_round_2"]["bidoBidroundMngViewDTO"]["successBidOpenDateTc"] = None
    opening = normalize_opening_bundle(fixture["raw"], notice_no="IB2600512536", revision_id="revision")
    assert opening["financialOpeningAt"] == "2026-09-29T08:45:33.346"


def test_financial_phase_crosses_source_and_worker_request_without_changing_default():
    fixture = json.loads((FIXTURES / "consulting.json").read_text(encoding="utf-8"))
    request = fixture["request"]
    calls = []

    class Runtime:
        def get_opening_bundle(self, notice_no, revision_id, **options):
            calls.append(options)
            return {"raw": fixture["raw"], "failures": [], "bidMode": "1_HTHS", "processApply": "LDT",
                    "fingerprint": "opening:v1:har"}

    source = MuaSamCongProcurementSource(Runtime())
    source._notice_revisions[request["notifyNo"]] = {
        request["notifyId"]: {"revisionNumber": "00"},
    }
    opening = source.get_opening_bundle(request["notifyNo"], request["notifyId"], opening_phase="FINANCIAL")
    assert opening["financialOpeningAt"] == "2026-09-29T08:45:34"
    source.get_opening_bundle(request["notifyNo"], request["notifyId"])
    assert calls == [{"opening_phase": "FINANCIAL"}, {}]
    runtime = object.__new__(NodeBrowserRuntime)
    runtime._exchange = lambda operation, **fields: (operation, fields)
    assert runtime.get_opening_bundle("notice", "rev", opening_phase="FINANCIAL") == (
        "getOpeningBundle", {"noticeNo": "notice", "revisionId": "rev", "openingPhase": "FINANCIAL"},
    )
    assert runtime.get_opening_bundle("notice", "rev") == (
        "getOpeningBundle", {"noticeNo": "notice", "revisionId": "rev"},
    )
