from io import BytesIO
import hashlib
from copy import deepcopy
from types import SimpleNamespace
from zipfile import ZipFile

from docx import Document
from PIL import Image
import pytest

from backend.documents import custom_exporter
from backend.documents.document_ipc import (
    DocumentIpcError,
    read_job_manifest,
    write_job_manifest,
)
from backend.documents.docx_context_policy import (
    MANIFEST_VERSION,
    collect_authorized_docx_image_paths,
    project_docx_context,
    seal_docx_context,
    validate_docx_context_manifest,
)
from backend.documents.docx_formula_service import apply_computed_mappings
from backend.documents.docx_mapping_service import apply_custom_mappings
from backend.shared.media_helper import managed_image_tenant_segment


def _tenant_image(image_root, organization_id, *, filename="signature.png"):
    tenant_segment = managed_image_tenant_segment(organization_id)
    image_path = image_root / "chuyen_gia" / tenant_segment / filename
    image_path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (8, 8), color=(20, 80, 140)).save(image_path, format="PNG")
    return f"images/chuyen_gia/{tenant_segment}/{filename}", image_path


def _signature_capabilities():
    return SimpleNamespace(financial=False, identity=False, signature=True)


@pytest.mark.parametrize("representation", ["legacy", "encoded", "scoped"])
def test_document_ipc_rejects_image_outside_authorized_records(
    tmp_path, representation,
):
    image_root = tmp_path / "source-images"
    if representation == "scoped":
        managed_path, source_path = _tenant_image(
            image_root, "org-a", filename="other-record.png",
        )
    else:
        source_path = image_root / "nha_thau" / "other-record.png"
        source_path.parent.mkdir(parents=True)
        Image.new("RGB", (8, 8)).save(source_path, format="PNG")
        managed_path = "images/nha_thau/other-record.png"
    value = (
        "/images/nha_thau/%6fther-record.png?expires=1&sig=literal#image"
        if representation == "encoded"
        else managed_path
    )
    job_dir = tmp_path / "job"
    job_dir.mkdir()

    with pytest.raises(DocumentIpcError, match="phạm vi"):
        write_job_manifest(
            job_dir / "input.json", "render_docx_batch",
            {
                "context": {"description": value},
                "context_manifest": {
                    "media_organization_id": "org-a",
                    "authorized_image_paths": [],
                },
            },
            image_root=image_root,
        )

    assert not (job_dir / "assets" / "images" / source_path.relative_to(image_root)).exists()


def test_old_image_bearing_manifest_requires_fresh_authorized_export(tmp_path):
    image_root = tmp_path / "source-images"
    source_path = image_root / "nha_thau" / "other-record.png"
    source_path.parent.mkdir(parents=True)
    Image.new("RGB", (8, 8)).save(source_path, format="PNG")
    job_dir = tmp_path / "job"
    job_dir.mkdir()

    with pytest.raises(DocumentIpcError, match="xuất lại"):
        write_job_manifest(
            job_dir / "input.json", "render_docx",
            {
                "context": {"anh_dau": "images/nha_thau/other-record.png"},
                "context_manifest": {"media_organization_id": "org-a"},
            },
            image_root=image_root,
        )


@pytest.mark.parametrize("field", ["anh_dau", "anh_chu_ky", "anh_chung_chi"])
def test_computed_image_alias_cannot_authorize_its_own_literal(field):
    folder = "nha_thau" if field == "anh_dau" else "chuyen_gia"
    value = f"images/{folder}/other-record.png"
    mappings = [(field, "__computed__", repr(value))]
    context = {"goi_thau": {"id": "package-a"}}
    apply_computed_mappings(context, mappings)
    with pytest.raises(ValueError, match="phạm vi"):
        seal_docx_context(
            "evaluation", context, mappings, _signature_capabilities(),
            organization_id="org-a", authorized_image_paths=(),
        )


def test_canonical_image_capture_excludes_text_and_later_mapping_results():
    owned = "images/chuyen_gia/owned.png"
    context = {
        "goi_thau": {"ten_goi_thau": "images/nha_thau/unrelated.png"},
        "to_chuyen_gia": [{"anh_chu_ky": owned}],
    }
    authorized = collect_authorized_docx_image_paths(context, "org-a")
    context["anh_dau"] = "images/nha_thau/other-record.png"

    assert authorized == frozenset({owned})


