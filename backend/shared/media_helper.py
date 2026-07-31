import os
import base64
import binascii
import glob
import hashlib
import hmac
import io
import re
import tempfile
import time
import urllib.parse
import uuid
import warnings

from backend.shared.paths import IMAGE_DIR
from backend.shared.logging_utils import log_error


MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_IMAGE_DIMENSION = 8_192
MAX_IMAGE_PIXELS = 20_000_000
MAX_IMAGE_DECODE_RATIO = 256
IMAGE_RATIO_DENOMINATOR_FLOOR = 64 * 1024
ALLOWED_IMAGE_SUBFOLDERS = {"chuyen_gia", "nha_thau"}
ALLOWED_IMAGE_MIME_TO_EXT = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
}
TENANT_IMAGE_SEGMENT_PATTERN = re.compile(r"t-[a-f0-9]{24}")


def _safe_file_part(value: str, fallback: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(value or fallback))
    safe = safe.strip("._")
    return safe or fallback


def managed_image_tenant_segment(tenant_id: str) -> str:
    """Return a stable opaque filesystem segment for one tenant."""

    normalized = str(tenant_id or "").strip()
    if not normalized:
        raise ValueError("Thiếu phạm vi tổ chức khi lưu ảnh")
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:24]
    return f"t-{digest}"


def _protected_media_ttl_seconds():
    try:
        value = int(os.environ.get("PROTECTED_MEDIA_URL_TTL_SECONDS", "300"))
    except (TypeError, ValueError):
        value = 300
    return min(900, max(30, value))


def _protected_media_signature(session_token, organization_id, managed_path, expires_at):
    message = f"{organization_id}\n{managed_path}\n{int(expires_at)}".encode("utf-8")
    return hmac.new(
        str(session_token).encode("utf-8"),
        message,
        hashlib.sha256,
    ).hexdigest()


def public_image_path(
    value: str,
    *,
    session_token: str = "",
    organization_id: str = "",
    now: int | None = None,
) -> str:
    """Return a short-lived, session-bound URL for managed private media."""
    path = normalize_managed_image_path(value)
    if not path:
        return str(value or "").strip()
    session_token = str(session_token or "").strip()
    organization_id = str(organization_id or "").strip()
    if not session_token or not organization_id:
        return ""
    if not managed_image_path_matches_tenant(
        path,
        organization_id,
        allow_legacy=True,
    ):
        return ""
    expires_at = int(now if now is not None else time.time()) + _protected_media_ttl_seconds()
    signature = _protected_media_signature(
        session_token,
        organization_id,
        path,
        expires_at,
    )
    query = urllib.parse.urlencode(
        {"expires": expires_at, "org": organization_id, "sig": signature}
    )
    relative_path = urllib.parse.quote(path.removeprefix("images/"), safe="/")
    return f"/images/{relative_path}?{query}"


def protected_image_signature_is_valid(
    *,
    session_token: str,
    organization_id: str,
    managed_path: str,
    expires_at,
    signature: str,
    now: int | None = None,
) -> bool:
    try:
        expires_at = int(expires_at)
    except (TypeError, ValueError):
        return False
    current_time = int(now if now is not None else time.time())
    if expires_at < current_time or expires_at > current_time + 900:
        return False
    if not session_token or not organization_id or not signature:
        return False
    normalized_path = normalize_managed_image_path(managed_path)
    if not managed_image_path_matches_tenant(
        normalized_path,
        organization_id,
        allow_legacy=True,
    ):
        return False
    expected = _protected_media_signature(
        session_token,
        organization_id,
        normalized_path,
        expires_at,
    )
    return hmac.compare_digest(expected, str(signature))


