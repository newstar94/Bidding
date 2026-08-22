from pathlib import Path
from io import BytesIO
import asyncio
import re
from types import SimpleNamespace
from zipfile import ZipFile

import pytest
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from backend.documents import custom_exporter
from backend.documents.routes_docx import (
    _delete_scoped_template,
    _prepare_report_render,
    _render_word_selection,
    _resolve_publication_template_paths,
    _update_scoped_template,
    _word_publication_assignment_payload,
    get_word_publication_template_assignments_api,
    save_word_publication_template_assignments_api,
)
from backend.documents.word_publication_policy import (
    DIRECT_APPOINTMENT_SHORTENED,
    ONE_STAGE_ONE_ENVELOPE,
    ONE_STAGE_TWO_ENVELOPE,
    SPECIAL_SELECTION,
    WORD_PUBLICATION_DOCUMENTS,
    is_word_publication_document_applicable,
)


@pytest.fixture
def template_root(tmp_path, monkeypatch):
    monkeypatch.setattr(custom_exporter, "TEMPLATE_DIR", str(tmp_path))
    return tmp_path


def _template(owner_type, owner_id, filename, content=b"docx"):
    scope = Path(custom_exporter.get_scope_template_dir(owner_type, owner_id))
    path = scope / filename
    path.write_bytes(content)
    return path


def _configure_api(monkeypatch, organization_id="org-a"):
    monkeypatch.setattr(
        "backend.documents.routes_docx.verify_session",
        lambda _request: (True, SimpleNamespace(user_id="user-a")),
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx._word_config_access_response",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx.get_active_org",
        lambda *_args: organization_id,
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx.log_audit",
        lambda *_args, **_kwargs: None,
    )


def _api_client():
    return TestClient(Starlette(routes=[
        Route(
            "/api/word-publication-template-assignments",
            get_word_publication_template_assignments_api,
            methods=["GET"],
        ),
        Route(
            "/api/word-publication-template-assignments",
            save_word_publication_template_assignments_api,
            methods=["PUT"],
        ),
    ]))


def test_active_template_updates_preserve_explicit_assignments(template_root):
    _template("organization", "org-a", "main.docx")
    _template("organization", "org-a", "consultant.docx")
    custom_exporter.set_template_assignments(
        {"consultant_evaluation_step_1": "consultant.docx"},
        "org-a",
        owner_type="organization",
    )

    custom_exporter.set_active_template(
        "main.docx",
        "org-a",
        owner_type="organization",
    )
    assert custom_exporter.get_template_assignments(
        "org-a",
        owner_type="organization",
    ) == {"consultant_evaluation_step_1": ["consultant.docx"]}


def test_multiple_templates_can_be_assigned_to_one_publication_function(template_root):
    _template("organization", "org-a", "cover.docx")
    _template("organization", "org-a", "decision.docx")

    custom_exporter.set_template_assignments(
        {"procurement_plan": ["cover.docx", "decision.docx", "cover.docx"]},
        "org-a",
        owner_type="organization",
    )

    assert custom_exporter.get_template_assignments(
        "org-a",
        owner_type="organization",
    ) == {"procurement_plan": ["cover.docx", "decision.docx"]}
    assert custom_exporter.resolve_publication_templates(
        "procurement_plan",
        "org-a",
        owner_type="organization",
    ) == (["cover.docx", "decision.docx"], "assignment")


def test_disabled_assigned_template_is_not_resolved_for_publication(template_root):
    _template("organization", "org-a", "enabled.docx")
    _template("organization", "org-a", "paused.docx")
    custom_exporter.set_template_assignments(
        {"procurement_plan": ["enabled.docx", "paused.docx"]},
        "org-a",
        owner_type="organization",
    )
    custom_exporter.set_template_enabled(
        "paused.docx",
        False,
        "org-a",
        owner_type="organization",
    )

    assert custom_exporter.resolve_publication_templates(
        "procurement_plan",
        "org-a",
        owner_type="organization",
    ) == (["enabled.docx"], "assignment")
    payload = _word_publication_assignment_payload("organization", "org-a")
    assert payload["assignmentSets"]["procurement_plan"] == ["enabled.docx"]
    assert payload["resolvedTemplateSets"]["procurement_plan"] == [{
        "filename": "enabled.docx",
        "source": "assignment",
    }]
    with pytest.raises(ValueError, match="không được gán"):
        _resolve_publication_template_paths(
            "organization",
            "org-a",
            "procurement_plan",
            ["paused.docx"],
        )


