import json
from pathlib import Path
import subprocess

from backend.db.schema import ROW_VERSION_TABLES, SCHEMA_DINH_NGHIA
from backend.db.upgrades import DB_SCHEMA_VERSION, UPGRADES
from backend.timeline.effective_timeline import build_effective_timeline
from backend.sync.payload_validation import validate_sync_payload_shape


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures" / "timeline_parity.json"


def _projection(row):
    return {
        "milestoneKey": row["milestone_key"],
        "instanceKey": row["instance_key"],
        "displayCode": row["display_code"],
        "title": row["title"],
        "applicability": row["applicability"],
        "applicabilityReason": row["applicability_reason"],
        "sourceEntityId": row["source_entity_id"],
        "effectiveClosingTime": row["effective_closing_time"],
    }


def test_frontend_backend_effective_timeline_parity():
    fixtures = json.loads(FIXTURES.read_text(encoding="utf-8"))
    python_result = [
        {
            "name": fixture["name"],
            "rows": [
                _projection(row)
                for row in build_effective_timeline(
                    fixture.get("package"),
                    fixture.get("related"),
                    fixture.get("savedEntries"),
                )
            ],
        }
        for fixture in fixtures
    ]
    completed = subprocess.run(
        ["node", "scripts/evaluate_timeline_fixtures.mjs", str(FIXTURES)],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    assert json.loads(completed.stdout) == python_result


def test_timeline_schema_and_forward_only_migration():
    timeline_columns = SCHEMA_DINH_NGHIA["goi_thau_moc_tien_do"]["columns"]
    adjustment_columns = SCHEMA_DINH_NGHIA["goi_thau_dieu_chinh_hsmt"]["columns"]
    assert {"milestone_key", "instance_key", "source_entity_id"} <= set(timeline_columns)
    assert {"sequence", "approval_decision_number", "approval_decision_date", "row_version"} <= set(adjustment_columns)
    assert "goi_thau_dieu_chinh_hsmt" in ROW_VERSION_TABLES
    assert DB_SCHEMA_VERSION >= 33
    assert next(item for item in UPGRADES if item.version == 33).name == "add_effective_timeline_model"


def test_appraisal_conflict_is_visible_without_overwriting_user_choice():
    rows = build_effective_timeline(
        {
            "hinh_thuc_lua_chon": "Đấu thầu rộng rãi",
            "phuong_thuc_lua_chon": "Một giai đoạn một túi hồ sơ",
            "yeu_cau_tham_dinh_hsmt_code": "NOT_REQUIRED",
            "so_bao_cao_tham_dinh_hsmt": "01/BCTĐ",
        },
        {"plan": {"phe_duyet": "Kế hoạch"}},
        [],
    )
    appraisal = next(row for row in rows if row["milestone_key"] == "E_HSMT_APPRAISAL_REPORT")
    assert appraisal["applicability"] == "CONDITIONAL"
    assert appraisal["applicability_reason"] == "CONFLICT_E_HSMT_APPRAISAL_DATA"


def test_sync_contract_accepts_stable_timeline_keys_and_adjustments():
    errors = validate_sync_payload_shape({
        "clientMutationId": "timeline-mutation-1",
        "baseSyncVersion": 1,
        "goithau": [{
            "id": "package-1",
            "yeuCauThamDinhHsmtCode": "REQUIRED",
            "timelineItems": [{
                "id": "entry-1",
                "milestoneKey": "E_HSMT_ADJUSTMENT_APPROVAL",
                "instanceKey": "adjustment-1",
                "sourceEntityId": "adjustment-1",
                "maNhom": "IV",
                "tenNhom": "E-HSMT",
                "maMoc": "4.0",
                "congViec": "QĐ phê duyệt điều chỉnh E-HSMT lần 1",
                "sourceMode": "AUTO",
                "trangThai": "DONE",
                "sortOrder": 560,
                "templateVersion": 2,
            }],
            "ehsmtAdjustments": [{
                "id": "adjustment-1",
                "sequence": 1,
                "reason": "Điều chỉnh tiêu chí",
                "approvalDecisionNumber": "01/QĐ",
                "approvalDecisionDate": "2026-05-01",
                "rowVersion": 1,
            }],
        }],
    })
    assert not [error for error in errors if "timeline" in error["field"].casefold() or "ehsmt" in error["field"].casefold()]


def test_latest_bid_closing_time_uses_the_newest_package_or_extension():
    rows = build_effective_timeline(
        {
            "hinh_thuc_lua_chon": "Đấu thầu rộng rãi",
            "phuong_thuc_lua_chon": "Một giai đoạn một túi hồ sơ",
            "yeu_cau_tham_dinh_hsmt_code": "NOT_REQUIRED",
            "thoi_gian_dong_thau": "2026-07-10T10:00:00",
        },
        {
            "plan": {"phe_duyet": "Kế hoạch"},
            "extensions": [
                {"id": "old", "thoi_gian_dong_thau": "2026-07-11T10:00:00"},
                {"id": "new", "thoi_gian_dong_thau": "2026-07-15T10:00:00"},
            ],
        },
        [],
    )
    assert {row["effective_closing_time"] for row in rows} == {"2026-07-15T10:00:00"}


def test_package_version_infers_a_stable_ehsmt_adjustment_for_legacy_data():
    rows = build_effective_timeline(
        {
            "id": "legacy-package-v02",
            "phien_ban": "02",
            "hinh_thuc_lua_chon": "Đấu thầu rộng rãi",
            "phuong_thuc_lua_chon": "Một giai đoạn một túi hồ sơ",
            "yeu_cau_tham_dinh_hsmt_code": "NOT_REQUIRED",
            "so_quyet_dinh": "02/QĐ-ĐC",
            "ngay_quyet_dinh": "2026-07-20",
        },
        {"plan": {"phe_duyet": "Kế hoạch"}},
        [],
    )
    adjustment = next(
        row for row in rows
        if row["milestone_key"] == "E_HSMT_ADJUSTMENT_APPROVAL"
    )
    assert adjustment["instance_key"] == "package-version:legacy-package-v02"
    assert adjustment["title"] == "QĐ phê duyệt điều chỉnh E-HSMT lần 2"
    assert adjustment["so_van_ban"] == "02/QĐ-ĐC"
    assert adjustment["ngay_thuc_te"] == "2026-07-20"