def normalize_managed_image_path(value: str) -> str:
    """Return the canonical DB path for an application-managed image."""
    raw_value = str(value or "").strip()
    if not raw_value:
        return ""
    parsed = urllib.parse.urlsplit(raw_value)
    if parsed.scheme or parsed.netloc:
        return ""
    path = urllib.parse.unquote(parsed.path).lstrip("/")
    if not re.fullmatch(
        r"images/(?:chuyen_gia|nha_thau)/(?:t-[a-f0-9]{24}/)?[A-Za-z0-9_.-]+\.(?:png|jpg|webp)",
        path,
        re.IGNORECASE,
    ):
        return ""
    return path


def managed_image_path_matches_tenant(
    value: str,
    tenant_id: str,
    *,
    allow_legacy: bool = False,
) -> bool:
    """Check a managed path's opaque tenant namespace.

    Legacy paths have no tenant segment and are accepted only when the caller
    separately proves record ownership in the database.
    """

    managed_path = normalize_managed_image_path(value)
    if not managed_path:
        return False
    parts = managed_path.split("/")
    if len(parts) == 3:
        return allow_legacy
    if len(parts) != 4 or not TENANT_IMAGE_SEGMENT_PATTERN.fullmatch(parts[2]):
        return False
    try:
        return hmac.compare_digest(parts[2], managed_image_tenant_segment(tenant_id))
    except ValueError:
        return False


def _managed_image_file(value: str) -> str:
    managed_path = normalize_managed_image_path(value)
    if not managed_path:
        return ""
    images_root = os.path.realpath(IMAGE_DIR)
    file_path = os.path.realpath(
        os.path.join(images_root, managed_path.removeprefix("images/"))
    )
    if not file_path.startswith(images_root + os.sep):
        return ""
    return file_path


def find_unreferenced_image_paths(cursor, candidates) -> list[str]:
    """Return managed paths that no database version references.

    The lookup deliberately spans every owner and every version. This keeps an
    older file whenever a historical contractor/expert version still uses it.
    """
    managed_paths = {
        path
        for path in (normalize_managed_image_path(value) for value in candidates or [])
        if path
    }
    unreferenced = []
    for managed_path in managed_paths:
        cursor.execute(
            """
            SELECT (
                EXISTS(SELECT 1 FROM nha_thau WHERE anh_dau = ?)
                OR EXISTS(
                    SELECT 1 FROM chuyen_gia
                    WHERE anh_chung_chi = ? OR anh_chu_ky = ?
                )
            )
            """,
            (managed_path, managed_path, managed_path),
        )
        row = cursor.fetchone()
        if row and bool(row[0]):
            continue
        unreferenced.append(managed_path)
    return unreferenced


def delete_managed_image_files(managed_paths) -> list[str]:
    """Delete already-authorized managed paths without holding a DB transaction."""

    removed = []
    for managed_path in managed_paths or ():
        file_path = _managed_image_file(managed_path)
        if not file_path:
            continue

        related_files = [file_path]
        stem, _ext = os.path.splitext(file_path)
        related_files.extend(glob.glob(f"{glob.escape(stem)}_opt_*"))
        for related_path in related_files:
            if not os.path.isfile(related_path):
                continue
            try:
                os.remove(related_path)
                removed.append(related_path)
            except OSError:
                continue
    return removed


