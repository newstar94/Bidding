"""Persistence and private filesystem storage for package documents."""

from __future__ import annotations

import hashlib
import os
import uuid
from pathlib import Path, PurePosixPath

from backend.db.id_utils import generate_record_id
from backend.shared.paths import IMAGE_DIR


MAX_PACKAGE_DOCUMENT_BYTES = 25 * 1024 * 1024
PACKAGE_DOCUMENT_ROOT = (Path(IMAGE_DIR) / "goi-thau-documents").resolve()
SUPPORTED_MEDIA = {
    ".pdf": ("pdf", "application/pdf"),
    ".docx": (
        "docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
    ".xlsx": (
        "xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ),
}


class PackageDocumentError(ValueError):
    code = "PACKAGE_DOCUMENT_INVALID"


class PackageDocumentNotFoundError(PackageDocumentError):
    code = "PACKAGE_DOCUMENT_NOT_FOUND"


def clean_original_filename(value):
    raw = str(value or "").strip().replace("\\", "/")
    name = raw.rsplit("/", 1)[-1].strip()
    if (
        not name
        or name in {".", ".."}
        or len(name) > 255
        or "\x00" in name
        or any(ord(character) < 32 for character in name)
    ):
        raise PackageDocumentError("Tên tệp không hợp lệ.")
    return name


def media_for_filename(filename):
    extension = Path(clean_original_filename(filename)).suffix.casefold()
    media = SUPPORTED_MEDIA.get(extension)
    if media is None:
        raise PackageDocumentError("Chỉ hỗ trợ tệp PDF, DOCX hoặc XLSX.")
    return extension, media[0], media[1]


def validate_pdf_path(path):
    source = Path(path)
    with source.open("rb") as handle:
        head = handle.read(8)
        handle.seek(max(0, source.stat().st_size - 2048))
        tail = handle.read()
    if not head.startswith(b"%PDF-") or b"%%EOF" not in tail:
        raise PackageDocumentError("Cấu trúc tệp PDF không hợp lệ.")


def load_package(cursor, organization_id, package_id):
    row = cursor.execute(
        """SELECT id, organization_id, owner_type, trang_thai,
                  phuong_thuc_lua_chon, yeu_cau_tham_dinh_hsmt
           FROM goi_thau
           WHERE organization_id = ? AND id = ? AND archived_at IS NULL
           LIMIT 1""",
        (organization_id, package_id),
    ).fetchone()
    if not row:
        raise PackageDocumentNotFoundError("Không tìm thấy gói thầu.")
    return dict(row)


def list_package_documents(cursor, organization_id, package_id):
    rows = cursor.execute(
        """SELECT d.id, d.document_type, d.original_filename, d.content_type,
                  d.size_bytes, d.sha256, d.uploaded_by_id, d.uploaded_at,
                  COALESCE(NULLIF(trim(u.ho_ten), ''), u.ten_dang_nhap, '') AS uploaded_by_name
           FROM tai_lieu_goi_thau d
           LEFT JOIN tai_khoan u ON u.id = d.uploaded_by_id
           WHERE d.organization_id = ? AND d.goi_thau_id = ?
           ORDER BY d.created_at, d.document_type""",
        (organization_id, package_id),
    ).fetchall()
    return [serialize_document(row) for row in rows]


def get_package_document(cursor, organization_id, package_id, document_type):
    row = cursor.execute(
        """SELECT id, document_type, original_filename, storage_key,
                  content_type, size_bytes, sha256, uploaded_by_id, uploaded_at
           FROM tai_lieu_goi_thau
           WHERE organization_id = ? AND goi_thau_id = ? AND document_type = ?
           LIMIT 1""",
        (organization_id, package_id, document_type),
    ).fetchone()
    return dict(row) if row else None


def serialize_document(row):
    value = dict(row)
    return {
        "id": value.get("id"),
        "type": value.get("document_type"),
        "originalFilename": value.get("original_filename"),
        "contentType": value.get("content_type"),
        "sizeBytes": int(value.get("size_bytes") or 0),
        "sha256": value.get("sha256"),
        "uploadedById": value.get("uploaded_by_id"),
        "uploadedByName": value.get("uploaded_by_name") or "",
        "uploadedAt": str(value.get("uploaded_at") or ""),
    }


def _scope_component(value):
    return hashlib.sha256(str(value or "").encode("utf-8")).hexdigest()[:24]


def create_storage_key(organization_id, package_id, extension):
    return PurePosixPath(
        _scope_component(organization_id),
        _scope_component(package_id),
        f"{uuid.uuid4().hex}{extension}",
    ).as_posix()


def resolve_storage_key(storage_key):
    candidate = PurePosixPath(str(storage_key or ""))
    if (
        not candidate.parts
        or candidate.is_absolute()
        or any(part in {"", ".", ".."} for part in candidate.parts)
    ):
        raise PackageDocumentError("Khóa lưu trữ tài liệu không hợp lệ.")
    root = PACKAGE_DOCUMENT_ROOT.resolve()
    path = root.joinpath(*candidate.parts).resolve()
    try:
        if os.path.commonpath((str(root), str(path))) != str(root):
            raise PackageDocumentError("Khóa lưu trữ tài liệu không hợp lệ.")
    except ValueError as exc:
        raise PackageDocumentError("Khóa lưu trữ tài liệu không hợp lệ.") from exc
    return path


def persist_upload_path(source_path, storage_key):
    source = Path(source_path)
    destination = resolve_storage_key(storage_key)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.tmp")
    digest = hashlib.sha256()
    size = 0
    try:
        with source.open("rb") as input_file, temporary.open("xb") as output_file:
            while chunk := input_file.read(1024 * 1024):
                size += len(chunk)
                digest.update(chunk)
                output_file.write(chunk)
            output_file.flush()
            os.fsync(output_file.fileno())
        os.replace(temporary, destination)
        try:
            destination.chmod(0o600)
        except OSError:
            pass
        return size, digest.hexdigest()
    finally:
        temporary.unlink(missing_ok=True)


def remove_storage_key(storage_key):
    path = resolve_storage_key(storage_key)
    if path.is_file():
        path.unlink()
    parent = path.parent
    root = PACKAGE_DOCUMENT_ROOT.resolve()
    while parent != root:
        try:
            parent.rmdir()
        except OSError:
            break
        parent = parent.parent


def upsert_package_document(
    cursor,
    *,
    organization_id,
    package,
    document_type,
    original_filename,
    storage_key,
    content_type,
    size_bytes,
    sha256,
    uploaded_by_id,
):
    existing = get_package_document(
        cursor,
        organization_id,
        package["id"],
        document_type,
    )
    document_id = existing["id"] if existing else generate_record_id("tai_lieu_goi_thau")
    row = cursor.execute(
        """INSERT INTO tai_lieu_goi_thau (
               id, organization_id, owner_type, goi_thau_id, document_type,
               original_filename, storage_key, content_type, size_bytes,
               sha256, uploaded_by_id, uploaded_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT (organization_id, goi_thau_id, document_type)
           DO UPDATE SET
               original_filename = excluded.original_filename,
               storage_key = excluded.storage_key,
               content_type = excluded.content_type,
               size_bytes = excluded.size_bytes,
               sha256 = excluded.sha256,
               uploaded_by_id = excluded.uploaded_by_id,
               uploaded_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           RETURNING id, document_type, original_filename, content_type,
                     size_bytes, sha256, uploaded_by_id, uploaded_at""",
        (
            document_id,
            organization_id,
            package["owner_type"],
            package["id"],
            document_type,
            original_filename,
            storage_key,
            content_type,
            size_bytes,
            sha256,
            uploaded_by_id,
        ),
    ).fetchone()
    return serialize_document(row), existing


def delete_package_document(cursor, organization_id, package_id, document_type):
    row = cursor.execute(
        """DELETE FROM tai_lieu_goi_thau
           WHERE organization_id = ? AND goi_thau_id = ? AND document_type = ?
           RETURNING id, storage_key, original_filename""",
        (organization_id, package_id, document_type),
    ).fetchone()
    if not row:
        raise PackageDocumentNotFoundError("Không tìm thấy tài liệu.")
    return dict(row)
