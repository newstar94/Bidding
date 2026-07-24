from __future__ import annotations

import ast
from datetime import date, datetime

import pytest

from backend.documents import docx_bid_context_service as bids
from backend.documents import docx_context_policy as policy
from backend.documents import docx_formula_service as formulas
from backend.documents import docx_mapping_service as mappings


def test_bid_classification_and_display_helpers_cover_all_outcomes():
    assert bids._ensure_list(None) == []
    assert bids._as_text(None) == ""
    assert bids._same_id(" 1 ", 1)
    assert bids._normalize_vietnamese_text("Đạt") == "dat"
    assert bids._is_rank_1("Xếp hạng 1") and bids._is_rank_1("1")
    assert bids._is_not_evaluated_bid({"danh_gia_ket_luan": "Chờ đánh giá"}, {})
    assert bids._is_not_evaluated_bid({}, {"quy_trinh_danh_gia": "quytrinh2"})
    assert bids._is_unqualified_bid({"danh_gia_ky_thuat": "Không đạt"})
    assert bids._is_passed_bid({"danh_gia_ket_luan": "Đạt"})
    assert not bids._is_passed_bid({"danh_gia_ket_luan": "Không đạt"})
    assert bids._is_passed_bid(
        {"danh_gia_hop_le": "Đạt", "danh_gia_nang_luc": "Đạt", "danh_gia_ky_thuat": "Đạt"}
    )
    assert bids._is_winning_bid({"nha_thau_id": "n1"}, {"nha_thau_trung_thau_id": "n1"})
    assert bids._is_winning_bid({"danh_gia_ket_luan": "Đề nghị trúng thầu"}, {})
    assert bids._bid_identity_key({"ma_dinh_danh": "ABC"}) == "abc"
    assert len(bids._dedupe_bids([{"id": 1}, {"id": 2}, {"ma_nha_thau": "x"}, {"ma_nha_thau": "x"}])) == 3
    assert bids._money_text(0) == ""
    assert bids._money_text("not-money") == "not-money"
    shown = bids._bid_display_item(
        {"ten_nha_thau_mt": "Nhà thầu", "ma_dinh_danh": "M1", "gia_du_thau": 1000, "nguyen_nhan_khong_dat_tai_chinh": "Lý do"}
    )
    assert shown["ten_nha_thau"] == "Nhà thầu" and shown["ly_do_truot"] == "Lý do"
    assert bids._strip_private_keys({"ok": 1, "_private": 2}) == {"ok": 1}
    assert bids._strip_private_keys("text") == "text"


def test_enrich_filtered_bidders_classifies_and_deduplicates():
    context = {
        "goi_thau": {"nha_thau_trung_thau_id": "winner"},
        "ds_phan_lo_co_nha_thau_trung": [
            {"ds_nha_thau_trung_thau": [{"ma_nha_thau": "lot-winner"}]},
            "ignored",
        ],
        "nha_thau": [
            {"nha_thau_id": "winner", "ten_nha_thau": "A", "gia_du_thau": 100},
            {"ma_nha_thau": "lot-winner", "ten_nha_thau": "B"},
            {"ma_nha_thau": "failed", "danh_gia_hop_le": "Không đạt"},
            {"ma_nha_thau": "passed", "danh_gia_ket_luan": "Đạt", "danh_gia_tai_chinh": "Xếp hạng 2"},
            {"ma_nha_thau": "pending", "danh_gia_ket_luan": "Không đánh giá"},
            "ignored",
        ],
    }
    bids.enrich_context_with_filtered_bidders(context)
    assert context["tong_so_nha_thau_tham_du"] == 5
    assert context["so_nha_thau_trung_thau"] == 2
    assert context["so_nha_thau_khong_dat"] == 1
    assert context["so_nha_thau_dat_khong_xep_hang_1"] == 1
    assert context["so_nha_thau_khong_duoc_danh_gia"] == 1
    assert all(not any(key.startswith("_") for key in row) for row in context["nha_thau"])