def _decode_and_validate_image(
    base64_str: str,
    *,
    max_bytes: int = MAX_IMAGE_UPLOAD_BYTES,
    max_dimension: int = MAX_IMAGE_DIMENSION,
    max_pixels: int = MAX_IMAGE_PIXELS,
    max_decode_ratio: int = MAX_IMAGE_DECODE_RATIO,
):
    if not isinstance(base64_str, str):
        raise ValueError("Dữ liệu ảnh phải là chuỗi")
    match = re.fullmatch(
        r"data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)",
        base64_str.strip(),
        re.IGNORECASE,
    )
    if not match:
        raise ValueError("Ảnh phải dùng data URL PNG, JPEG hoặc WebP hợp lệ")
    mime = match.group(1).lower()
    encoded = match.group(2)
    if len(encoded) > ((max_bytes + 2) // 3) * 4 + 4:
        raise ValueError("Dung lượng ảnh vượt quá giới hạn cho phép")
    try:
        file_data = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Dữ liệu base64 của ảnh không hợp lệ") from exc
    if not file_data or len(file_data) > max_bytes:
        raise ValueError("Dung lượng ảnh vượt quá giới hạn cho phép")

    from PIL import Image, ImageOps

    expected_format = {
        "image/png": "PNG",
        "image/jpeg": "JPEG",
        "image/webp": "WEBP",
    }[mime]
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(file_data)) as probe:
                width, height = probe.size
                actual_format = str(probe.format or "").upper()
                frame_count = int(getattr(probe, "n_frames", 1) or 1)
                bands = max(1, len(probe.getbands()))
                if actual_format != expected_format:
                    raise ValueError("Nội dung ảnh không khớp MIME đã khai báo")
                if frame_count != 1:
                    raise ValueError("Không chấp nhận ảnh động hoặc ảnh nhiều khung")
                if width < 1 or height < 1:
                    raise ValueError("Kích thước ảnh không hợp lệ")
                if width > max_dimension or height > max_dimension:
                    raise ValueError("Chiều rộng hoặc chiều cao ảnh vượt quá giới hạn")
                pixels = width * height
                if pixels > max_pixels:
                    raise ValueError("Tổng số pixel ảnh vượt quá giới hạn")
                decoded_bytes = pixels * bands
                denominator = max(len(file_data), IMAGE_RATIO_DENOMINATOR_FLOOR)
                if decoded_bytes / denominator > max_decode_ratio:
                    raise ValueError("Tỷ lệ giải nén ảnh vượt quá giới hạn")
                probe.verify()
            with Image.open(io.BytesIO(file_data)) as decoded:
                decoded.load()
                image = ImageOps.exif_transpose(decoded).copy()
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("Nội dung ảnh không hợp lệ") from exc
    return mime, ALLOWED_IMAGE_MIME_TO_EXT[mime], image


def _prepare_image_for_output(image, save_format: str, max_size: int):
    from PIL import Image

    if image.width > max_size or image.height > max_size:
        image.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
    has_alpha = "A" in image.getbands() or (
        image.mode == "P" and "transparency" in image.info
    )
    if save_format == "JPEG":
        if image.mode != "RGB":
            background = Image.new("RGB", image.size, "white")
            if has_alpha:
                rgba = image.convert("RGBA")
                background.paste(rgba, mask=rgba.getchannel("A"))
            else:
                background.paste(image.convert("RGB"))
            image = background
    elif save_format in {"PNG", "WEBP"}:
        image = image.convert("RGBA" if has_alpha else "RGB")
    return image


def _save_kwargs(save_format: str) -> dict:
    if save_format == "JPEG":
        return {"quality": 85, "optimize": True, "progressive": True}
    if save_format == "PNG":
        return {"optimize": True, "compress_level": 9}
    return {"quality": 85, "method": 6}


def reencode_base64_image(
    base64_str: str,
    *,
    max_input_bytes: int,
    max_size: int,
    output_format: str = "JPEG",
) -> str:
    """Validate and re-encode a small image before retaining it as a data URL."""
    _mime, _ext, image = _decode_and_validate_image(
        base64_str,
        max_bytes=max_input_bytes,
        max_dimension=min(MAX_IMAGE_DIMENSION, max_size * 16),
        max_pixels=min(MAX_IMAGE_PIXELS, max_size * max_size * 64),
    )
    save_format = str(output_format or "JPEG").upper()
    if save_format not in {"JPEG", "PNG", "WEBP"}:
        raise ValueError("Định dạng ảnh đầu ra không hợp lệ")
    image = _prepare_image_for_output(image, save_format, max_size)
    output = io.BytesIO()
    image.save(output, format=save_format, **_save_kwargs(save_format))
    encoded = base64.b64encode(output.getvalue()).decode("ascii")
    mime = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}[save_format]
    return f"data:{mime};base64,{encoded}"


