import asyncio
import json
from io import BytesIO
from types import SimpleNamespace
from zipfile import ZIP_DEFLATED, ZipFile

import pytest
from starlette.datastructures import QueryParams

from backend.documents.document_job_routes import create_package_export_job_api
from backend.documents.word_publication_team_policy import (
    WordPublicationTeamWarning,
    referenced_team_roots,
    validate_word_publication_teams,
)


def _template(expression):
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr(
            "word/document.xml",
            f'<w:document xmlns:w="urn:test"><w:p>{expression}</w:p></w:document>',
        )
    return {"content": output.getvalue(), "filename": "template.docx"}


def _leader():
    return [{"chuc_vu": "Tổ trưởng"}]


def test_template_without_team_fields_does_not_require_package_teams():
    validate_word_publication_teams(
        [_template("{{ goi_thau.ten_goi_thau }}")],
        {"to_chuyen_gia": [], "to_tham_dinh": []},
    )


def test_selected_template_team_alias_requires_only_its_source_team():
    template = [_template("{% for member in ds_to_chuyen_gia %}{{ member.ho_ten }}{% endfor %}")]
    mappings = [("ds_to_chuyen_gia", "to_chuyen_gia", "")]

    assert referenced_team_roots(template, mappings) == {"to_chuyen_gia"}
    with pytest.raises(WordPublicationTeamWarning) as captured:
        validate_word_publication_teams(
            template,
            {"to_chuyen_gia": [], "to_tham_dinh": []},
            mappings,
        )
    assert captured.value.code == "DOCUMENT_EXPORT_EXPERT_TEAM_REQUIRED"
    assert captured.value.missing_teams == ("to_chuyen_gia",)


def test_referenced_teams_must_each_have_exactly_one_leader():
    template = [_template("{{ to_chuyen_gia }} {{ to_tham_dinh }}")]

    with pytest.raises(WordPublicationTeamWarning) as captured:
        validate_word_publication_teams(
            template,
            {
                "to_chuyen_gia": [{"chuc_vu": "Tổ viên"}],
                "to_tham_dinh": [],
            },
        )
    assert captured.value.code == "DOCUMENT_EXPORT_TEAMS_REQUIRED"

    validate_word_publication_teams(
        template,
        {"to_chuyen_gia": _leader(), "to_tham_dinh": _leader()},
    )


def test_package_export_job_returns_structured_team_warning(monkeypatch):
    role = SimpleNamespace(user_id="user-1")
    request = SimpleNamespace(
        path_params={"package_id": "package-1"},
        query_params=QueryParams(
            "type=evaluation&publicationType=bid_evaluation_report"
        ),
    )
    monkeypatch.setattr(
        "backend.documents.document_job_routes.verify_session",
        lambda _request: (True, role),
    )
    monkeypatch.setattr(
        "backend.documents.document_job_routes._create_record_access",
        lambda *_args: ("org-1", None),
    )
    monkeypatch.setattr(
        "backend.documents.document_job_routes._validate_export_snapshot",
        lambda *_args: (1, None),
    )

    def warn(*_args):
        raise WordPublicationTeamWarning(["to_chuyen_gia"])

    monkeypatch.setattr(
        "backend.documents.document_job_routes._prepare_report_render", warn,
    )

    async def immediate(function, *args, **_kwargs):
        return function(*args)

    monkeypatch.setattr(
        "backend.documents.document_job_routes.run_database_read", immediate,
    )

    response = asyncio.run(create_package_export_job_api(request))
    payload = json.loads(response.body)

    assert response.status_code == 422
    assert payload["code"] == "DOCUMENT_EXPORT_EXPERT_TEAM_REQUIRED"
    assert payload["missingTeams"] == ["to_chuyen_gia"]