def test_assignment_api_rejects_template_that_is_not_enabled(
    template_root,
    monkeypatch,
):
    _configure_api(monkeypatch)
    _template("organization", "org-a", "paused.docx")
    custom_exporter.set_template_enabled(
        "paused.docx",
        False,
        "org-a",
        owner_type="organization",
    )

    response = _api_client().put(
        "/api/word-publication-template-assignments",
        json={"assignmentSets": {"procurement_plan": ["paused.docx"]}},
    )

    assert response.status_code == 400
    assert custom_exporter.get_template_assignments(
        "org-a",
        owner_type="organization",
    ) == {}


def test_multiple_assigned_templates_render_into_one_zip_download(monkeypatch):
    async def fake_render(_job_type, payload):
        return Path(payload["template_path"]).name.encode("utf-8")

    monkeypatch.setattr(
        "backend.documents.routes_docx.run_document_job_async",
        fake_render,
    )
    content, media_type, filename, count = asyncio.run(_render_word_selection(
        [
            {"path": "first.docx", "filename": "1. Tờ trình.docx"},
            {"path": "second.docx", "filename": "2. Quyết định.docx"},
        ],
        {"ke_hoach": {}},
        {},
        fallback_filename="Ke_hoach_LCNT_KH-01.docx",
    ))

    assert media_type == "application/zip"
    assert filename == "Ke_hoach_LCNT_KH-01.zip"
    assert count == 2
    with ZipFile(BytesIO(content)) as archive:
        assert archive.namelist() == ["1. Tờ trình.docx", "2. Quyết định.docx"]


def test_publication_export_selection_is_filtered_in_assignment_order(template_root):
    cover = _template("organization", "org-a", "cover.docx")
    decision = _template("organization", "org-a", "decision.docx")
    report = _template("organization", "org-a", "report.docx")
    custom_exporter.set_template_assignments(
        {
            "procurement_plan": [
                "cover.docx",
                "decision.docx",
                "report.docx",
            ],
        },
        "org-a",
        owner_type="organization",
    )

    all_targets = _resolve_publication_template_paths(
        "organization",
        "org-a",
        "procurement_plan",
    )
    selected_targets = _resolve_publication_template_paths(
        "organization",
        "org-a",
        "procurement_plan",
        ["report.docx", "cover.docx", "report.docx"],
    )

    assert [Path(target["path"]) for target in all_targets] == [
        cover,
        decision,
        report,
    ]
    assert [Path(target["path"]) for target in selected_targets] == [
        cover,
        report,
    ]


def test_publication_export_selection_rejects_empty_or_unassigned_templates(
    template_root,
):
    _template("organization", "org-a", "assigned.docx")
    _template("organization", "org-a", "unassigned.docx")
    _template("organization", "org-b", "other-workspace.docx")
    custom_exporter.set_template_assignments(
        {"procurement_plan": ["assigned.docx"]},
        "org-a",
        owner_type="organization",
    )

    with pytest.raises(ValueError, match="ít nhất một"):
        _resolve_publication_template_paths(
            "organization",
            "org-a",
            "procurement_plan",
            [],
        )
    with pytest.raises(ValueError, match="không được gán"):
        _resolve_publication_template_paths(
            "organization",
            "org-a",
            "procurement_plan",
            ["unassigned.docx"],
        )
    with pytest.raises(ValueError, match="không được gán"):
        _resolve_publication_template_paths(
            "organization",
            "org-a",
            "procurement_plan",
            ["other-workspace.docx"],
        )


