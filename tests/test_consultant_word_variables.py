"""ADR 0043: consultant firm (TVL/TVT) as Word variables of package exports."""

import sqlite3
from pathlib import Path

import pytest
from docx import Document

from backend.documents.consultant_context import (
    APPRAISAL_CONSULTANT_ROOT,
    CONSULTANT_FIELDS,
    CONSULTANT_ROOTS,
    PREPARATION_CONSULTANT_ROOT,
    load_consultant_word_context,
    select_consultant_contracts,
)
from backend.documents.custom_exporter import generate_report_from_custom_template
from backend.documents.docx_context_policy import (
    CONTRACT_ROOT_SPECS,
    PLAN_ROOT_SPECS,
    REPORT_ROOT_SPECS,
    collect_authorized_docx_image_paths,
    filter_mapping_rows,
    project_docx_context,
    seal_docx_context,
    validate_docx_context_manifest,
    validate_mapping_definition,
)
from backend.documents.docx_mapping_service import apply_custom_mappings
from backend.documents.field_manifest import FIELD_LABELS_BY_TABLE
from backend.documents.word_defaults import (
    WORD_DEFAULT_MAPPINGS_VERSION,
    build_default_word_mappings,
)
from backend.documents.word_mapping_registry import (
    delete_word_mapping,
    reset_word_mapping,
    resolve_word_mappings,
    save_word_mapping,
)


ROOT = Path(__file__).resolve().parents[1]
ALL_CAPABILITIES = {"financial": True, "identity": True, "signature": True}
EXPECTED_NAMES = {
    "ten_nha_thau": "ten",
    "ten_viet_tat": "ten_tat",
    "ma_so_thue": "mst",
    "nguoi_dai_dien": "dai_dien",
    "chuc_vu_dai_dien": "chuc_vu_dai_dien",
    "danh_xung": "danh_xung",
    "dia_chi": "dia_chi",
    "so_dien_thoai": "sdt",
    "email": "email",
    "so_tai_khoan": "stk",
    "noi_mo_tai_khoan": "noi_mo_tk",
    "ma_ngan_hang": "ma_ngan_hang",
    "anh_dau": "anh_dau",
}
SUFFIX = {PREPARATION_CONSULTANT_ROOT: "tvl", APPRAISAL_CONSULTANT_ROOT: "tvt"}


def _consultant_defaults():
    return [
        row for row in build_default_word_mappings()
        if row["source_table"] in CONSULTANT_ROOTS
    ]


def _mapping_rows():
    return [
        (row["ten_bien"], row["source_table"], row["source_column"])
        for row in _consultant_defaults()
    ]


def _database():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    columns = ", ".join(f"{field} TEXT" for field in CONSULTANT_FIELDS)
    connection.execute(
        f"CREATE TABLE nha_thau (id TEXT, organization_id TEXT, {columns})"
    )
    rows = [
        ("tvl-1", "org", "Công ty Tư vấn Lập A", "TVL A", "0101", "Nguyễn Văn A",
         "Giám đốc", "Ông", "Số 1 Hà Nội", "024111", "a@tv.vn", "111222",
         "BIDV Hà Nội", "01202001", "images/nha_thau/dau-a.png"),
        ("tvl-old", "org", "Công ty Tư vấn Cũ", "", "", "", "", "", "", "", "",
         "", "", "", ""),
        ("tvt-1", "org", "Công ty Thẩm định B", "TĐ B", "0202", "Trần Thị B",
         "Phó Giám đốc", "Bà", "Số 2 Huế", "0234222", "b@td.vn", "333444",
         "Vietcombank Huế", "01203001", ""),
        ("foreign", "other-org", "Công ty tổ chức khác", "", "", "", "", "", "",
         "", "", "999", "", "", ""),
    ]
    placeholders = ", ".join("?" for _ in range(2 + len(CONSULTANT_FIELDS)))
    connection.executemany(f"INSERT INTO nha_thau VALUES ({placeholders})", rows)
    return connection


def _contracts():
    # Loader order: latest version first, then most recently signed.
    return [
        {"id": "hd-khac", "phan_loai": "Khác", "nha_thau_id": "tvt-1"},
        {"id": "hd-tvl-moi", "phan_loai": "Tư vấn", "nha_thau_id": "tvl-1"},
        {"id": "hd-tvt", "phan_loai": "Thẩm định", "nha_thau_id": "tvt-1"},
        {"id": "hd-tvl-cu", "phan_loai": "Tư vấn", "nha_thau_id": "tvl-old"},
    ]


@pytest.fixture
def consultant_context():
    connection = _database()
    try:
        yield load_consultant_word_context(connection.cursor(), "org", _contracts())
    finally:
        connection.close()


