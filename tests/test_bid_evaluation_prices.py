import json

from backend.db.schema import MONEY_COLUMNS, SCHEMA_DINH_NGHIA
from backend.db.upgrades import DB_SCHEMA_VERSION
from backend.sync import mapper
from backend.sync.evaluation_persistence import (
    save_bid_evaluation_result,
    save_evaluation_rounds,
)
from backend.sync.mapper import _attach_bid_evaluation_results
from backend.sync.bid_evaluation_rules import is_inherited_legacy_technical_result
from backend.sync.payload_validation import (
    SYNC_VIRTUAL_FIELDS,
    validate_sync_item,
    validate_sync_payload_shape,
)


class _CaptureCursor:
    def __init__(self):
        self.sql = ""
        self.params = ()

    def execute(self, sql, params=()):
        self.sql = sql
        self.params = params
        return self


class _EvaluationPersistenceCursor:
    def __init__(self):
        self.calls = []

    def execute(self, sql, params=()):
        self.calls.append((sql, params))
        return self

    def fetchall(self):
        return []


class _EvaluationReadCursor:
    def execute(self, _sql, _params=()):
        return self

    def fetchall(self):
        return [{
            "id": "result-1",
            "thong_tin_mo_thau_id": "bid-1",
            "gia_xep_hang": 9_007_199_254_740_993,
            "gia_de_nghi_trung_thau": 9_007_199_254_740_992,
            "chap_thuan_gia_de_nghi_trung_thau_duoi_50": 0,
        }]


def test_schema_and_upgrade_include_bid_evaluation_prices():
    columns = SCHEMA_DINH_NGHIA["ket_qua_danh_gia_nha_thau"]["columns"]
    assert "gia_xep_hang" in columns
    assert "gia_de_nghi_trung_thau" in columns
    assert "chap_thuan_gia_de_nghi_trung_thau_duoi_50" in columns
    assert ("ket_qua_danh_gia_nha_thau", "gia_xep_hang") in MONEY_COLUMNS
    assert ("ket_qua_danh_gia_nha_thau", "gia_de_nghi_trung_thau") in MONEY_COLUMNS
    assert DB_SCHEMA_VERSION >= 21


def test_sync_contract_persists_both_bid_evaluation_prices():
    virtual_fields = SYNC_VIRTUAL_FIELDS["thong_tin_mo_thau"]
    assert {
        "giaXepHang",
        "giaDeNghiTrungThau",
        "chapThuanGiaDeNghiTrungThauDuoi50",
    } <= virtual_fields

    item, errors, _ = validate_sync_item("thong_tin_mo_thau", {
        "giaXepHang": "1200000",
        "giaDeNghiTrungThau": "1150000",
        "chapThuanGiaDeNghiTrungThauDuoi50": False,
    })
    assert errors == []
    assert item["giaXepHang"] == "1200000"
    assert item["giaDeNghiTrungThau"] == "1150000"
    assert item["chapThuanGiaDeNghiTrungThauDuoi50"] is False

    cursor = _CaptureCursor()
    save_bid_evaluation_result(
        cursor,
        "bid-1",
        {
            "goiThauId": "gt-1",
            "giaXepHang": "1200000",
            "giaDeNghiTrungThau": "1150000",
            "chapThuanGiaDeNghiTrungThauDuoi50": False,
        },
        "org-1",
        "organization",
        3,
        "2026-07-27 12:00:00",
    )
    assert "gia_xep_hang" in cursor.sql
    assert "gia_de_nghi_trung_thau" in cursor.sql
    assert "chap_thuan_gia_de_nghi_trung_thau_duoi_50" in cursor.sql
    assert cursor.sql.count("?") == len(cursor.params)
    assert 1200000 in cursor.params
    assert 1150000 in cursor.params


def test_evaluation_persistence_interface_preserves_round_and_criterion_values():
    cursor = _EvaluationPersistenceCursor()
    save_evaluation_rounds(
        cursor,
        "package-1",
        {
            "danhGiaHsdtMetadata": {
                "schemaVersion": 1,
                "is1G2T": True,
                "technical": {
                    "saved": True,
                    "qualifiedSaved": True,
                    "soBaoCao": "BC-01",
                    "ngayBaoCao": "2026-08-18",
                    "criteria": [{
                        "code": "KT-01",
                        "name": "Kỹ thuật",
                        "maxScore": 0,
                        "weight": "12.5",
                        "required": False,
                        "note": "preserved",
                    }],
                },
                "financial": {},
            },
        },
        "org-1",
        "organization",
        7,
        "2026-08-18 10:00:00",
    )

    round_params = [
        params
        for sql, params in cursor.calls
        if "INSERT INTO vong_danh_gia" in sql
    ]
    assert [params[4] for params in round_params] == ["technical", "financial"]
    assert round_params[0][6:11] == (
        "completed",
        "BC-01",
        "2026-08-18",
        1,
        "2026-08-18 10:00:00",
    )

    criterion_params = next(
        params
        for sql, params in cursor.calls
        if "INSERT INTO tieu_chi_danh_gia" in sql
    )
    assert criterion_params[4:11] == (
        "KT-01",
        "Kỹ thuật",
        0.0,
        12.5,
        "technical",
        "pass_fail",
        0,
    )
    assert json.loads(criterion_params[13]) == {
        "note": "preserved",
        "schemaVersion": 1,
    }


