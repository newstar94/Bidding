from backend.db.db_helper import CompatRow
from backend.documents.docx_context_policy import filter_mapping_rows


def test_filter_mapping_rows_accepts_postgres_compat_rows():
    row = CompatRow(
        ("ten_bien", "source_table", "source_column"),
        ("ma_gt", "goi_thau", "ma_goi_thau"),
    )

    assert filter_mapping_rows([row], "result") == [
        ("ma_gt", "goi_thau", "ma_goi_thau")
    ]