def save_base64_image(
    base64_str: str,
    subfolder: str,
    filename_prefix: str,
    *,
    tenant_id: str,
    allowed_existing_paths=(),
) -> str:
    if not base64_str:
        return ""
    if subfolder not in ALLOWED_IMAGE_SUBFOLDERS:
        raise ValueError("Thư mục lưu ảnh không hợp lệ")
    tenant_segment = managed_image_tenant_segment(tenant_id)

    existing_path = normalize_managed_image_path(base64_str)
    if existing_path:
        expected_prefix = f"images/{subfolder}/"
        if not existing_path.startswith(expected_prefix):
            raise ValueError("Ảnh hiện tại không thuộc đúng phạm vi lưu trữ")
        if not managed_image_path_matches_tenant(
            existing_path,
            tenant_id,
            allow_legacy=True,
        ):
            raise ValueError("Ảnh hiện tại không thuộc tổ chức này")
        allowed = {
            normalize_managed_image_path(path)
            for path in (allowed_existing_paths or ())
        }
        if existing_path not in allowed:
            raise ValueError("Ảnh hiện tại không thuộc bản ghi hoặc tổ chức này")
        return existing_path

    temporary_path = ""
    try:
        _mime, ext, image = _decode_and_validate_image(base64_str)
        images_root = os.path.realpath(IMAGE_DIR)
        image_dir = os.path.realpath(
            os.path.join(images_root, subfolder, tenant_segment)
        )
        if not image_dir.startswith(images_root + os.sep):
            raise ValueError("Đường dẫn lưu ảnh không hợp lệ")
        os.makedirs(image_dir, exist_ok=True)

        filename = f"{_safe_file_part(filename_prefix, 'image')}.{ext}"
        filepath = os.path.realpath(os.path.join(image_dir, filename))
        if not filepath.startswith(image_dir + os.sep):
            raise ValueError("Đường dẫn lưu ảnh không hợp lệ")

        max_size = 600 if ("sig" in filename_prefix or "stamp" in filename_prefix) else 1_200
        save_format = {"png": "PNG", "jpg": "JPEG", "webp": "WEBP"}[ext]
        image = _prepare_image_for_output(image, save_format, max_size)
        with tempfile.NamedTemporaryFile(
            mode="w+b",
            suffix=f".{ext}",
            prefix=".upload-",
            dir=image_dir,
            delete=False,
        ) as temporary:
            temporary_path = temporary.name
            image.save(temporary, format=save_format, **_save_kwargs(save_format))
            temporary.flush()
            os.fsync(temporary.fileno())
        if os.path.getsize(temporary_path) > MAX_IMAGE_UPLOAD_BYTES:
            raise ValueError("Ảnh sau xử lý vẫn vượt quá giới hạn dung lượng")
        os.replace(temporary_path, filepath)
        temporary_path = ""
        return f"images/{subfolder}/{tenant_segment}/{filename}"
    except ValueError:
        raise
    except Exception as exc:
        log_error(exc, "Media.SaveImage")
        raise ValueError("Không thể xử lý và lưu ảnh an toàn") from exc
    finally:
        if temporary_path:
            try:
                os.remove(temporary_path)
            except OSError:
                pass


def _staging_file(staging_path: str) -> str:
    normalized = str(staging_path or "").replace("\\", "/").lstrip("/")
    if not re.fullmatch(
        r"\.staging/t-[a-f0-9]{24}/m-[a-f0-9]{24}/[A-Za-z0-9_.-]+\.(?:png|jpg|webp)",
        normalized,
        re.IGNORECASE,
    ):
        return ""
    images_root = os.path.realpath(IMAGE_DIR)
    file_path = os.path.realpath(os.path.join(images_root, *normalized.split("/")))
    staging_root = os.path.realpath(os.path.join(images_root, ".staging"))
    return file_path if file_path.startswith(staging_root + os.sep) else ""


