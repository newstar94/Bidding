from io import BytesIO
from types import SimpleNamespace
from zipfile import ZipFile

from docx import Document
from PIL import Image
import pytest

from backend.documents import custom_exporter
from backend.documents.document_ipc import DocumentIpcError, write_job_manifest
from backend.documents.docx_context_policy import (
    MANIFEST_VERSION,
    project_docx_context,
    validate_docx_context_manifest,
)
from backend.shared.media_helper import managed_image_tenant_segment


def _tenant_image(image_root, organization_id, *, filename="signature.png"):
    tenant_segment = managed_image_tenant_segment(organization_id)
    image_path = image_root / "chuyen_gia" / tenant_segment / filename
    image_path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (8, 8), color=(20, 80, 140)).save(image_path, format="PNG")
    return f"images/chuyen_gia/{tenant_segment}/{filename}", image_path


def _signature_capabilities():
    return SimpleNamespace(financial=False, identity=False, signature=True)


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
            "context_manifest": {"media_organization_id": "org-a"},
        },
        image_root=image_root,
    )

    copied = job_dir / "assets" / "images" / source_path.relative_to(image_root)
    assert copied.read_bytes() == source_path.read_bytes()


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
                "context_manifest": {"media_organization_id": "org-a"},
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
    }

    output = custom_exporter.generate_report_from_custom_template(
        str(template_path),
        context,
        manifest,
    )

    with ZipFile(BytesIO(output.getvalue())) as archive:
        media_files = [name for name in archive.namelist() if name.startswith("word/media/")]
        assert media_files


def test_document_worker_rejects_malformed_managed_media_path():
    context = {"signature_image": "images/chuyen_gia/../escape.png"}
    manifest = {
        "version": MANIFEST_VERSION,
        "document_type": "evaluation",
        "root_keys": ["signature_image"],
        "custom_root_keys": ["signature_image"],
        "image_fields": {"signature_image": "chuyen_gia"},
        "media_organization_id": "org-a",
    }

    with pytest.raises(ValueError, match="Ảnh Word"):
        validate_docx_context_manifest(context, manifest)
