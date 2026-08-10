import ssl

from backend.contractor_risk.types import ViolationCategory
from backend.integrations.vneps.violation_provider import VnepsViolationProvider
from backend.integrations.vneps.fake_provider import FixtureViolationProvider


class FixtureProvider(VnepsViolationProvider):
    def __init__(self, responses):
        super().__init__()
        self.responses = responses
        self.requests = []

    def _post(self, path, payload):
        self.requests.append((path, payload))
        response = self.responses[path]
        return response(payload) if callable(response) else response


def test_provider_transport_uses_verified_ecdhe_tls_context(monkeypatch):
    captured = {}

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_value, traceback):
            return False

        def read(self, _limit):
            return b"{}"

    def fake_open(_request, *, allowed_hosts, timeout, context):
        captured.update({
            "allowed_hosts": allowed_hosts,
            "timeout": timeout,
            "context": context,
        })
        return Response()

    monkeypatch.setattr(
        "backend.integrations.vneps.violation_provider.open_allowlisted_https",
        fake_open,
    )

    VnepsViolationProvider()._post("get-list-violate", {})

    context = captured["context"]
    assert captured["allowed_hosts"] == {"muasamcong.mpi.gov.vn"}
    assert context.minimum_version == ssl.TLSVersion.TLSv1_2
    assert context.check_hostname is True
    assert context.verify_mode == ssl.CERT_REQUIRED
    assert not any(
        cipher.get("kea") == "kx-dhe" for cipher in context.get_ciphers()
    )


def test_provider_exact_filters_and_maps_all_supported_sources():
    def violation_search(payload):
        category = payload["penType"]
        if category.get("contains") == "CT":
            return {
                "page": {
                    "content": [
                        {
                            "orgCode": "vn001",
                            "idType": "MST",
                            "idNo": "0012345678",
                            "penType": "CD,CT",
                            "effDate": "2026-01-01",
                            "expDate": "2027-01-01",
                            "decisionNo": "BAN-1",
                            "decisionId": "decision-1",
                            "status": "PUBLISH",
                        },
                        {
                            "orgCode": "vn001-extra",
                            "idType": "MST",
                            "idNo": "9999999999",
                            "effDate": "2026-01-01",
                            "expDate": "2027-01-01",
                        },
                    ]
                }
            }
        if category.get("contains") == "CD":
            return {
                "content": [{
                    "orgCode": "vn001",
                    "idType": "MST",
                    "idNo": "0012345678",
                    "issuedDate": "2025-01-01",
                    "methodType": "NTHD_140",
                    "decisionNo": "TERM-1",
                    "status": "PUBLISH",
                }]
            }
        return {
            "content": [{
                "orgCode": "vn001",
                "idType": "MST",
                "idNo": "0012345678",
                "issuedDate": "2025-01-01",
                "decisionNo": "ADMIN-1",
                "status": "PUBLISH",
            }]
        }

    provider = FixtureProvider({
        "get-list-violate": violation_search,
        "get-detail-violation": {
            "violates": [{
                "orgCode": "vn001",
                "idType": "MST",
                "idNo": "0012345678",
                "status": "PUBLISH",
            }]
        },
        "econsign/contractor-reputation-eval/searchContractorPo": {
            "content": [{
                "id": "reputation-1",
                "orgCode": "vn001",
                "documentNo": "REP-1",
                "publicDate": "2026-02-01",
            }]
        },
        "econsign/contractor-reputation-eval/getContractorDetailPo": {
            "contractorInfo": {
                "orgCode": "vn001",
                "behaviorDate": "2025-02-01",
            },
            "evalInfo": {
                "idNo": "0012345678",
                "status": "01",
                "publicDate": "2026-02-01",
            },
        },
    })

    result = provider.lookup(
        contractor_identifier="vn001",
        tax_code="0012345678",
    )

    assert [record.category for record in result.records] == [
        ViolationCategory.BIDDING_BAN,
        ViolationCategory.CONTRACT_TERMINATION_BY_CONTRACTOR_FAULT,
        ViolationCategory.ADMINISTRATIVE_WARNING_OR_OTHER_ACTION,
        ViolationCategory.UNRELIABLE_BID_PARTICIPATION,
    ]
    assert result.records[0].effective_from.isoformat() == "2026-01-01"
    assert result.records[1].requires_review is True
    assert result.records[2].issued_date.isoformat() == "2025-01-01"
    assert result.records[2].requires_review is False
    assert result.records[3].behavior_date.isoformat() == "2025-02-01"
    assert all(record.contractor_identifier == "vn001" for record in result.records)
    other_request = next(
        payload
        for path, payload in provider.requests
        if path == "get-list-violate"
        and payload.get("penType", {}).get("doesNotContain") == "CT"
    )
    assert other_request["penTypeSecondFilter"] == {"doesNotContain": "CD"}