def test_enrich_lot_summaries_handles_empty_and_awarded_lots():
    invalid = {"goi_thau": None}
    bids.enrich_context_with_lot_summaries(invalid)
    assert invalid == {"goi_thau": None}

    empty = {"goi_thau": {}}
    bids.enrich_context_with_lot_summaries(empty)
    assert empty["tong_so_phan_lo"] == 0

    context = {
        "goi_thau": {
            "phan_lo_list": [
                {"ma_phan_lo": "L1", "ten_phan_lo": "Lô 1"},
                {"ma_phan_lo": "L2", "ten_phan_lo": "Lô 2"},
                None,
            ],
            "awarded_phan_lo_list": [
                {"ma_phan_lo": "L1", "nha_thau_trung_thau_id": "n1", "gia_trung_thau": 1500},
                {"ma_phan_lo": "", "nha_thau_trung_thau_id": "ignored"},
            ],
        },
        "nha_thau": [
            {"nha_thau_id": "n1", "ma_phan_lo": "L1", "ten_nha_thau": "A", "gia_du_thau": 1600},
            {"nha_thau_id": "n2", "ma_phan_lo": "L1", "ten_nha_thau": "B"},
            {"nha_thau_id": "n3", "ma_phan_lo": "L3", "ten_nha_thau": "C"},
            {"nha_thau_id": "n4"},
            "ignored",
        ],
    }
    bids.enrich_context_with_lot_summaries(context)
    assert context["tong_so_phan_lo"] == 3
    assert context["so_phan_lo_co_nha_thau_trung"] == 1
    assert context["so_phan_lo_khong_co_nha_thau_tham_du"] == 1
    assert context["so_phan_lo_tham_du_khong_trung"] == 1
    assert context["ds_nha_thau_trung_theo_phan_lo"][0]["so_phan_lo_trung"] == 1


def test_formula_date_number_and_workday_helpers(monkeypatch, tmp_path):
    assert formulas._parse_formula_date(datetime(2026, 1, 2, 3, 4)) == date(2026, 1, 2)
    assert formulas._parse_formula_date(date(2026, 1, 2)) == date(2026, 1, 2)
    assert formulas._parse_formula_date("02/01/2026") == date(2026, 1, 2)
    assert formulas._parse_formula_date("02-01-2026") == date(2026, 1, 2)
    for value in (None, "--", "invalid"):
        with pytest.raises(ValueError):
            formulas._parse_formula_date(value)
    assert formulas._format_formula_date(date(2026, 1, 2)) == "02/01/2026"
    assert formulas._format_formula_date("x") == "x"
    assert formulas._to_number(None) == 0 and formulas._to_number("--") == 0
    assert formulas._to_number("1.234,5 đ") == 1234.5
    assert formulas._to_number("1,5") == 1.5
    assert formulas._to_number("1.234.567") == 1234567

    holidays = {"2026": {"holidays": ["2026-01-05"], "working_weekends": ["2026-01-03"]}}
    assert formulas._is_working_day(date(2026, 1, 3), holidays)
    assert not formulas._is_working_day(date(2026, 1, 4), holidays)
    assert not formulas._is_working_day(date(2026, 1, 5), holidays)
    assert formulas._add_working_days("02/01/2026", 1, holidays) == date(2026, 1, 3)
    assert formulas._add_working_days("05/01/2026", -1, holidays) == date(2026, 1, 3)
    assert formulas._add_working_days("02/01/2026", 0, holidays) == date(2026, 1, 2)
    assert formulas._diff_working_days("02/01/2026", "02/01/2026", holidays) == 0
    assert formulas._diff_working_days("02/01/2026", "06/01/2026", holidays) == 2
    assert formulas._diff_working_days("06/01/2026", "02/01/2026", holidays) == -2

    (tmp_path / "holidays.json").write_text('{"2026": {}}', encoding="utf-8")
    monkeypatch.setattr(formulas, "_project_root", lambda: str(tmp_path))
    assert formulas._load_holidays() == {"2026": {}}
    (tmp_path / "holidays.json").write_text("[]", encoding="utf-8")
    assert formulas._load_holidays() == {}
    (tmp_path / "holidays.json").unlink()
    assert formulas._load_holidays() == {}


