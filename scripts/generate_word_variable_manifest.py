"""Synchronize the generated default Word-variable array with backend defaults."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.documents.field_manifest import field_label  # noqa: E402
from backend.documents.word_defaults import build_default_word_mappings  # noqa: E402


MANIFEST_PATH = ROOT / "frontend" / "documents" / "wordVariableManifest.js"

LABEL_OVERRIDES = {
    ("ke_hoach_lcnt", "loai_hinh_mua_sam"): "Loại kế hoạch (Dự án / Dự toán mua sắm)",
    ("ke_hoach_lcnt", "tong_muc_dau_tu"): "Tổng mức đầu tư dự án / Tổng dự toán",
    ("goi_thau", "gia_goi_thau"): "Giá gói thầu",
    ("goi_thau", "ngay_moi_doi_chieu"): "Ngày mời đối chiếu tài liệu / thương thảo",
    ("goi_thau", "ngay_doi_chieu"): "Ngày đối chiếu tài liệu / thương thảo",
    ("chuyen_gia", "chuc_vu"): "Chức vụ trong tổ chuyên gia / tổ thẩm định",
    ("chuyen_gia", "cong_viec"): "Công việc được phân công",
}


def build_frontend_defaults():
    result = []
    for mapping in build_default_word_mappings():
        source_table = mapping["source_table"]
        source_column = mapping["source_column"]
        label = LABEL_OVERRIDES.get(
            (source_table, source_column),
            field_label(source_column) if source_column else mapping["mo_ta"],
        )
        result.append(
            {
                "format": mapping.get("format", "text"),
                "label": label,
                "name": mapping["ten_bien"],
                "sourceColumn": source_column,
                "sourceTable": source_table,
            }
        )
    return result


def main():
    source = MANIFEST_PATH.read_text(encoding="utf-8")
    replacement = (
        "export const DEFAULT_WORD_VARIABLES = "
        + json.dumps(build_frontend_defaults(), ensure_ascii=False, indent=2)
        + ";"
    )
    updated, count = re.subn(
        r"export const DEFAULT_WORD_VARIABLES = \[.*?\];\s*$",
        replacement,
        source,
        flags=re.DOTALL,
    )
    if count != 1:
        raise RuntimeError("Could not locate DEFAULT_WORD_VARIABLES in manifest.")
    MANIFEST_PATH.write_text(updated + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