def test_every_consultant_field_has_a_named_labeled_default_variable():
    defaults = _consultant_defaults()
    names = [row["ten_bien"] for row in defaults]

    assert WORD_DEFAULT_MAPPINGS_VERSION >= 18
    assert len(defaults) == 2 * len(CONSULTANT_FIELDS) == 26
    assert len(set(names)) == len(names)
    for row in defaults:
        suffix = SUFFIX[row["source_table"]]
        assert row["ten_bien"] == f"{EXPECTED_NAMES[row['source_column']]}_{suffix}"
        assert row["format"] == "text"
        assert row["source_column"] in FIELD_LABELS_BY_TABLE[row["source_table"]]
    assert FIELD_LABELS_BY_TABLE[PREPARATION_CONSULTANT_ROOT]["ten_nha_thau"] == (
        "Tên đơn vị tư vấn lập"
    )
    assert FIELD_LABELS_BY_TABLE[APPRAISAL_CONSULTANT_ROOT]["ma_ngan_hang"] == (
        "Mã ngân hàng (Citad) đơn vị tư vấn thẩm định"
    )
    other_names = {
        row["ten_bien"] for row in build_default_word_mappings()
        if row["source_table"] not in CONSULTANT_ROOTS
    }
    assert not other_names & set(names)


def test_contract_selection_uses_the_timeline_classification():
    selected = select_consultant_contracts(_contracts())
    assert selected[PREPARATION_CONSULTANT_ROOT]["id"] == "hd-tvl-moi"
    assert selected[APPRAISAL_CONSULTANT_ROOT]["id"] == "hd-tvt"

    legacy = select_consultant_contracts([
        {"id": "a", "phan_loai": "Tư vấn thẩm định"},
        {"id": "b", "phanLoai": "TVL"},
    ])
    assert legacy[PREPARATION_CONSULTANT_ROOT]["id"] == "b"
    assert legacy[APPRAISAL_CONSULTANT_ROOT]["id"] == "a"
    assert select_consultant_contracts([{"phan_loai": "Khác"}, None]) == {}


def test_loader_reads_the_contract_contractor_within_the_organization(consultant_context):
    assert set(consultant_context) == set(CONSULTANT_ROOTS)
    preparation = consultant_context[PREPARATION_CONSULTANT_ROOT]
    assert set(preparation) == set(CONSULTANT_FIELDS)
    assert preparation["ten_nha_thau"] == "Công ty Tư vấn Lập A"
    assert preparation["nguoi_dai_dien"] == "Nguyễn Văn A"
    assert consultant_context[APPRAISAL_CONSULTANT_ROOT]["danh_xung"] == "Bà"

    connection = _database()
    try:
        cursor = connection.cursor()
        foreign = load_consultant_word_context(
            cursor, "org", [{"phan_loai": "Tư vấn", "nha_thau_id": "foreign"}]
        )
        missing = load_consultant_word_context(
            cursor, "org", [{"phan_loai": "Thẩm định", "nha_thau_id": ""}]
        )
    finally:
        connection.close()
    assert foreign == {root: {} for root in CONSULTANT_ROOTS}
    assert missing == {root: {} for root in CONSULTANT_ROOTS}


@pytest.mark.parametrize(
    "document_type", ["evaluation", "hsmt", "opening", "result", "contract", "liquidation"]
)
def test_consultant_mappings_pass_every_package_export_contract(document_type):
    rows = _mapping_rows()
    for row in rows:
        validate_mapping_definition(*row, document_type=document_type)
    assert filter_mapping_rows(rows, document_type, ALL_CAPABILITIES) == rows
    assert set(CONSULTANT_ROOTS) <= set(REPORT_ROOT_SPECS)
    assert set(CONSULTANT_ROOTS) <= set(CONTRACT_ROOT_SPECS)


def test_plan_exports_do_not_receive_consultant_firms():
    assert not set(CONSULTANT_ROOTS) & set(PLAN_ROOT_SPECS)
    for row in _mapping_rows():
        with pytest.raises(ValueError):
            validate_mapping_definition(*row, document_type="plan")


def test_bank_and_seal_fields_keep_the_existing_word_capability_gates(consultant_context):
    without = project_docx_context("hsmt", consultant_context, {})
    granted = project_docx_context("hsmt", consultant_context, ALL_CAPABILITIES)

    preparation = without[PREPARATION_CONSULTANT_ROOT]
    assert preparation["ten_nha_thau"] == "Công ty Tư vấn Lập A"
    assert preparation["ma_so_thue"] == "0101"
    assert {"so_tai_khoan", "noi_mo_tai_khoan", "ma_ngan_hang", "anh_dau"}.isdisjoint(preparation)
    assert granted[PREPARATION_CONSULTANT_ROOT]["so_tai_khoan"] == "111222"
    assert granted[PREPARATION_CONSULTANT_ROOT]["anh_dau"] == "images/nha_thau/dau-a.png"
    assert collect_authorized_docx_image_paths(granted, "org") == {"images/nha_thau/dau-a.png"}

    filtered = {row[0] for row in filter_mapping_rows(_mapping_rows(), "hsmt", {})}
    assert "ten_tvl" in filtered and "dai_dien_tvt" in filtered
    assert not {"stk_tvl", "noi_mo_tk_tvt", "ma_ngan_hang_tvl", "anh_dau_tvt"} & filtered