def test_template_rename_and_delete_update_every_assignment_reference(template_root):
    _template("organization", "org-a", "old.docx")
    custom_exporter.set_active_template(
        "old.docx",
        "org-a",
        owner_type="organization",
    )
    custom_exporter.set_template_assignments(
        {
            "consultant_evaluation_step_1": "old.docx",
            "consultant_evaluation_step_2": "old.docx",
        },
        "org-a",
        owner_type="organization",
    )

    _update_scoped_template(
        "organization",
        "org-a",
        "old.docx",
        "new.docx",
    )

    assert custom_exporter.get_active_template(
        "org-a",
        owner_type="organization",
    ) == "new.docx"
    assert custom_exporter.get_template_assignments(
        "org-a",
        owner_type="organization",
    ) == {
        "consultant_evaluation_step_1": ["new.docx"],
        "consultant_evaluation_step_2": ["new.docx"],
    }

    _delete_scoped_template("organization", "org-a", "new.docx")

    assert custom_exporter.get_active_template(
        "org-a",
        owner_type="organization",
    ) == ""
    assert custom_exporter.get_template_assignments(
        "org-a",
        owner_type="organization",
    ) == {}


def test_assignment_api_resolves_legacy_fallback_and_explicit_templates(
    template_root,
    monkeypatch,
):
    _configure_api(monkeypatch)
    _template("organization", "org-a", "main.docx")
    _template("organization", "org-a", "consultant.docx")
    custom_exporter.set_active_template(
        "main.docx",
        "org-a",
        owner_type="organization",
    )
    custom_exporter.set_template_enabled(
        "consultant.docx",
        True,
        "org-a",
        owner_type="organization",
    )
    client = _api_client()

    initial = client.get("/api/word-publication-template-assignments")
    saved = client.put(
        "/api/word-publication-template-assignments",
        json={
            "assignmentSets": {
                "consultant_evaluation_step_1": ["main.docx", "consultant.docx"],
            },
        },
    )

    assert initial.status_code == 200
    assert initial.json()["resolvedTemplates"]["procurement_plan"] == {
        "filename": "main.docx",
        "source": "legacy-active",
    }
    assert "consultant_evaluation_step_1" not in initial.json()["resolvedTemplates"]
    assert saved.status_code == 200
    assert saved.json()["assignmentSets"] == {
        "consultant_evaluation_step_1": ["main.docx", "consultant.docx"],
    }
    assert saved.json()["resolvedTemplateSets"]["consultant_evaluation_step_1"] == [
        {"filename": "main.docx", "source": "assignment"},
        {"filename": "consultant.docx", "source": "assignment"},
    ]


def test_assignment_api_rejects_unknown_types_and_cross_workspace_templates(
    template_root,
    monkeypatch,
):
    _configure_api(monkeypatch)
    _template("organization", "org-b", "other-workspace.docx")
    client = _api_client()

    unknown = client.put(
        "/api/word-publication-template-assignments",
        json={"assignments": {"invented_document": "other-workspace.docx"}},
    )
    cross_workspace = client.put(
        "/api/word-publication-template-assignments",
        json={
            "assignments": {
                "consultant_evaluation_step_1": "other-workspace.docx",
            },
        },
    )

    assert unknown.status_code == 400
    assert cross_workspace.status_code == 404
    assert custom_exporter.get_template_assignments(
        "org-a",
        owner_type="organization",
    ) == {}


def test_assignment_write_reuses_word_config_manage_permission(
    template_root,
    monkeypatch,
):
    _configure_api(monkeypatch)
    _template("organization", "org-a", "consultant.docx")
    monkeypatch.setattr(
        "backend.documents.routes_docx._word_config_access_response",
        lambda _request, _session, *, write=False: (
            JSONResponse({"error": "forbidden"}, status_code=403) if write else None
        ),
    )

    response = _api_client().put(
        "/api/word-publication-template-assignments",
        json={
            "assignments": {
                "consultant_evaluation_step_1": "consultant.docx",
            },
        },
    )

    assert response.status_code == 403
    assert custom_exporter.get_template_assignments(
        "org-a",
        owner_type="organization",
    ) == {}


@pytest.mark.parametrize(
    "procurement_form",
    [DIRECT_APPOINTMENT_SHORTENED, SPECIAL_SELECTION],
)
def test_direct_and_special_packages_have_only_two_server_allowed_documents(
    procurement_form,
):
    package = {
        "phuong_thuc_lua_chon": ONE_STAGE_ONE_ENVELOPE,
        "hinh_thuc_lua_chon": procurement_form,
    }

    applicable = [
        definition.id
        for definition in WORD_PUBLICATION_DOCUMENTS
        if is_word_publication_document_applicable(definition.id, package)
    ]

    assert applicable == ["procurement_plan", "contractor_selection_result"]