def stage_base64_image(
    base64_str: str,
    subfolder: str,
    filename_prefix: str,
    *,
    tenant_id: str,
    client_mutation_id: str,
) -> dict:
    """Validate and write an image to a non-public staging namespace."""

    if subfolder not in ALLOWED_IMAGE_SUBFOLDERS:
        raise ValueError("Thư mục lưu ảnh không hợp lệ")
    mutation_id = str(client_mutation_id or "").strip()
    if not mutation_id:
        raise ValueError("Thiếu clientMutationId khi lưu ảnh")
    _mime, ext, image = _decode_and_validate_image(base64_str)
    tenant_segment = managed_image_tenant_segment(tenant_id)
    mutation_segment = "m-" + hashlib.sha256(mutation_id.encode()).hexdigest()[:24]
    safe_prefix = _safe_file_part(filename_prefix, "image")
    final_name = f"{safe_prefix}.{ext}"
    staging_name = f"{safe_prefix}.{uuid.uuid4().hex}.{ext}"
    staging_path = f".staging/{tenant_segment}/{mutation_segment}/{staging_name}"
    staging_file = _staging_file(staging_path)
    if not staging_file:
        raise ValueError("Đường dẫn staging không hợp lệ")
    os.makedirs(os.path.dirname(staging_file), exist_ok=True)
    save_format = {"png": "PNG", "jpg": "JPEG", "webp": "WEBP"}[ext]
    max_size = 600 if ("sig" in filename_prefix or "stamp" in filename_prefix) else 1_200
    image = _prepare_image_for_output(image, save_format, max_size)
    temporary_path = ""
    try:
        with tempfile.NamedTemporaryFile(
            mode="w+b",
            suffix=f".{ext}",
            prefix=".stage-",
            dir=os.path.dirname(staging_file),
            delete=False,
        ) as temporary:
            temporary_path = temporary.name
            image.save(temporary, format=save_format, **_save_kwargs(save_format))
            temporary.flush()
            os.fsync(temporary.fileno())
        size_bytes = os.path.getsize(temporary_path)
        if size_bytes <= 0 or size_bytes > MAX_IMAGE_UPLOAD_BYTES:
            raise ValueError("Ảnh staging vượt quá giới hạn dung lượng")
        with open(temporary_path, "rb") as staged_input:
            digest = hashlib.sha256(staged_input.read()).hexdigest()
        os.replace(temporary_path, staging_file)
        temporary_path = ""
        return {
            "id": uuid.uuid4().hex,
            "organization_id": str(tenant_id),
            "client_mutation_id": mutation_id,
            "staging_path": staging_path,
            "managed_path": f"images/{subfolder}/{tenant_segment}/{final_name}",
            "sha256": digest,
            "size_bytes": size_bytes,
        }
    finally:
        if temporary_path:
            try:
                os.remove(temporary_path)
            except OSError:
                pass


def register_staged_assets(cursor, assets) -> None:
    for asset in assets or ():
        cursor.execute(
            """INSERT INTO asset_journal (
                   id, organization_id, client_mutation_id,
                   staging_path, managed_path, sha256, size_bytes, status
               ) VALUES (?, ?, ?, ?, ?, ?, ?, 'staged')
               ON CONFLICT (organization_id, client_mutation_id, managed_path)
               DO UPDATE SET staging_path = EXCLUDED.staging_path,
                             sha256 = EXCLUDED.sha256,
                             size_bytes = EXCLUDED.size_bytes,
                             status = 'staged', updated_at = CURRENT_TIMESTAMP""",
            (
                asset["id"], asset["organization_id"],
                asset["client_mutation_id"], asset["staging_path"],
                asset["managed_path"], asset["sha256"], asset["size_bytes"],
            ),
        )


def _promote_staged_asset(asset) -> None:
    source = _staging_file(asset["staging_path"])
    destination = _managed_image_file(asset["managed_path"])
    if not source or not destination:
        raise ValueError("Đường dẫn asset journal không hợp lệ")
    if not os.path.isfile(source):
        if os.path.isfile(destination):
            return
        raise FileNotFoundError("ASSET_STAGE_MISSING")
    with open(source, "rb") as staged_input:
        digest = hashlib.sha256(staged_input.read()).hexdigest()
    if not hmac.compare_digest(digest, str(asset["sha256"])):
        raise ValueError("ASSET_STAGE_HASH_MISMATCH")
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    os.replace(source, destination)


