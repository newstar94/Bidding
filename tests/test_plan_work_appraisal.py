import pytest
from backend.sync.mapper import _save_plan_children
from backend.sync.child_projection import format_plan_child


class Cursor:
    def execute(self, *args):
        pass

    def executemany(self, sql, rows):
        self.rows = rows


def test_appraisal_round_trip():
    cursor = Cursor()
    _save_plan_children(cursor, "plan", {"cvDaThucHienList": [
        {"tenCongViec": "A", "thamDinhGia": True, "soChungThuThamDinhGia": "CT-01"},
        {"tenCongViec": "B", "thamDinhGia": False},
    ]}, "org", "organization", 1, "2026-09-14")
    assert [row[9] for row in cursor.rows] == [1, 0]
    assert cursor.rows[0][10] == "CT-01"
    assert format_plan_child({"tham_dinh_gia": 1}, "camel")["thamDinhGia"] is True
    assert format_plan_child({}, "camel")["thamDinhGia"] is False


def test_multiple_appraisals_rejected():
    with pytest.raises(ValueError):
        _save_plan_children(Cursor(), "plan", {"cvDaThucHienList": [
            {"thamDinhGia": True}, {"thamDinhGia": True},
        ]}, "org", "organization", 1, "2026-09-14")


def test_word_appraisal_context_preserves_complete_list():
    from backend.documents.plan_appraisal_context import build_plan_appraisal_context
    from backend.documents.word_defaults import build_default_word_mappings
    from backend.documents.docx_mapping_service import apply_custom_mappings
    rows = [{"ten_cong_viec": "Other", "tham_dinh_gia": False}, {
        "ten_cong_viec": "Appraisal", "tham_dinh_gia": True,
        "gia_tri": 120000, "don_vi_thuc_hien": "Unit",
        "van_ban_phe_duyet": "HD-01", "so_chung_thu_tham_dinh_gia": "CT-01",
    }]
    context = {"ke_hoach": {"cv_da_thuc_hien": rows}}
    context.update(build_plan_appraisal_context(context["ke_hoach"]))
    mappings = [(m["ten_bien"], m["source_table"], m["source_column"])
                for m in build_default_word_mappings()]
    apply_custom_mappings(context, mappings)
    assert context["tdg_so_chung_thu"] == "CT-01"
    assert context["tdg_gia_tri"] == 120000
    assert len(context["ds_cv_da_thuc_hien"]) == 2
    assert context["ds_cv_da_thuc_hien"][1]["so_chung_thu_tham_dinh_gia"] == "CT-01"
    assert build_plan_appraisal_context({})["tdg_so_chung_thu"] == ""
