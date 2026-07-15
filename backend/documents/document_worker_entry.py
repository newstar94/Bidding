"""Entrypoint for one isolated document task; not an HTTP-facing module."""

from __future__ import annotations

import os
import pickle
import socket
import sys
from io import BytesIO
from pathlib import Path
from typing import Any


MAX_OUTPUT_BYTES = 64 * 1024 * 1024
MAX_INPUT_CONTENT_BYTES = 64 * 1024 * 1024


def _bounded_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return min(maximum, max(minimum, value))


def _apply_resource_limits() -> None:
    if os.name != "posix":
        return
    try:
        import resource

        memory_bytes = _bounded_int(
            "DOCUMENT_WORKER_MAX_MEMORY_MB", 768, 128, 2_048
        ) * 1024 * 1024
        cpu_seconds = _bounded_int("DOCUMENT_WORKER_CPU_SECONDS", 40, 5, 180)
        output_bytes = _bounded_int(
            "DOCUMENT_WORKER_MAX_OUTPUT_MB", 64, 8, 128
        ) * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds + 1))
        resource.setrlimit(resource.RLIMIT_FSIZE, (output_bytes, output_bytes))
        resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    except (ImportError, OSError, ValueError):
        if os.environ.get("APP_ENV", "").lower() in {"prod", "production"}:
            raise RuntimeError("Không thể áp dụng giới hạn tài nguyên cho worker.")


def _drop_privileges() -> None:
    require_drop = os.environ.get(
        "DOCUMENT_WORKER_REQUIRE_PRIVILEGE_DROP", "false"
    ).lower() == "true"
    uid_raw = os.environ.get("DOCUMENT_WORKER_UID", "").strip()
    gid_raw = os.environ.get("DOCUMENT_WORKER_GID", "").strip()
    if os.name == "posix":
        if gid_raw:
            os.setgid(int(gid_raw))
        if uid_raw:
            os.setuid(int(uid_raw))
        if require_drop and hasattr(os, "geteuid") and os.geteuid() == 0:
            raise RuntimeError("Worker vẫn đang chạy bằng tài khoản root.")
    elif require_drop:
        # Windows cannot change the token safely from Python. The service must
        # itself run under a dedicated non-administrator account.
        raise RuntimeError(
            "Không thể hạ quyền worker trên Windows; hãy dùng tài khoản dịch vụ hạn chế."
        )


def _disable_network() -> None:
    class _BlockedSocket:
        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            raise PermissionError("Document worker network access is disabled")

    socket.socket = _BlockedSocket  # type: ignore[assignment]
    socket.create_connection = _BlockedSocket  # type: ignore[assignment]


def _validate_job_paths(input_path: Path, result_path: Path) -> None:
    job_dir = Path(os.environ["DOCUMENT_WORKER_JOB_DIR"]).resolve()
    if input_path.resolve().parent != job_dir or result_path.resolve().parent != job_dir:
        raise ValueError("Đường dẫn tác vụ tài liệu không hợp lệ.")
    if input_path.name != "input.pkl" or result_path.name != "result.pkl":
        raise ValueError("Tên tệp tác vụ tài liệu không hợp lệ.")


def _payload_content(payload):
    if "content_path" in payload:
        path = Path(str(payload["content_path"])).resolve()
        if not path.is_file() or path.stat().st_size > MAX_INPUT_CONTENT_BYTES:
            raise ValueError("Tệp công việc không tồn tại hoặc vượt giới hạn.")
        return path.read_bytes()
    return payload["content"]