@pytest.mark.parametrize(
    ("expression", "expected"),
    [
        ("1 + 2 * 3", 7),
        ("10 / 2", 5),
        ("10 % 3", 1),
        ("-2 + +3", 1),
        ("round(1.25, 1)", 1.2),
        ("ceil(1.2)", 2),
        ("floor(1.8)", 1),
        ("formatNumber(1234)", "1.234"),
        ("formatDate(addDays('2026-01-01', 2))", "03/01/2026"),
        ("formatDate(subtractDays('2026-01-03', 2), 'yyyy-MM-dd')", "2026-01-01"),
        ("if_(2 > 1 and 1 != 2, 'yes', 'no')", "yes"),
        ("1 < 2 <= 2 == 2", True),
        ("1 > 2 or 3 >= 3", True),
    ],
)
def test_safe_formula_evaluator_supported_expressions(expression, expected):
    assert formulas._evaluate_formula(expression, {}, {}) == expected


def test_formula_evaluator_rejects_unsafe_syntax_and_applies_dependencies(monkeypatch):
    for expression in ("missing + 1", "__import__('os')", "[1, 2]", "not 1"):
        with pytest.raises(ValueError):
            formulas._evaluate_formula(expression, {}, {})
    evaluator = formulas._FormulaEvaluator({}, {})
    for node in (
        ast.UnaryOp(op=ast.Not(), operand=ast.Constant(value=True)),
        ast.BinOp(left=ast.Constant(value=1), op=ast.Pow(), right=ast.Constant(value=2)),
        ast.BoolOp(op=ast.BitAnd(), values=[ast.Constant(value=True), ast.Constant(value=True)]),
    ):
        with pytest.raises(ValueError):
            evaluator.visit(node)

    monkeypatch.setattr(formulas, "_load_holidays", lambda: {})
    context = {"base": 2}
    rows = [
        ("first", "__computed__", "{base} + 1"),
        ("second", "__computed__", "first + 1"),
        ("bad", "__computed__", "1 / 0"),
        ("cycle", "__computed__", "missing + 1"),
        ("ignored", "table", "x"),
    ]
    formulas.apply_computed_mappings(context, rows)
    assert context["first"] == 3 and context["second"] == 4
    assert context["bad"].startswith("-- Lỗi công thức")
    assert "vòng lặp" in context["cycle"]


def test_context_projection_filters_private_unsafe_and_sensitive_fields(monkeypatch):
    monkeypatch.setattr(policy, "normalize_managed_image_path", lambda value: str(value or ""))
    contractor = {
        "id": "n1",
        "ten_nha_thau": "A",
        "so_tai_khoan": "secret",
        "anh_dau": "images/nha_thau/stamp.png",
        "_private": "drop",
        "unknown": "drop",
    }
    projected = policy.project_entity("contractor", contractor, {"financial": True, "signature": True})
    assert projected["so_tai_khoan"] == "secret"
    assert projected["anh_dau"] == "images/nha_thau/stamp.png"
    assert "unknown" not in projected and "_private" not in projected
    assert "so_tai_khoan" not in policy.project_entity("contractor", contractor)
    assert policy.project_entity("contractor", None) == {}
    assert policy._sanitize_image_value("anh_dau", "images/chuyen_gia/wrong.png") == ""
    assert policy._sanitize_image_value("anh_dau", "images/nha_thau/nested/file.png") == ""
    assert policy._sanitize_image_value("ordinary", 1) == 1

    assert policy._safe_clone({"ok": date(2026, 1, 1), "_drop": 1, 2: "drop", "list": [object()]}) == {
        "ok": "2026-01-01",
        "list": [None],
    }
    nested = value = {}
    for _ in range(10):
        value["x"] = {}
        value = value["x"]
    assert policy._safe_clone(nested)["x"] is not None


