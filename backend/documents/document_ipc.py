"""Schema-checked JSON and hashed sidecars for document-worker IPC."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import stat
from typing import Any


IPC_VERSION = 1
JOB_FORMAT = "biddingflow-document-job"
RESULT_FORMAT = "biddingflow-document-result"
MAX_MANIFEST_BYTES = 16 * 1024 * 1024
MAX_SIDECAR_BYTES = 64 * 1024 * 1024
MAX_TOTAL_BYTES = 64 * 1024 * 1024
MAX_DEPTH = 16
MAX_COLLECTION_ITEMS = 100_000
MAX_STRING_BYTES = 4 * 1024 * 1024
ALLOWED_OPERATIONS = frozenset({
    "validate_docx",
    "validate_ooxml",
    "parse_excel",
    "render_docx",
    "render_timeline_docx",
    "export_excel",
})
_FILE_MARKER = "__biddingflow_file_v1__"


class DocumentIpcError(ValueError):
    """Raised when an IPC manifest or sidecar violates its contract."""


@dataclass(frozen=True)
class _FileSource:
    path: Path
    materialize_as: str


def _operation_allowed(operation: object) -> bool:
    return operation in ALLOWED_OPERATIONS or (
        operation == "test_delay"
        and os.environ.get("APP_ENV", "").strip().casefold() == "test"
    )


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _file_metadata(path: Path, materialize_as: str) -> dict[str, Any]:
    size = path.stat().st_size
    if size < 0 or size > MAX_SIDECAR_BYTES:
        raise DocumentIpcError("Tệp nhị phân IPC vượt quá giới hạn.")
    return {
        _FILE_MARKER: {
            "name": path.name,
            "size": size,
            "sha256": _sha256_file(path),
            "materializeAs": materialize_as,
        }
    }


def _write_bytes(path: Path, content: bytes) -> None:
    if len(content) > MAX_SIDECAR_BYTES:
        raise DocumentIpcError("Tệp nhị phân IPC vượt quá giới hạn.")
    with path.open("xb") as handle:
        handle.write(content)


def _copy_source(source: Path, destination: Path) -> None:
    resolved = source.resolve(strict=True)
    if source.is_symlink() or not resolved.is_file():
        raise DocumentIpcError("Nguồn tệp IPC không hợp lệ.")
    size = resolved.stat().st_size
    if size < 0 or size > MAX_SIDECAR_BYTES:
        raise DocumentIpcError("Nguồn tệp IPC vượt quá giới hạn.")
    with resolved.open("rb") as source_handle, destination.open("xb") as destination_handle:
        shutil.copyfileobj(source_handle, destination_handle, length=1024 * 1024)


def _copy_referenced_images(context: Any, job_dir: Path, image_root: Path) -> int:
    references: set[tuple[str, str]] = set()

    def collect(value: Any, depth: int = 0) -> None:
        if depth > MAX_DEPTH:
            return
        if isinstance(value, dict):
            for child in value.values():
                collect(child, depth + 1)
        elif isinstance(value, list):
            for child in value:
                collect(child, depth + 1)
        elif isinstance(value, str):
            normalized = value.strip().replace("\\", "/").lstrip("/")
            parts = normalized.split("/")
            if len(parts) == 3 and parts[0] == "images" and parts[1] in {"chuyen_gia", "nha_thau"}:
                filename = parts[2]
                if filename not in {"", ".", ".."} and "/" not in filename and "\\" not in filename:
                    references.add((parts[1], filename))

    collect(context)
    total_bytes = 0
    for folder, filename in references:
        source_root = (image_root / folder).resolve()
        source_candidate = source_root / filename
        source = source_candidate.resolve()
        try:
            if os.path.commonpath([str(source_root), str(source)]) != str(source_root) or not source.is_file():
                continue
        except (OSError, ValueError):
            continue
        target_root = job_dir / "assets" / "images" / folder
        target_root.mkdir(parents=True, exist_ok=True)
        _copy_source(source_candidate, target_root / filename)
        total_bytes += source.stat().st_size
        if total_bytes > MAX_TOTAL_BYTES:
            raise DocumentIpcError("Tổng kích thước ảnh của tác vụ vượt quá giới hạn.")
    return total_bytes


def _json_tree(value: Any, job_dir: Path, state: dict[str, int], *, depth: int = 0) -> Any:
    if depth > MAX_DEPTH:
        raise DocumentIpcError("Dữ liệu IPC lồng quá sâu.")
    if value is None or isinstance(value, bool) or isinstance(value, int):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise DocumentIpcError("Dữ liệu IPC chứa số không hữu hạn.")
        return value
    if isinstance(value, str):
        if len(value.encode("utf-8")) > MAX_STRING_BYTES:
            raise DocumentIpcError("Chuỗi IPC vượt quá giới hạn.")
        return value
    if isinstance(value, (bytes, bytearray, memoryview)):
        index = state["files"]
        state["files"] += 1
        path = job_dir / f"input-{index:04d}.bin"
        _write_bytes(path, bytes(value))
        state["bytes"] += path.stat().st_size
        return _file_metadata(path, "bytes")
    if isinstance(value, _FileSource):
        index = state["files"]
        state["files"] += 1
        path = job_dir / f"input-{index:04d}.bin"
        _copy_source(value.path, path)
        state["bytes"] += path.stat().st_size
        return _file_metadata(path, value.materialize_as)
    if isinstance(value, list):
        state["items"] += len(value)
        if state["items"] > MAX_COLLECTION_ITEMS:
            raise DocumentIpcError("Dữ liệu IPC có quá nhiều phần tử.")
        return [_json_tree(item, job_dir, state, depth=depth + 1) for item in value]
    if isinstance(value, dict):
        if _FILE_MARKER in value or not all(isinstance(key, str) for key in value):
            raise DocumentIpcError("Khóa đối tượng IPC không hợp lệ.")
        state["items"] += len(value)
        if state["items"] > MAX_COLLECTION_ITEMS:
            raise DocumentIpcError("Dữ liệu IPC có quá nhiều phần tử.")
        return {
            key: _json_tree(child, job_dir, state, depth=depth + 1)
            for key, child in value.items()
        }
    raise DocumentIpcError(f"Kiểu dữ liệu IPC không được hỗ trợ: {type(value).__name__}.")


def write_job_manifest(path: Path, operation: str, payload: dict[str, Any], *, image_root: Path) -> None:
    if not _operation_allowed(operation) or not isinstance(payload, dict):
        raise DocumentIpcError("Tác vụ tài liệu không được hỗ trợ.")
    prepared = dict(payload)
    if "content_path" in prepared:
        prepared["content"] = _FileSource(Path(str(prepared.pop("content_path"))), "bytes")
    if "template_path" in prepared:
        prepared["template_path"] = _FileSource(Path(str(prepared["template_path"])), "path")
    image_bytes = 0
    if "context" in prepared:
        image_bytes = _copy_referenced_images(prepared["context"], path.parent, image_root)

    state = {"files": 0, "bytes": image_bytes, "items": 0}
    manifest = {
        "format": JOB_FORMAT,
        "version": IPC_VERSION,
        "operation": operation,
        "payload": _json_tree(prepared, path.parent, state),
    }
    encoded = json.dumps(manifest, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if len(encoded) > MAX_MANIFEST_BYTES or state["bytes"] + len(encoded) > MAX_TOTAL_BYTES:
        raise DocumentIpcError("Dữ liệu đầu vào của tác vụ quá lớn.")
    with path.open("xb") as handle:
        handle.write(encoded)


def _read_json(path: Path) -> dict[str, Any]:
    file_stat = path.lstat()
    if not stat.S_ISREG(file_stat.st_mode) or file_stat.st_size > MAX_MANIFEST_BYTES:
        raise DocumentIpcError("Manifest IPC không hợp lệ.")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise DocumentIpcError("Manifest IPC không phải JSON hợp lệ.") from exc
    if not isinstance(value, dict):
        raise DocumentIpcError("Manifest IPC không hợp lệ.")
    return value


def _materialize(value: Any, job_dir: Path, *, depth: int = 0) -> Any:
    if depth > MAX_DEPTH:
        raise DocumentIpcError("Dữ liệu IPC lồng quá sâu.")
    if isinstance(value, list):
        return [_materialize(item, job_dir, depth=depth + 1) for item in value]
    if not isinstance(value, dict):
        return value
    if set(value) == {_FILE_MARKER}:
        metadata = value[_FILE_MARKER]
        if not isinstance(metadata, dict) or set(metadata) != {"name", "size", "sha256", "materializeAs"}:
            raise DocumentIpcError("Metadata tệp IPC không hợp lệ.")
        name = metadata["name"]
        if not isinstance(name, str) or not name.startswith("input-") or not name.endswith(".bin") or Path(name).name != name:
            raise DocumentIpcError("Tên tệp IPC không hợp lệ.")
        file_path = (job_dir / name).resolve(strict=True)
        if file_path.parent != job_dir or file_path.is_symlink():
            raise DocumentIpcError("Đường dẫn tệp IPC không hợp lệ.")
        size = metadata["size"]
        digest = metadata["sha256"]
        if not isinstance(size, int) or size < 0 or size > MAX_SIDECAR_BYTES or file_path.stat().st_size != size:
            raise DocumentIpcError("Kích thước tệp IPC không hợp lệ.")
        if not isinstance(digest, str) or len(digest) != 64 or _sha256_file(file_path) != digest:
            raise DocumentIpcError("Hash tệp IPC không hợp lệ.")
        if metadata["materializeAs"] == "bytes":
            return file_path.read_bytes()
        if metadata["materializeAs"] == "path":
            return str(file_path)
        raise DocumentIpcError("Kiểu tệp IPC không hợp lệ.")
    if _FILE_MARKER in value:
        raise DocumentIpcError("Đối tượng IPC giả mạo metadata tệp.")
    return {key: _materialize(child, job_dir, depth=depth + 1) for key, child in value.items()}


def read_job_manifest(path: Path, job_dir: Path) -> tuple[str, dict[str, Any]]:
    manifest = _read_json(path)
    if set(manifest) != {"format", "version", "operation", "payload"}:
        raise DocumentIpcError("Schema manifest tác vụ không hợp lệ.")
    if (
        manifest["format"] != JOB_FORMAT
        or manifest["version"] != IPC_VERSION
        or not _operation_allowed(manifest["operation"])
    ):
        raise DocumentIpcError("Phiên bản hoặc tác vụ IPC không hợp lệ.")
    payload = _materialize(manifest["payload"], job_dir)
    if not isinstance(payload, dict):
        raise DocumentIpcError("Payload tác vụ không hợp lệ.")
    return manifest["operation"], payload


def write_result(path: Path, *, result: Any = None, error_type: str | None = None, message: str | None = None) -> None:
    job_dir = path.parent
    if error_type is None:
        if isinstance(result, (bytes, bytearray, memoryview)):
            binary_path = job_dir / "result.bin"
            _write_bytes(binary_path, bytes(result))
            result_value = _file_metadata(binary_path, "bytes")
        else:
            result_value = _json_tree(result, job_dir, {"files": 0, "bytes": 0, "items": 0})
        envelope = {"format": RESULT_FORMAT, "version": IPC_VERSION, "ok": True, "result": result_value}
    else:
        envelope = {
            "format": RESULT_FORMAT,
            "version": IPC_VERSION,
            "ok": False,
            "errorType": str(error_type)[:128],
            "message": str(message or "Tác vụ tài liệu không thành công.")[:500],
        }
    encoded = json.dumps(envelope, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if len(encoded) > MAX_MANIFEST_BYTES:
        raise DocumentIpcError("Kết quả JSON của worker vượt quá giới hạn.")
    temporary = path.with_suffix(".tmp")
    with temporary.open("xb") as handle:
        handle.write(encoded)
    os.replace(temporary, path)


def read_result(path: Path, job_dir: Path) -> tuple[bool, Any, str, str]:
    envelope = _read_json(path)
    if envelope.get("format") != RESULT_FORMAT or envelope.get("version") != IPC_VERSION or not isinstance(envelope.get("ok"), bool):
        raise DocumentIpcError("Kết quả IPC không hợp lệ.")
    if envelope["ok"]:
        if set(envelope) != {"format", "version", "ok", "result"}:
            raise DocumentIpcError("Schema kết quả IPC không hợp lệ.")
        result = envelope["result"]
        if isinstance(result, dict) and set(result) == {_FILE_MARKER}:
            metadata = result[_FILE_MARKER]
            if not isinstance(metadata, dict) or metadata.get("name") != "result.bin" or metadata.get("materializeAs") != "bytes":
                raise DocumentIpcError("Metadata kết quả nhị phân không hợp lệ.")
            result_path = (job_dir / "result.bin").resolve(strict=True)
            if result_path.parent != job_dir or result_path.is_symlink():
                raise DocumentIpcError("Đường dẫn kết quả nhị phân không hợp lệ.")
            size = metadata.get("size")
            digest = metadata.get("sha256")
            if not isinstance(size, int) or size < 0 or size > MAX_SIDECAR_BYTES or result_path.stat().st_size != size:
                raise DocumentIpcError("Kích thước kết quả nhị phân không hợp lệ.")
            if not isinstance(digest, str) or _sha256_file(result_path) != digest:
                raise DocumentIpcError("Hash kết quả nhị phân không hợp lệ.")
            result = result_path.read_bytes()
        return True, result, "", ""
    if set(envelope) != {"format", "version", "ok", "errorType", "message"}:
        raise DocumentIpcError("Schema lỗi IPC không hợp lệ.")
    return False, None, str(envelope["errorType"]), str(envelope["message"])