@pytest.mark.parametrize("representation", ["legacy", "scoped", "encoded"])
def test_authorized_canonical_images_aliases_text_and_batch_remain_intact(
    tmp_path, monkeypatch, representation,
):
    from backend.documents.document_worker_entry import _run_operation

    image_root = tmp_path / "source-images"
    if representation == "scoped":
        managed_path, source_path = _tenant_image(image_root, "org-a")
    else:
        source_path = image_root / "chuyen_gia" / "signature.png"
        source_path.parent.mkdir(parents=True)
        Image.new("RGB", (8, 8), color=(20, 80, 140)).save(source_path, format="PNG")
        managed_path = "images/chuyen_gia/signature.png"
    canonical_value = (
        "/images/chuyen_gia/%73ignature.png?expires=1&sig=signed#image"
        if representation == "encoded"
        else managed_path
    )
    context = project_docx_context(
        "evaluation", {"to_chuyen_gia": [{"id": "expert-a", "anh_chu_ky": canonical_value}]},
        _signature_capabilities(), organization_id="org-a",
    )
    authorized = collect_authorized_docx_image_paths(context, "org-a")
    mappings = [
        ("signature_image", "chuyen_gia", "anh_chu_ky"),
        ("anh_chung_chi", "__computed__", "signature_image"),
        ("description", "__computed__", repr("Nội dung nguyên trạng")),
    ]
    apply_custom_mappings(context, mappings)
    apply_computed_mappings(context, mappings)
    context, manifest = seal_docx_context(
        "evaluation", context, mappings, _signature_capabilities(),
        organization_id="org-a", authorized_image_paths=authorized,
    )
    assert manifest["authorized_image_paths"] == [managed_path]
    assert context["signature_image"] == managed_path
    assert context["anh_chung_chi"] == managed_path
    assert context["description"] == "Nội dung nguyên trạng"
    template_path = tmp_path / "template.docx"
    template = Document()
    template.add_paragraph("{{ signature_image }} {{ anh_chung_chi }} {{ description }}")
    template.save(template_path)
    job_dir = tmp_path / "job"
    job_dir.mkdir()
    write_job_manifest(
        job_dir / "input.json", "render_docx_batch",
        {
            "templates": [
                {"template_path": str(template_path), "filename": "first.docx"},
                {"template_path": str(template_path), "filename": "second.docx"},
            ],
            "context": context, "context_manifest": manifest,
        },
        image_root=image_root,
    )
    operation, payload = read_job_manifest(job_dir / "input.json", job_dir)
    monkeypatch.setattr(custom_exporter, "IMAGE_DIR", str(job_dir / "assets" / "images"))
    output = _run_operation(operation, payload)
    with ZipFile(BytesIO(output)) as batch:
        assert batch.namelist() == ["first.docx", "second.docx"]
        for name in batch.namelist():
            rendered = batch.read(name)
            with ZipFile(BytesIO(rendered)) as document:
                media = [document.read(path) for path in document.namelist() if path.startswith("word/media/")]
            assert media == [source_path.read_bytes()]
            assert "Nội dung nguyên trạng" in " ".join(paragraph.text for paragraph in Document(BytesIO(rendered)).paragraphs)
    assert payload["context"] == context

    # The batch warmed the image cache. Revoking its payload proof must fail
    # before the cached bytes, or any filesystem source, are consulted.
    forbidden_manifest = deepcopy(manifest)
    forbidden_manifest["authorized_image_paths"] = []
    monkeypatch.setattr(
        custom_exporter, "optimize_image_for_docx",
        lambda *_args: pytest.fail("unauthorized image reached the cache/source"),
    )
    with pytest.raises(ValueError, match="phạm vi"):
        custom_exporter.generate_report_from_custom_template(
            str(template_path), deepcopy(context), forbidden_manifest,
        )


def test_replayed_manifest_checks_image_proof_without_copying(tmp_path):
    job_dir = tmp_path / "job"
    job_dir.mkdir()
    with pytest.raises(DocumentIpcError, match="phạm vi"):
        write_job_manifest(
            job_dir / "input.json", "render_docx",
            {
                "context": {"anh_dau": "images/nha_thau/other-record.png"},
                "context_manifest": {"media_organization_id": "org-a", "authorized_image_paths": []},
            },
            image_root=job_dir, copy_images=False,
        )


def test_old_image_free_manifest_remains_compatible(tmp_path):
    context = {"description": "Nội dung cũ nguyên trạng"}
    manifest = {
        "version": MANIFEST_VERSION, "document_type": "evaluation",
        "root_keys": ["description"], "custom_root_keys": ["description"],
        "image_fields": {}, "media_organization_id": "org-a",
    }
    validate_docx_context_manifest(context, manifest)
    write_job_manifest(
        tmp_path / "input.json", "render_docx",
        {"context": context, "context_manifest": manifest}, image_root=tmp_path,
    )
    _operation, payload = read_job_manifest(tmp_path / "input.json", tmp_path)
    assert payload["context"] == context
    assert "authorized_image_paths" not in payload["context_manifest"]