def _run_operation(operation: str, payload: dict[str, Any]) -> Any:
    if operation == "validate_docx":
        from backend.documents.archive_validation import validate_ooxml_archive
        from backend.documents.template_security import validate_docx_template_statements

        content = _payload_content(payload)
        validate_ooxml_archive(content, "docx")
        validate_docx_template_statements(content)
        return True

    if operation == "validate_ooxml":
        from backend.documents.archive_validation import validate_ooxml_archive

        kind = payload.get("kind")
        if kind not in {"docx", "xlsx"}:
            raise ValueError("Loại tệp Office không được hỗ trợ.")
        validate_ooxml_archive(_payload_content(payload), kind)
        return True

    if operation == "parse_excel":
        from backend.documents.archive_validation import validate_ooxml_archive
        from backend.documents.excel_handler import parse_excel

        content = _payload_content(payload)
        if payload.get("kind") == "xlsx":
            validate_ooxml_archive(content, "xlsx")
        rows = parse_excel(content, payload["import_type"])
        try:
            max_rows = int(os.environ.get("EXCEL_MAX_IMPORT_ROWS", "10000"))
        except (TypeError, ValueError):
            max_rows = 10000
        max_rows = min(100_000, max(100, max_rows))
        if len(rows) > max_rows:
            raise ValueError("Tệp Excel có quá nhiều dòng dữ liệu.")
        return rows

    if operation == "render_docx":
        from backend.documents.custom_exporter import generate_report_from_custom_template

        stream = generate_report_from_custom_template(
            payload["template_path"],
            payload["context"],
            payload.get("custom_vars"),
        )
        result = stream.getvalue()
        if len(result) > MAX_OUTPUT_BYTES:
            raise ValueError("Tệp Word kết quả vượt quá giới hạn kích thước.")
        return result

    if operation == "export_excel":
        from backend.documents import excel_service

        allowed_exports = {
            "create_danhgiahsdt_template",
            "create_excel_template",
            "create_ketquaqd_template",
            "create_mothau_template",
            "create_opening_fin_template",
            "create_phanlo_excel",
            "create_tuychonmuathem_excel",
        }
        function_name = payload.get("function")
        if function_name not in allowed_exports:
            raise ValueError("Loại xuất Excel không được hỗ trợ.")
        workbook = getattr(excel_service, function_name)(*payload.get("args", []))
        output = BytesIO()
        workbook.save(output)
        result = output.getvalue()
        if len(result) > MAX_OUTPUT_BYTES:
            raise ValueError("Tệp Excel kết quả vượt quá giới hạn kích thước.")
        return result

    raise ValueError("Tác vụ tài liệu không được hỗ trợ.")


def _safe_error(exc: Exception) -> dict[str, Any]:
    public_types = {"TemplateRenderError", "UnsafeArchiveError", "ValueError"}
    error_type = type(exc).__name__
    if error_type in public_types:
        message = str(exc)[:500]
    else:
        message = "Tác vụ tài liệu không thành công."
    return {"ok": False, "error_type": error_type, "message": message}


def main() -> int:
    if len(sys.argv) != 3:
        return 2
    input_path = Path(sys.argv[1])
    result_path = Path(sys.argv[2])
    try:
        _validate_job_paths(input_path, result_path)
        _apply_resource_limits()
        _drop_privileges()
        _disable_network()
        with input_path.open("rb") as input_file:
            job = pickle.load(input_file)
        if not isinstance(job, dict) or not isinstance(job.get("payload"), dict):
            raise ValueError("Dữ liệu tác vụ tài liệu không hợp lệ.")
        envelope = {
            "ok": True,
            "result": _run_operation(job.get("operation"), job["payload"]),
        }
    except Exception as exc:
        envelope = _safe_error(exc)

    temporary_result = result_path.with_suffix(".tmp")
    try:
        with temporary_result.open("wb") as result_file:
            pickle.dump(envelope, result_file, protocol=pickle.HIGHEST_PROTOCOL)
        if temporary_result.stat().st_size > MAX_OUTPUT_BYTES:
            temporary_result.unlink(missing_ok=True)
            return 3
        os.replace(temporary_result, result_path)
    except Exception:
        temporary_result.unlink(missing_ok=True)
        return 4
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