def test_server_policy_keeps_one_and_two_envelope_documents_distinct():
    base = {"hinh_thuc_lua_chon": "Đấu thầu rộng rãi"}
    one_envelope = {
        **base,
        "phuong_thuc_lua_chon": ONE_STAGE_ONE_ENVELOPE,
    }
    two_envelope = {
        **base,
        "phuong_thuc_lua_chon": ONE_STAGE_TWO_ENVELOPE,
    }

    one_ids = {
        item.id for item in WORD_PUBLICATION_DOCUMENTS
        if is_word_publication_document_applicable(item.id, one_envelope)
    }
    two_ids = {
        item.id for item in WORD_PUBLICATION_DOCUMENTS
        if is_word_publication_document_applicable(item.id, two_envelope)
    }

    assert "bid_evaluation_report" in one_ids
    assert not any(item.startswith("technical_bid_evaluation_report_") for item in one_ids)
    assert "bid_evaluation_report" not in two_ids
    assert len({
        item for item in two_ids
        if item.startswith("technical_bid_evaluation_report_")
    }) == 3
    assert [
        item.label for item in WORD_PUBLICATION_DOCUMENTS
        if item.id.startswith("technical_bid_evaluation_report_")
    ] == [
        "Báo cáo đánh giá E-HSĐXKT",
        "Quyết định phê duyệt nhà thầu đạt kỹ thuật",
        "Báo cáo đánh giá E-HSĐXTC",
    ]


def test_frontend_and_backend_share_the_same_stable_document_ids():
    frontend_source = Path(
        "frontend/documents/WordPublicationPolicy.js"
    ).read_text(encoding="utf-8")
    frontend_ids = re.findall(r'\bid:\s*"([a-z0-9_]+)"', frontend_source)

    assert frontend_ids == [item.id for item in WORD_PUBLICATION_DOCUMENTS]


def test_report_render_uses_assigned_template_and_rejects_inapplicable_type(
    template_root,
    monkeypatch,
):
    assigned = _template("organization", "org-a", "consultant.docx")
    assigned_cover = _template("organization", "org-a", "consultant-cover.docx")
    custom_exporter.set_template_assignments(
        {
            "consultant_evaluation_step_1": [
                "consultant-cover.docx",
                "consultant.docx",
            ],
        },
        "org-a",
        owner_type="organization",
    )
    package = {
        "phuong_thuc_lua_chon": ONE_STAGE_ONE_ENVELOPE,
        "hinh_thuc_lua_chon": "Đấu thầu rộng rãi",
    }
    monkeypatch.setattr(
        "backend.documents.routes_docx._load_word_export_policy",
        lambda *_args: ({}, []),
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx.docx_service.build_report_context",
        lambda *_args: {"goi_thau": dict(package)},
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx.enrich_context_with_lot_summaries",
        lambda _context: None,
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx.enrich_context_with_filtered_bidders",
        lambda _context: None,
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx.apply_custom_mappings",
        lambda *_args: None,
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx.apply_computed_mappings",
        lambda *_args: None,
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx.lowercase_partner_identity_codes",
        lambda *_args: None,
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx.seal_docx_context",
        lambda _type, context, *_args: (context, {}),
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx.sensitive_capability_groups_present",
        lambda _context: set(),
    )
    monkeypatch.setattr(
        "backend.documents.routes_docx._word_template_scope",
        lambda *_args: ("organization", "org-a"),
    )

    rendered = _prepare_report_render(
        "package-a",
        "user-a",
        "org-a",
        "manager",
        "evaluation",
        "consultant_evaluation_step_1",
    )

    assert [Path(target["path"]) for target in rendered[2]] == [
        assigned_cover,
        assigned,
    ]

    selected_render = _prepare_report_render(
        "package-a",
        "user-a",
        "org-a",
        "manager",
        "evaluation",
        "consultant_evaluation_step_1",
        ["consultant.docx"],
    )
    assert [Path(target["path"]) for target in selected_render[2]] == [assigned]

    package["hinh_thuc_lua_chon"] = DIRECT_APPOINTMENT_SHORTENED
    with pytest.raises(ValueError, match="không áp dụng"):
        _prepare_report_render(
            "package-a",
            "user-a",
            "org-a",
            "manager",
            "evaluation",
            "consultant_evaluation_step_1",
        )