@pytest.mark.parametrize("mapped_path", ["images/chuyen_gia/owned.png", "images/chuyen_gia/other-record.png"])
def test_report_preparation_captures_proof_before_computed_mapping(monkeypatch, mapped_path):
    from backend.documents import routes_docx

    owned_path = "images/chuyen_gia/owned.png"
    canonical = {"goi_thau": {"id": "package-a"}, "to_chuyen_gia": [{"anh_chu_ky": owned_path}]}
    mappings = [("anh_chu_ky", "__computed__", repr(mapped_path))]
    monkeypatch.setattr(routes_docx, "_load_word_export_policy", lambda *_args: (_signature_capabilities(), mappings))
    monkeypatch.setattr(routes_docx.docx_service, "build_report_context_snapshot", lambda *_args: (deepcopy(canonical), 4))
    monkeypatch.setattr(routes_docx, "enrich_context_with_lot_summaries", lambda *_args: None)
    monkeypatch.setattr(routes_docx, "enrich_context_with_filtered_bidders", lambda *_args: None)
    monkeypatch.setattr(routes_docx, "_word_template_scope", lambda *_args: ("organization", "org-a"))

    def prepare():
        return routes_docx._prepare_report_render(
            "package-a", "user-a", "org-a", "manager", "evaluation", skip_template_resolution=True,
        )

    if mapped_path != owned_path:
        with pytest.raises(ValueError, match="phạm vi"):
            prepare()
    else:
        context, manifest, template, _groups = prepare()
        assert context["anh_chu_ky"] == owned_path
        assert manifest["authorized_image_paths"] == [owned_path]
        assert manifest["record_revision"] == 4
        assert template is None


def test_docx_projection_preserves_only_current_tenant_media(tmp_path):
    own_path, _ = _tenant_image(tmp_path / "images", "org-a")
    foreign_path, _ = _tenant_image(
        tmp_path / "images",
        "org-b",
        filename="foreign.png",
    )
    context = {
        "to_chuyen_gia": [
            {"id": "expert-a", "anh_chu_ky": own_path},
            {"id": "expert-b", "anh_chu_ky": foreign_path},
        ]
    }

    projected = project_docx_context(
        "evaluation",
        context,
        _signature_capabilities(),
        organization_id="org-a",
    )

    assert projected["to_chuyen_gia"][0]["anh_chu_ky"] == own_path
    assert projected["to_chuyen_gia"][1]["anh_chu_ky"] == ""


def test_document_ipc_copies_current_tenant_media_with_namespace(tmp_path):
    image_root = tmp_path / "source-images"
    managed_path, source_path = _tenant_image(image_root, "org-a")
    job_dir = tmp_path / "job"
    job_dir.mkdir()

    write_job_manifest(
        job_dir / "input.json",
        "render_docx",
        {
            "context": {"signature_image": managed_path},
            "context_manifest": {
                "media_organization_id": "org-a",
                "authorized_image_paths": [managed_path],
            },
        },
        image_root=image_root,
    )

    copied = job_dir / "assets" / "images" / source_path.relative_to(image_root)
    assert copied.read_bytes() == source_path.read_bytes()


def test_replayed_worker_manifest_reuses_staged_images_without_second_copy(tmp_path):
    image_root = tmp_path / "source-images"
    managed_path, source_path = _tenant_image(image_root, "org-a")
    template_path = tmp_path / "template.docx"
    Document().save(template_path)
    job_dir = tmp_path / "job"
    job_dir.mkdir()
    payload = {
        "template_path": str(template_path),
        "context": {"anh_chu_ky": managed_path},
        "context_manifest": {
            "media_organization_id": "org-a",
            "authorized_image_paths": [managed_path],
        },
    }
    write_job_manifest(
        job_dir / "input.json", "render_docx", payload, image_root=image_root,
    )
    copied = job_dir / "assets" / "images" / source_path.relative_to(image_root)
    before = copied.stat().st_mtime_ns
    _operation, materialized = read_job_manifest(job_dir / "input.json", job_dir)
    write_job_manifest(
        job_dir / "retry-input.json",
        "render_docx",
        materialized,
        image_root=job_dir / "assets" / "images",
        copy_images=False,
        sidecar_prefix="input-retry",
    )

    assert copied.read_bytes() == source_path.read_bytes()
    assert copied.stat().st_mtime_ns == before
    assert list((job_dir / "assets" / "images").rglob(source_path.name)) == [copied]


def test_document_ipc_rejects_foreign_tenant_media(tmp_path):
    image_root = tmp_path / "source-images"
    foreign_path, _ = _tenant_image(image_root, "org-b")
    job_dir = tmp_path / "job"
    job_dir.mkdir()

    with pytest.raises(DocumentIpcError, match="tổ chức"):
        write_job_manifest(
            job_dir / "input.json",
            "render_docx",
            {
                "context": {"signature_image": foreign_path},
                "context_manifest": {
                    "media_organization_id": "org-a",
                    "authorized_image_paths": [foreign_path],
                },
            },
            image_root=image_root,
        )


