"""ADR 0106: letter deadlines are workspace result variables, required at export."""

import asyncio
import json
from io import BytesIO
from types import SimpleNamespace
from zipfile import ZIP_DEFLATED, ZipFile

import pytest
from starlette.datastructures import QueryParams

from backend.documents import document_job_routes
from backend.documents.required_word_variables import (
    REQUIRED_COMPUTED_VARIABLES,
    REQUIRED_VARIABLES_CODE,
    WordRequiredVariablesMissing,
    referenced_required_variables,
    validate_required_word_variables,
)
from backend.documents.word_defaults import build_default_word_mappings


def _template(text):
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr(
            "word/document.xml",
            f'<w:document xmlns:w="urn:test"><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:document>',
        )
    return {"content": output.getvalue(), "filename": "template.docx"}


@pytest.mark.parametrize(
    "text",
    [
        "Nếu đến ngày {ngay_han_hoan_thien_hd} mà",
        "trước 16h00 ngày {S_ngay_han_hoan_thien_hd}",
        "{{ ngay_han_hoan_thien_hd|default('', true) }}",
    ],
)
def test_detects_every_placeholder_syntax(text):
    assert referenced_required_variables([_template(text)]) == {"ngay_han_hoan_thien_hd"}


def test_detects_a_variable_split_across_word_runs():
    output = BytesIO()
    with ZipFile(output, "w") as archive:
        archive.writestr(
            "word/document.xml",
            '<w:document xmlns:w="urn:test"><w:p><w:r><w:t>{ngay_han_</w:t></w:r>'
            '<w:r><w:t>xac_nhan_nl}</w:t></w:r></w:p></w:document>',
        )
    assert referenced_required_variables({"content": output.getvalue()}) == {"ngay_han_xac_nhan_nl"}


def test_similar_names_are_not_required():
    assert referenced_required_variables([_template("{ngay_han_hoan_thien_hd_cu} {ngay_thu_chap_thuan}")]) == set()


def test_missing_variable_blocks_export():
    with pytest.raises(WordRequiredVariablesMissing) as raised:
        validate_required_word_variables(
            [_template("{ngay_han_hoan_thien_hd} {ngay_han_xac_nhan_nl}")],
            [("ten_tvl", "__context__", "ten_nha_thau")],
        )
    assert raised.value.missing == ("ngay_han_hoan_thien_hd", "ngay_han_xac_nhan_nl")


def test_any_workspace_variable_with_the_name_satisfies_the_template():
    validate_required_word_variables(
        [_template("{ngay_han_hoan_thien_hd}")],
        [("NGAY_HAN_HOAN_THIEN_HD", "__computed__", "addDays(ngay_thu_chap_thuan, 10)")],
    )
    validate_required_word_variables(
        [_template("{ngay_han_hoan_thien_hd}")],
        [{"ten_bien": "ngay_han_hoan_thien_hd", "source_table": "__computed__"}],
    )


def test_templates_without_the_variables_and_skipped_resolution_pass():
    validate_required_word_variables([_template("{ten_gt}")], [])
    validate_required_word_variables(None, [])


def test_required_variables_are_not_system_defaults():
    names = {mapping["ten_bien"] for mapping in build_default_word_mappings()}
    assert not names & set(REQUIRED_COMPUTED_VARIABLES)


@pytest.mark.parametrize(
    ("can_configure", "expected"),
    [(True, "Vào Biểu mẫu Word"), (False, "Hãy nhờ quản lý"), (None, "Quản lý của không gian")],
)
def test_payload_tells_who_can_fix_it(can_configure, expected):
    payload = WordRequiredVariablesMissing(["ngay_han_xac_nhan_nl"]).payload(can_configure)
    assert payload["code"] == REQUIRED_VARIABLES_CODE
    assert expected in payload["error"]
    assert "{ngay_han_xac_nhan_nl}" in payload["error"]
    assert payload["missingVariables"] == [{
        "name": "ngay_han_xac_nhan_nl",
        "label": REQUIRED_COMPUTED_VARIABLES["ngay_han_xac_nhan_nl"],
    }]
    assert payload["canConfigure"] is can_configure


@pytest.mark.parametrize("can_manage", [True, False])
def test_package_export_job_returns_structured_warning(monkeypatch, can_manage):
    role = SimpleNamespace(user_id="user-1")
    request = SimpleNamespace(
        path_params={"package_id": "package-1"},
        query_params=QueryParams("type=result&publicationType=x"),
    )
    monkeypatch.setattr(document_job_routes, "verify_session", lambda _request: (True, role))
    monkeypatch.setattr(document_job_routes, "_create_record_access", lambda *_args: ("org-1", None))
    monkeypatch.setattr(document_job_routes, "_validate_export_snapshot", lambda *_args: (1, None))

    def missing(*_args):
        raise WordRequiredVariablesMissing(["ngay_han_hoan_thien_hd"])

    monkeypatch.setattr(document_job_routes, "_prepare_report_render", missing)
    monkeypatch.setattr(
        document_job_routes, "_can_configure_word_variables", lambda *_args: can_manage,
    )

    async def immediate(function, *args, **_kwargs):
        return function(*args)

    monkeypatch.setattr(document_job_routes, "run_database_read", immediate)

    response = asyncio.run(document_job_routes.create_package_export_job_api(request))
    payload = json.loads(response.body)
    assert response.status_code == 422
    assert payload["code"] == REQUIRED_VARIABLES_CODE
    assert payload["canConfigure"] is can_manage
    assert payload["missingVariables"][0]["name"] == "ngay_han_hoan_thien_hd"
