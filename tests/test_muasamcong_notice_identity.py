"""Prevent a current MSC notice body from being relabelled as an older revision."""

from copy import deepcopy
import json

import pytest

from backend.integrations.muasamcong_browser.canonical import (
    normalize_notice_complete_bundle,
    normalize_notice_revision,
)
from backend.procurement_import.source import ProcurementSourceError


NOTICE_NO = "IB2600493339"
REVISION_IDS = {
    "00": "3a8a45a8-adb2-474d-bc57-e38cb8959cf3",
    "01": "bb78355e-90b4-416a-97a7-929cd64acaca",
    "02": "217db3f1-9b19-4c93-a9e8-be3acc456da9",
}


def observed_notice_detail():
    # Only the identity/date fields from the supplied response are needed here.
    return {
        "bidoNotifyContractorM": {
            "id": REVISION_IDS["02"],
            "notifyNo": NOTICE_NO,
            "notifyVersion": "02",
            "processApply": "LDT",
            "bidMode": "1_MTHS",
            "planNo": "PL2600275637",
            "publicDate": "2026-10-01T22:01:21.368",
            "bidCloseDate": "2026-10-12T09:00:00",
            "delayDTOList": None,
            "getVersionDTOS": [
                {"id": revision_id, "version": version}
                for version, revision_id in reversed(REVISION_IDS.items())
            ],
        },
        "bidpPlanDetail": {
            "planVersion": "01",
            "linkNotifyInfo": json.dumps({
                "notifyNo": NOTICE_NO,
                "notifyVersion": "00",
                "notifyId": REVISION_IDS["00"],
            }),
        },
        "biduClarifyReqInvAndContentViewList": None,
    }


def normalize(raw, *, version="02", revision_id=None):
    return normalize_notice_revision(
        raw, notice_no=NOTICE_NO,
        revision_id=revision_id or REVISION_IDS[version], revision_number=version,
    )


def test_actual_02_ignores_stale_plan_link_and_plan_version():
    row = normalize(observed_notice_detail())
    assert row["revisionNumber"] == "02"
    assert row["revisionId"] == row["notifyId"] == REVISION_IDS["02"]
    assert row["bidClosingAt"] == "2026-10-12T09:00:00"


@pytest.mark.parametrize("version", ["00", "01"])
def test_actual_02_cannot_be_relabelled_as_requested_older_revision(version):
    with pytest.raises(ProcurementSourceError, match="PROCUREMENT_REVISION_INVALID"):
        normalize(observed_notice_detail(), version=version)


@pytest.mark.parametrize("field", ["id", "notifyId"])
def test_explicit_notice_identity_must_match_even_when_version_is_02(field):
    raw = observed_notice_detail()
    raw["bidoNotifyContractorM"][field] = REVISION_IDS["01"]
    with pytest.raises(ProcurementSourceError, match="PROCUREMENT_REVISION_INVALID"):
        normalize(raw)


def test_legacy_response_without_revision_fields_keeps_existing_compatibility():
    raw = observed_notice_detail()
    del raw["bidoNotifyContractorM"]["id"]
    del raw["bidoNotifyContractorM"]["notifyVersion"]
    assert normalize(raw)["revisionNumber"] == "02"


@pytest.mark.parametrize("version", ["00", "01"])
def test_complete_raw_bundle_cannot_mix_02_notice_with_older_clarification_group(version):
    bundle = {
        "schemaVersion": "biddingflow-muasamcong-raw-bundle-v2",
        "detailLevel": "COMPLETE",
        "entity": {"kind": "NOTICE", "noticeNo": NOTICE_NO},
        "revisions": {version: {
            "revisionId": REVISION_IDS[version],
            "sources": {"noticeDetail": {
                "success": True,
                "operation": "NOTICE_LDT_DETAIL",
                "response": deepcopy(observed_notice_detail()),
            }},
        }},
    }
    with pytest.raises(ProcurementSourceError, match="PROCUREMENT_REVISION_INVALID"):
        normalize_notice_complete_bundle(bundle)