def test_docx_renderer_embeds_tenant_scoped_media(tmp_path, monkeypatch):
    image_root = tmp_path / "worker-images"
    managed_path, _ = _tenant_image(image_root, "org-a")
    template_path = tmp_path / "template.docx"
    template = Document()
    template.add_paragraph("{{ signature_image }}")
    template.save(template_path)
    monkeypatch.setattr(custom_exporter, "IMAGE_DIR", str(image_root))
    context = {"signature_image": managed_path}
    manifest = {
        "version": MANIFEST_VERSION,
        "document_type": "evaluation",
        "root_keys": ["signature_image"],
        "custom_root_keys": ["signature_image"],
        "image_fields": {"signature_image": "chuyen_gia"},
        "media_organization_id": "org-a",
        "authorized_image_paths": [managed_path],
    }

    output = custom_exporter.generate_report_from_custom_template(
        str(template_path),
        context,
        manifest,
    )

    with ZipFile(BytesIO(output.getvalue())) as archive:
        media_files = [name for name in archive.namelist() if name.startswith("word/media/")]
        assert media_files


@pytest.mark.parametrize(
    ("image_format", "extension"),
    (("PNG", "png"), ("JPEG", "jpg"), ("WEBP", "webp")),
)
def test_legal_word_media_is_embedded_byte_for_byte(
    tmp_path, monkeypatch, image_format, extension,
):
    image_root = tmp_path / "worker-images"
    tenant_segment = managed_image_tenant_segment("org-a")
    source_path = (
        image_root / "chuyen_gia" / tenant_segment / f"signature.{extension}"
    )
    source_path.parent.mkdir(parents=True)
    Image.new("RGB", (19, 11), color=(45, 90, 135)).save(
        source_path, format=image_format,
    )
    source = source_path.read_bytes()
    managed_path = f"images/chuyen_gia/{tenant_segment}/{source_path.name}"
    template_path = tmp_path / "template.docx"
    template = Document()
    template.add_paragraph("{{ anh_chu_ky }}")
    template.save(template_path)
    monkeypatch.setattr(custom_exporter, "IMAGE_DIR", str(image_root))
    manifest = {
        "version": MANIFEST_VERSION,
        "document_type": "evaluation",
        "root_keys": ["anh_chu_ky"],
        "custom_root_keys": ["anh_chu_ky"],
        "image_fields": {"anh_chu_ky": "chuyen_gia"},
        "media_organization_id": "org-a",
        "authorized_image_paths": [managed_path],
    }

    output = custom_exporter.generate_report_from_custom_template(
        str(template_path), {"anh_chu_ky": managed_path}, manifest,
    ).getvalue()

    with ZipFile(BytesIO(output)) as archive:
        embedded = [
            archive.read(name)
            for name in archive.namelist()
            if name.startswith("word/media/")
        ]
    assert len(embedded) == 1
    assert embedded[0] == source
    assert hashlib.sha256(embedded[0]).digest() == hashlib.sha256(source).digest()


def test_document_worker_rejects_malformed_managed_media_path():
    context = {"signature_image": "images/chuyen_gia/../escape.png"}
    manifest = {
        "version": MANIFEST_VERSION,
        "document_type": "evaluation",
        "root_keys": ["signature_image"],
        "custom_root_keys": ["signature_image"],
        "image_fields": {"signature_image": "chuyen_gia"},
        "media_organization_id": "org-a",
        "authorized_image_paths": [],
    }

    with pytest.raises(ValueError, match="Ảnh Word"):
        validate_docx_context_manifest(context, manifest)


def test_docx_renderer_fails_clearly_when_legal_media_is_missing(
    tmp_path, monkeypatch,
):
    image_root = tmp_path / "worker-images"
    template_path = tmp_path / "template.docx"
    template = Document()
    template.add_paragraph("{{ anh_chu_ky }}")
    template.save(template_path)
    monkeypatch.setattr(custom_exporter, "IMAGE_DIR", str(image_root))
    tenant_segment = managed_image_tenant_segment("org-a")
    context = {
        "anh_chu_ky": f"images/chuyen_gia/{tenant_segment}/missing.png"
    }
    manifest = {
        "version": MANIFEST_VERSION,
        "document_type": "evaluation",
        "root_keys": ["anh_chu_ky"],
        "custom_root_keys": ["anh_chu_ky"],
        "image_fields": {"anh_chu_ky": "chuyen_gia"},
        "media_organization_id": "org-a",
        "authorized_image_paths": [context["anh_chu_ky"]],
    }

    with pytest.raises(
        custom_exporter.TemplateRenderError,
        match="ảnh pháp lý",
    ):
        custom_exporter.generate_report_from_custom_template(
            str(template_path), context, manifest,
        )