def test_provider_uses_detail_cancellation_and_never_public_date_as_behavior_date():
    provider = FixtureProvider({
        "get-list-violate": {
            "content": [{
                "orgCode": "vn001",
                "decisionId": "decision-1",
                "effDate": "2026-01-01",
                "expDate": "2027-01-01",
                "status": "PUBLISH",
            }]
        },
        "get-detail-violation": {
            "userViolates": [{
                "orgCode": "vn001",
                "status": "CANCEL",
                "decNoCancel": "CANCEL-1",
            }]
        },
        "econsign/contractor-reputation-eval/searchContractorPo": {
            "content": [{
                "id": "reputation-1",
                "orgCode": "vn001",
                "publicDate": "2026-02-01",
            }]
        },
        "econsign/contractor-reputation-eval/getContractorDetailPo": {
            "contractorInfo": {"orgCode": "vn001", "behaviorDate": None},
            "evalInfo": {"status": "01", "publicDate": "2026-02-01"},
        },
    })

    result = provider.lookup(contractor_identifier="vn001")

    bans = [
        record for record in result.records
        if record.category == ViolationCategory.BIDDING_BAN
    ]
    reputation = [
        record for record in result.records
        if record.category == ViolationCategory.UNRELIABLE_BID_PARTICIPATION
    ]
    assert bans[0].is_revoked is True
    assert reputation[0].behavior_date is None


def test_provider_uses_evaluate_id_when_reputation_list_omits_id():
    provider = FixtureProvider({
        "get-list-violate": {"content": []},
        "get-detail-violation": {},
        "econsign/contractor-reputation-eval/searchContractorPo": {
            "content": [{
                "evaluateId": "21959af1-01de-4c64-b5bc-ff2e965492aa",
                "orgCode": "vn001",
                "documentNo": "2910/QĐ-BV",
                "publicDate": "2025-10-01",
            }]
        },
        "econsign/contractor-reputation-eval/getContractorDetailPo": {
            "contractorInfo": {
                "orgCode": "vn001",
                "behaviorDate": "2025-09-24",
            },
            "evalInfo": {
                "status": "01",
                "documentNo": "2910/QĐ-BV",
            },
        },
    })

    result = provider.lookup(contractor_identifier="vn001")

    assert result.records[0].behavior_date.isoformat() == "2025-09-24"
    assert (
        "econsign/contractor-reputation-eval/getContractorDetailPo",
        {"id": "21959af1-01de-4c64-b5bc-ff2e965492aa"},
    ) in provider.requests


def test_provider_does_not_match_same_name_or_identifier_substring():
    provider = FixtureProvider({
        "get-list-violate": {
            "content": [{
                "orgCode": "vn001-extra",
                "orgNameViolate": "Công ty trùng tên",
                "effDate": "2026-01-01",
                "expDate": "2027-01-01",
            }]
        },
        "get-detail-violation": {},
        "econsign/contractor-reputation-eval/searchContractorPo": {
            "content": [{"id": "wrong", "orgCode": "vn001-extra"}]
        },
        "econsign/contractor-reputation-eval/getContractorDetailPo": {},
    })

    result = provider.lookup(contractor_identifier="vn001")
    assert result.records == ()


def test_fixture_provider_exact_matches_without_network():
    provider = FixtureViolationProvider(
        "tests/fixtures/vneps_contractor_violations.json"
    )
    result = provider.lookup(contractor_identifier="vn000000001")
    assert len(result.records) == 1
    assert result.records[0].category == ViolationCategory.BIDDING_BAN