def test_context_projection_mapping_sealing_and_manifest_validation(monkeypatch):
    monkeypatch.setattr(policy, "normalize_managed_image_path", lambda value: str(value or ""))
    context = {
        "ke_hoach": {"id": "p1", "ten_ke_hoach": "Plan"},
        "goi_thau": [{"id": "g1", "ten_goi_thau": "Package"}],
        "today": date(2026, 7, 19),
        "custom_scalar": "value",
        "custom_list": [{"id": "n1", "ten_nha_thau": "A", "secret": "drop"}],
    }
    projected = policy.project_docx_context("plan", context)
    assert projected["today"] == "2026-07-19"
    with pytest.raises(ValueError):
        policy.project_docx_context("unknown", context)
    with pytest.raises(ValueError):
        policy.project_docx_context("plan", [])

    valid_source, valid_column = next(
        (table, next(iter(fields))) for table, fields in policy._SOURCE_FIELDS.items() if table in policy._PLAN_MAPPING_SOURCES
    )
    policy.validate_mapping_definition("custom", valid_source, valid_column, document_type="plan")
    policy.validate_mapping_definition("computed", "__computed__", "1 + 1")
    policy.validate_mapping_definition("ctx", "__context__", next(iter(policy._CONTEXT_SOURCE_FIELDS)))
    policy.validate_mapping_definition("list", next(iter(policy._LIST_ONLY_SOURCES)), "")
    invalid_cases = [
        ("Bad-Name", valid_source, valid_column, None),
        ("ke_hoach", valid_source, valid_column, None),
        ("x", "forbidden", "id", "plan"),
        ("x", "__computed__", "", None),
        ("x", "__context__", "forbidden", None),
        ("x", next(iter(policy._LIST_ONLY_SOURCES)), "id", None),
        ("x", "forbidden", "id", None),
        ("x", valid_source, "forbidden", None),
    ]
    for name, table, column, document_type in invalid_cases:
        with pytest.raises(ValueError):
            policy.validate_mapping_definition(name, table, column, document_type=document_type)

    rows = [
        ("custom_scalar", "__context__", "today"),
        ("custom_list", "nha_thau", ""),
        ("short",),
        ("bad-name", "forbidden", "id"),
    ]
    safe_rows = policy.filter_mapping_rows(rows, "evaluation")
    assert len(safe_rows) == 2
    sealed, manifest = policy.seal_docx_context("evaluation", context, rows)
    assert sealed["custom_scalar"] == "value"
    assert sealed["custom_list"][0]["ten_nha_thau"] == "A"
    validated = policy.validate_docx_context_manifest(sealed, manifest)
    assert validated["allowed_root_keys"] == set(sealed)
    assert policy.sensitive_capability_groups_present({"nested": [{"so_tai_khoan": "x"}]}) == {"financial"}


@pytest.mark.parametrize(
    "mutator",
    [
        lambda c, m: (None, m),
        lambda c, m: (c, None),
        lambda c, m: (c, {**m, "version": 999}),
        lambda c, m: (c, {**m, "document_type": "bad"}),
        lambda c, m: (c, {**m, "root_keys": "bad"}),
        lambda c, m: (c, {**m, "root_keys": m["root_keys"] * 2}),
        lambda c, m: (c, {**m, "custom_root_keys": ["bad-name"]}),
        lambda c, m: (c, {**m, "custom_root_keys": ["ke_hoach"]}),
        lambda c, m: ({**c, "extra": 1}, m),
        lambda c, m: (c, {**m, "root_keys": ["extra"]}),
        lambda c, m: (c, {**m, "image_fields": []}),
        lambda c, m: (c, {**m, "image_fields": {"bad-name": "nha_thau"}}),
        lambda c, m: (c, {**m, "image_fields": {"anh_dau": "wrong"}}),
        lambda c, m: (c, {**m, "image_fields": {"custom": "nha_thau"}}),
    ],
)
def test_manifest_rejects_tampering(mutator):
    context = {"ke_hoach": {"id": "p"}}
    safe, manifest = policy.seal_docx_context("plan", context)
    changed_context, changed_manifest = mutator(safe, manifest)
    with pytest.raises(ValueError):
        policy.validate_docx_context_manifest(changed_context, changed_manifest)