def test_mapper_keeps_evaluation_persistence_compatibility_aliases():
    assert mapper._save_evaluation_rounds is save_evaluation_rounds
    assert mapper._save_bid_evaluation_result is save_bid_evaluation_result


def test_sync_payload_shape_accepts_boolean_low_price_decision():
    errors = validate_sync_payload_shape({
        "thongtinmothau": [{
            "id": "bid-1",
            "chapThuanGiaDeNghiTrungThauDuoi50": True,
        }],
        "clientMutationId": "bid-evaluation-shape-test",
    })
    assert errors == []


def test_sync_payload_shape_defers_combined_score_relationship_to_record_validator():
    errors = validate_sync_payload_shape({
        "goithau": [{
            "id": "gt-1",
            "phuongPhapDanhGia": "Kết hợp giữa kỹ thuật và giá",
        }],
        "thongtinmothau": [{
            "id": "bid-1",
            "goiThauId": "gt-1",
            "danhGiaKyThuat": "Đạt",
        }],
        "clientMutationId": "combined-score-shape-test",
    })
    assert errors == []


def test_sync_payload_accepts_numeric_combined_technical_score():
    errors = validate_sync_payload_shape({
        "goithau": [{
            "id": "gt-1",
            "phuongPhapDanhGia": "Kết hợp giữa kỹ thuật và giá",
        }],
        "thongtinmothau": [{
            "id": "bid-1",
            "goiThauId": "gt-1",
            "danhGiaKyThuat": "87",
        }],
        "clientMutationId": "combined-score-shape-test",
    })
    assert errors == []


class _LegacySnapshotCursor:
    def __init__(self, row):
        self.row = row
        self.sql = ""
        self.params = ()

    def execute(self, sql, params=()):
        self.sql = sql
        self.params = params
        return self

    def fetchone(self):
        return self.row


def test_legacy_combined_result_is_allowed_only_as_an_exact_plan_snapshot_copy():
    cursor = _LegacySnapshotCursor((1,))

    assert is_inherited_legacy_technical_result(
        cursor,
        "org-1",
        "package-root",
        0,
        "plan-v01",
        "plan-root",
        "contractor-1",
        "",
        "Đạt",
    ) is True
    assert "source_package.phien_ban = ?" in cursor.sql
    assert cursor.params == (
        "org-1",
        "package-root",
        0,
        "plan-v01",
        "plan-root",
        "Kết hợp giữa kỹ thuật và giá",
        "Kết hợp kỹ thuật và giá",
        "COMBINED_TECHNICAL_PRICE",
        "contractor-1",
        "",
        "Đạt",
    )

    cursor.row = None
    assert is_inherited_legacy_technical_result(
        cursor,
        "org-1",
        "package-root",
        0,
        "plan-v01",
        "plan-root",
        "contractor-1",
        "",
        "Không đạt",
    ) is False

    cursor.row = (1,)
    assert is_inherited_legacy_technical_result(
        cursor,
        "org-1",
        "package-root",
        0,
        "plan-v01",
        "plan-root",
        "contractor-1",
        "",
        "Giá trị cũ không hợp lệ",
    ) is False


def test_sync_rejects_negative_bid_evaluation_prices():
    _, errors, _ = validate_sync_item("thong_tin_mo_thau", {
        "giaXepHang": -1,
        "giaDeNghiTrungThau": -2,
    })
    assert "Giá xếp hạng không được nhỏ hơn 0." in errors
    assert "Giá đề nghị trúng thầu không được nhỏ hơn 0." in errors


def test_sync_accepts_zero_bid_evaluation_prices_as_the_current_validation_rule():
    item, errors, _ = validate_sync_item("thong_tin_mo_thau", {
        "giaXepHang": 0,
        "giaDeNghiTrungThau": 0,
    })
    assert errors == []
    assert item["giaXepHang"] == "0"
    assert item["giaDeNghiTrungThau"] == "0"


def test_sync_allows_an_omitted_low_price_decision_but_validates_it_when_present():
    item, errors, _ = validate_sync_item("thong_tin_mo_thau", {
        "giaDeNghiTrungThau": 400,
    })
    assert errors == []
    assert "chapThuanGiaDeNghiTrungThauDuoi50" not in item


def test_sync_reads_bid_evaluation_prices_as_bigint_safe_strings():
    bids = {"bid-1": {"id": "bid-1"}}
    _attach_bid_evaluation_results(
        _EvaluationReadCursor(),
        bids,
        ["bid-1"],
        "org-1",
        "camel",
    )
    assert bids["bid-1"]["giaXepHang"] == "9007199254740993"
    assert bids["bid-1"]["giaDeNghiTrungThau"] == "9007199254740992"
    assert bids["bid-1"]["chapThuanGiaDeNghiTrungThauDuoi50"] is False


def test_sync_rejects_invalid_low_price_acceptance():
    _, errors, _ = validate_sync_item("thong_tin_mo_thau", {
        "chapThuanGiaDeNghiTrungThauDuoi50": "maybe",
    })
    assert "Lựa chọn xử lý giá đề nghị trúng thầu dưới 50% không hợp lệ." in errors
