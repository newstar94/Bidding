import pytest

from backend.documents.docx_service import (
    resolve_report_business_date,
    select_effective_partner_version,
)


INVESTOR_VERSIONS = [
    {
        "id": "investor-v1",
        "id_goc": "investor-v1",
        "phien_ban": "01",
        "ngay_ap_dung": "2026-06-11",
    },
    {
        "id": "investor-v2",
        "id_goc": "investor-v1",
        "phien_ban": "02",
        "ngay_ap_dung": "2026-07-11",
    },
    {
        "id": "investor-v3",
        "id_goc": "investor-v1",
        "phien_ban": "03",
        "ngay_ap_dung": "2026-08-11",
    },
]


@pytest.mark.parametrize(
    ("business_date", "expected_id"),
    [
        ("2026-06-20", "investor-v1"),
        ("2026-07-11", "investor-v2"),
        ("2026-07-15T09:00:00", "investor-v2"),
        ("02/08/2026", "investor-v2"),
        ("2026-08-15", "investor-v3"),
        ("2026-10-31", "investor-v3"),
    ],
)
def test_select_effective_partner_version_uses_the_document_business_date(
    business_date,
    expected_id,
):
    selected = select_effective_partner_version(
        INVESTOR_VERSIONS,
        "investor-v1",
        business_date,
    )

    assert selected["id"] == expected_id


def test_select_effective_partner_version_uses_first_version_before_first_date():
    selected = select_effective_partner_version(
        INVESTOR_VERSIONS,
        "investor-v3",
        "2026-01-01",
    )

    assert selected["id"] == "investor-v1"


@pytest.mark.parametrize(
    ("document_type", "expected_date"),
    [
        ("hsmt", "2026-07-11"),
        ("opening", "2026-07-15T09:00:00"),
        ("evaluation", "2026-08-02"),
        ("result", "2026-08-15"),
    ],
)
def test_report_business_date_matches_each_document_milestone(
    document_type,
    expected_date,
):
    package = {
        "ngay_quyet_dinh": "2026-07-11",
        "thoi_gian_mo_thau": "2026-07-15T09:00:00",
        "ngay_quyet_dinh_ket_qua": "2026-08-15",
        "danh_gia_hsdt_metadata": """
            {
              "is1G2T": true,
              "technical": {"ngayBaoCao": "2026-07-28"},
              "financial": {"ngayBaoCao": "2026-08-02"}
            }
        """,
    }

    assert resolve_report_business_date(document_type, package) == expected_date


def test_contract_documents_do_not_reselect_bound_partner_versions():
    package = {
        "ngay_quyet_dinh_ket_qua": "2026-08-15",
        "danh_gia_hsdt_metadata": "{}",
    }

    assert resolve_report_business_date("contract", package) == ""
    assert resolve_report_business_date("liquidation", package) == ""


@pytest.mark.parametrize(
    ("document_type", "expected_date"),
    [
        ("hsmt", "2026-07-11"),
        ("opening", "2026-07-15T09:00:00"),
        ("evaluation", "2026-08-02"),
        ("result", "2026-08-15"),
    ],
)
def test_report_context_passes_its_milestone_to_investor_version_loading(
    monkeypatch,
    document_type,
    expected_date,
):
    from backend.documents import docx_service

    package = {
        "id": "package-1",
        "organization_id": "org-1",
        "ke_hoach_id": "plan-1",
        "id_goc": "package-1",
        "phien_ban": "01",
        "ngay_quyet_dinh": "2026-07-11",
        "thoi_gian_mo_thau": "2026-07-15T09:00:00",
        "ngay_quyet_dinh_ket_qua": "2026-08-15",
        "danh_gia_hsdt_metadata": (
            '{"technical":{"ngayBaoCao":"2026-07-28"},'
            '"financial":{"ngayBaoCao":"2026-08-02"}}'
        ),
    }
    plan = {
        "id": "plan-1",
        "organization_id": "org-1",
        "chu_dau_tu_id": "investor-v1",
    }

    class Cursor:
        def __init__(self):
            self.one = None
            self.many = []

        def execute(self, sql, _params=()):
            normalized = " ".join(str(sql).split())
            self.one = None
            self.many = []
            if normalized.startswith("SELECT * FROM goi_thau WHERE id ="):
                self.one = package
            elif normalized.startswith("SELECT * FROM ke_hoach_lcnt WHERE id ="):
                self.one = plan
            elif "(id_goc = ? OR id = ?)" in normalized and "FROM goi_thau" in normalized:
                self.many = [package]
            return self

        def fetchone(self):
            return self.one

        def fetchall(self):
            return self.many

    class Connection:
        def __init__(self):
            self.cursor_instance = Cursor()

        def cursor(self):
            return self.cursor_instance

        def close(self):
            pass

    captured = []

    def load_investor(_cursor, investor_id, organization_id, business_date):
        captured.append((investor_id, organization_id, business_date))
        return {"id": "selected-investor", "ten_chu_dau_tu": "Chủ đầu tư"}

    monkeypatch.setattr(docx_service.database, "get_connection", Connection)
    monkeypatch.setattr(docx_service, "attach_child_rows", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        docx_service,
        "attach_child_rows_to_items",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(docx_service, "load_plan_versions", lambda *_args: [])
    monkeypatch.setattr(docx_service, "load_effective_investor", load_investor)
    monkeypatch.setattr(
        docx_service,
        "load_current_contracts_for_package",
        lambda *_args: [
            {"id": "contract-appraisal", "phan_loai": "Thẩm định"},
            {"id": "contract-consulting", "phan_loai": "Tư vấn"},
        ],
    )
    monkeypatch.setattr(
        docx_service,
        "project_docx_context",
        lambda _type, context, _capabilities, **_kwargs: context,
    )
    monkeypatch.setattr(
        docx_service,
        "build_detailed_evaluation_context",
        lambda *_args: {},
    )

    context = docx_service.build_report_context(
        "package-1",
        "user-1",
        "org-1",
        document_type,
    )

    assert context["chu_dau_tu"]["id"] == "selected-investor"
    assert [item["id"] for item in context["hop_dong_list"]] == [
        "contract-appraisal",
        "contract-consulting",
    ]
    assert captured == [("investor-v1", "org-1", expected_date)]