def test_custom_mapping_service_maps_lists_fields_fallbacks_and_identity_codes():
    context = {
        "ke_hoach": {"id": "p", "tong_muc_dau_tu": 1000},
        "nha_thau": [{"ma_nha_thau": "ABC", "gia_du_thau": 2000}],
        "nested": {"custom_source": [{"name": "X"}]},
        "investor_name": "Investor",
        "investor_address": "Address",
        "root_value": 5,
    }
    rows = [
        ("plans", "ke_hoach_lcnt", ""),
        ("customs", "custom_source", ""),
        ("bid_price", "nha_thau", "gia_du_thau"),
        ("root_copy", "__context__", "root_value"),
        ("investor", "chu_dau_tu", "ten_chu_dau_tu"),
        ("address", "chu_dau_tu", "dia_chi"),
        ("missing", "unknown", "field"),
        ("mapped_code", "nha_thau", "ma_nha_thau"),
    ]
    mappings.apply_custom_mappings(context, rows)
    assert context["plans"][0]["id"] == "p"
    assert context["customs"][0]["name"] == "X"
    assert context["bid_price"]
    assert context["root_copy"] == 5
    assert context["investor"] == "Investor" and context["address"] == "Address"
    mappings.lowercase_partner_identity_codes(context, rows)
    assert context["nha_thau"][0]["ma_nha_thau"] == "abc"
    assert context["mapped_code"] == "abc"


def test_custom_mapping_service_keeps_package_and_version_lists_distinct():
    context = {
        "ke_hoach": {"ten_ke_hoach": "Hiện tại"},
        "ke_hoach_versions": [
            {"phien_ban": 0, "ten_ke_hoach": "Bản 0"},
            {"phien_ban": 1, "ten_ke_hoach": "Bản 1"},
        ],
        "goi_thau": {"ten_goi_thau": "Gói hiện tại"},
        "goi_thau_trong_ke_hoach": [{"ten_goi_thau": "Gói trong kế hoạch"}],
        "goi_thau_versions": [
            {"phien_ban": 0, "ten_goi_thau": "Gói bản 0"},
            {"phien_ban": 1, "ten_goi_thau": "Gói bản 1"},
        ],
    }
    rows = [
        ("plan_versions", "ke_hoach_versions", ""),
        ("packages", "goi_thau_trong_ke_hoach", ""),
        ("package_versions", "goi_thau_versions", ""),
        ("mapped_plan_name", "ke_hoach_lcnt", "ten_ke_hoach"),
        ("mapped_package_name", "goi_thau", "ten_goi_thau"),
    ]

    mappings.apply_custom_mappings(context, rows)

    assert len(context["plan_versions"]) == 2
    assert [item["ten_goi_thau"] for item in context["packages"]] == ["Gói trong kế hoạch"]
    assert len(context["package_versions"]) == 2
    assert all("mapped_plan_name" in item for item in context["plan_versions"])
    assert all("mapped_package_name" in item for item in context["package_versions"])


def test_opening_information_list_uses_the_report_bid_collection():
    context = {
        "nha_thau": [
            {"ma_dinh_danh": "NT-1"},
            {"ma_dinh_danh": "NT-2"},
        ]
    }

    mappings.apply_custom_mappings(
        context,
        [("opening_rows", "thong_tin_mo_thau", "")],
    )

    assert [item["ma_dinh_danh"] for item in context["opening_rows"]] == [
        "NT-1",
        "NT-2",
    ]