def promote_staged_assets(connection, assets) -> list[str]:
    """Promote committed journal entries; failed entries remain reconcilable."""

    promoted = []
    for asset in assets or ():
        try:
            _promote_staged_asset(asset)
            connection.execute(
                """UPDATE asset_journal
                   SET status = 'promoted', attempt_count = attempt_count + 1,
                       last_error_code = NULL, updated_at = CURRENT_TIMESTAMP
                   WHERE organization_id = ? AND client_mutation_id = ?
                     AND managed_path = ? AND status = 'staged'""",
                (
                    asset["organization_id"], asset["client_mutation_id"],
                    asset["managed_path"],
                ),
            )
            promoted.append(asset["managed_path"])
        except Exception as exc:  # noqa: BLE001 - journal records every promotion failure
            connection.execute(
                """UPDATE asset_journal
                   SET attempt_count = attempt_count + 1,
                       status = CASE WHEN attempt_count + 1 >= 5
                                     THEN 'failed' ELSE 'staged' END,
                       last_error_code = ?, updated_at = CURRENT_TIMESTAMP
                   WHERE organization_id = ? AND client_mutation_id = ?
                     AND managed_path = ? AND status = 'staged'""",
                (
                    exc.__class__.__name__[:96], asset["organization_id"],
                    asset["client_mutation_id"], asset["managed_path"],
                ),
            )
    connection.commit()
    return promoted


def discard_staged_assets(assets) -> None:
    for asset in assets or ():
        source = _staging_file(asset.get("staging_path"))
        if source:
            try:
                os.remove(source)
            except OSError:
                pass


def reconcile_asset_journal(database, *, batch_size: int = 100) -> int:
    """Retry committed promotions and sweep old row-less staging files."""

    connection = database.get_connection()
    try:
        rows = connection.execute(
            """SELECT id, organization_id, client_mutation_id, staging_path,
                      managed_path, sha256, size_bytes
               FROM asset_journal
               WHERE status = 'staged'
               ORDER BY created_at, id
               LIMIT ?""",
            (max(1, min(1000, int(batch_size))),),
        ).fetchall()
        assets = [dict(row) for row in rows]
        promoted = len(promote_staged_assets(connection, assets))
    finally:
        connection.close()
    sweep_orphaned_staged_assets(database)
    return promoted


def sweep_orphaned_staged_assets(
    database,
    *,
    grace_seconds: int = 300,
    now: float | None = None,
) -> int:
    """Delete old staging files that have no committed journal row."""

    staging_root = os.path.realpath(os.path.join(IMAGE_DIR, ".staging"))
    if not os.path.isdir(staging_root):
        return 0
    connection = database.get_connection()
    try:
        referenced = {
            str(row[0]).replace("\\", "/")
            for row in connection.execute(
                "SELECT staging_path FROM asset_journal WHERE status = 'staged'"
            ).fetchall()
        }
    finally:
        connection.close()
    cutoff = float(time.time() if now is None else now) - max(60, int(grace_seconds))
    removed = 0
    for root, directories, filenames in os.walk(staging_root, topdown=True):
        directories[:] = [
            name for name in directories
            if not os.path.islink(os.path.join(root, name))
        ]
        for filename in filenames:
            file_path = os.path.realpath(os.path.join(root, filename))
            if not file_path.startswith(staging_root + os.sep):
                continue
            relative = os.path.relpath(file_path, os.path.realpath(IMAGE_DIR)).replace("\\", "/")
            try:
                if relative in referenced or os.path.getmtime(file_path) > cutoff:
                    continue
                os.remove(file_path)
                removed += 1
            except OSError:
                continue
    return removed