def test_sealed_variables_render_and_respect_capabilities(consultant_context, tmp_path):
    template = Document()
    template.add_paragraph(
        "{ten_tvl} | {danh_xung_tvl} {dai_dien_tvl} - {chuc_vu_dai_dien_tvl} | "
        "TK {stk_tvl} tại {noi_mo_tk_tvl} ({ma_ngan_hang_tvl}) | "
        "{ten_tvt} | MST {mst_tvt}"
    )
    template_path = tmp_path / "tu_van.docx"
    template.save(template_path)

    # The seal image is covered by the projection test; rendering it would need
    # a stored file, so this document only checks the text variables.
    firms = {root: dict(values, anh_dau="") for root, values in consultant_context.items()}

    def render(capabilities):
        rows = _mapping_rows()
        projected = project_docx_context(
            "evaluation",
            {"goi_thau": {"id": "pkg-1"}, **firms},
            capabilities,
            organization_id="org",
        )
        authorized = collect_authorized_docx_image_paths(projected, "org")
        apply_custom_mappings(projected, rows)
        sealed, manifest = seal_docx_context(
            "evaluation", projected, rows, capabilities,
            organization_id="org", authorized_image_paths=authorized,
        )
        validate_docx_context_manifest(sealed, manifest)
        output = generate_report_from_custom_template(str(template_path), sealed, manifest)
        text = "\n".join(paragraph.text for paragraph in Document(output).paragraphs)
        return text, manifest

    text, manifest = render(ALL_CAPABILITIES)
    assert "Công ty Tư vấn Lập A | Ông Nguyễn Văn A - Giám đốc" in text
    assert "TK 111222 tại BIDV Hà Nội (01202001)" in text
    assert "Công ty Thẩm định B | MST 0202" in text
    assert manifest["image_fields"]["anh_dau_tvl"] == "nha_thau"

    text, manifest = render({})
    assert "Công ty Tư vấn Lập A | Ông Nguyễn Văn A - Giám đốc" in text
    assert "111222" not in text and "BIDV" not in text
    assert "anh_dau_tvl" not in manifest["image_fields"]


def _registry_database():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        CREATE TABLE cau_hinh_bien_word (
            id TEXT PRIMARY KEY, organization_id TEXT NOT NULL,
            owner_type TEXT NOT NULL, ten_bien TEXT NOT NULL,
            source_table TEXT NOT NULL, source_column TEXT NOT NULL, mo_ta TEXT,
            UNIQUE(organization_id, ten_bien),
            UNIQUE(organization_id, source_table, source_column)
        );
        CREATE TABLE word_mapping_overrides (
            organization_id TEXT NOT NULL, owner_type TEXT NOT NULL,
            mapping_key TEXT NOT NULL, ten_bien_override TEXT,
            source_table_override TEXT, source_column_override TEXT,
            mo_ta_override TEXT, disabled INTEGER NOT NULL DEFAULT 0,
            base_version INTEGER NOT NULL, created_at TEXT, updated_at TEXT,
            PRIMARY KEY (organization_id, mapping_key)
        );
        """
    )
    return connection


def test_every_scope_lists_the_consultant_variables_and_can_customize_them():
    connection = _registry_database()
    cursor = connection.cursor()

    by_name = {row["ten_bien"]: row for row in resolve_word_mappings(cursor, "org-new")}
    consultant_names = {row["ten_bien"] for row in _consultant_defaults()}
    assert consultant_names <= set(by_name)
    assert {by_name[name]["origin"] for name in consultant_names} == {"system"}

    renamed = save_word_mapping(
        cursor, "org-new", "organization",
        mapping_id=by_name["ten_tvl"]["id"], ten_bien="ten_don_vi_lap",
        source_table=PREPARATION_CONSULTANT_ROOT, source_column="ten_nha_thau",
        mo_ta=None,
    )
    assert renamed["origin"] == "override"
    hidden = delete_word_mapping(cursor, "org-new", "organization", by_name["email_tvt"]["id"])
    assert hidden["action"] == "disabled"

    names = {row["ten_bien"] for row in resolve_word_mappings(cursor, "org-new")}
    assert "ten_don_vi_lap" in names and "ten_tvl" not in names
    assert "email_tvt" not in names

    reset_word_mapping(cursor, "org-new", renamed["id"])
    reset_word_mapping(cursor, "org-new", by_name["email_tvt"]["id"])
    names = {row["ten_bien"] for row in resolve_word_mappings(cursor, "org-new")}
    assert {"ten_tvl", "email_tvt"} <= names
    connection.close()


def test_the_variable_form_offers_both_consultant_groups():
    view = (ROOT / "views" / "tabs" / "tab_bieumau.html").read_text(encoding="utf-8")
    integration = (ROOT / "frontend" / "documents" / "WordIntegration.js").read_text(encoding="utf-8")
    manifest = (ROOT / "frontend" / "documents" / "wordVariableManifest.js").read_text(encoding="utf-8")

    for root, label in (
        (PREPARATION_CONSULTANT_ROOT, "Đơn vị tư vấn lập"),
        (APPRAISAL_CONSULTANT_ROOT, "Đơn vị tư vấn thẩm định"),
    ):
        assert f'<option value="{root}">{label}</option>' in view
        assert f'"{root}": []' in integration
        assert f'{root}: "{label}"' in manifest
