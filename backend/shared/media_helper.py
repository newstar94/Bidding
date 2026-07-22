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


def _safe_file_part(value: str, fallback: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(value or fallback))
    safe = safe.strip("._")
    return safe or fallback


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
    expected = _protected_media_signature(
        session_token,
        organization_id,
        normalize_managed_image_path(managed_path),
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
        r"images/(?:chuyen_gia|nha_thau)/[A-Za-z0-9_.-]+\.(?:png|jpg|webp)",
        path,
        re.IGNORECASE,
    ):
        return ""
    return path


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
    allowed_existing_paths=(),
) -> str:
    if not base64_str:
        return ""
    if subfolder not in ALLOWED_IMAGE_SUBFOLDERS:
        raise ValueError("Thư mục lưu ảnh không hợp lệ")

    existing_path = normalize_managed_image_path(base64_str)
    if existing_path:
        expected_prefix = f"images/{subfolder}/"
        if not existing_path.startswith(expected_prefix):
            raise ValueError("Ảnh hiện tại không thuộc đúng phạm vi lưu trữ")
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
        image_dir = os.path.realpath(os.path.join(images_root, subfolder))
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
        return f"images/{subfolder}/{filename}"
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
