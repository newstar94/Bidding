from backend.documents.field_manifest import FIELD_LABELS_BY_TABLE, field_label
from backend.documents.word_defaults import WORD_CONTEXT_MAPPINGS, WORD_SINGLE_SOURCES
from scripts.generate_word_variable_manifest import MANIFEST_PATH, render_manifest


def test_every_default_word_field_has_a_curated_vietnamese_label():
    missing = {
        table_name: [
            column
            for column in columns
            if column not in FIELD_LABELS_BY_TABLE.get(table_name, {})
        ]
        for table_name, columns in WORD_SINGLE_SOURCES.items()
    }
    missing = {table_name: columns for table_name, columns in missing.items() if columns}

    assert missing == {}
    assert all(
        source_column in FIELD_LABELS_BY_TABLE["__context__"]
        for _, source_column, _ in WORD_CONTEXT_MAPPINGS
    )


def test_ambiguous_procurement_terms_use_their_domain_spelling():
    assert field_label("ma_chu_dau_tu", "chu_dau_tu") == "Mã chủ đầu tư"
    assert field_label("ten_chu_dau_tu", "chu_dau_tu") == "Tên chủ đầu tư"
    assert field_label("anh_dau", "nha_thau") == "Ảnh dấu nhà thầu"
    assert field_label("hinh_thuc_lua_chon", "goi_thau") == "Hình thức lựa chọn nhà thầu"
    assert field_label("thoi_gian_thuc_hien", "goi_thau") == "Thời gian thực hiện gói thầu"
    assert field_label("danh_gia_ky_thuat", "thong_tin_mo_thau") == "Đánh giá kỹ thuật"


def test_frontend_word_manifest_is_synchronized():
    source = MANIFEST_PATH.read_text(encoding="utf-8")
    assert render_manifest(source) == source
