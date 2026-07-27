"""Entrypoint for one isolated document task; not an HTTP-facing module."""

from __future__ import annotations

import os
import socket
import sys
from io import BytesIO
from pathlib import Path
from typing import Any

from backend.documents.document_ipc import read_job_manifest, write_result
from backend.documents.seccomp_policy import apply_document_seccomp


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
        if hasattr(resource, "RLIMIT_NPROC"):
            resource.setrlimit(resource.RLIMIT_NPROC, (1, 1))
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
        if os.environ.get("APP_ENV", "").lower() in {"prod", "production"}:
            expected_uid = int(os.environ["DOCUMENT_WORKER_SANDBOX_UID"])
            expected_gid = int(os.environ["DOCUMENT_WORKER_SANDBOX_GID"])
            parent_uid = int(os.environ["DOCUMENT_WORKER_PARENT_UID"])
            parent_gid = int(os.environ["DOCUMENT_WORKER_PARENT_GID"])
            if os.geteuid() != expected_uid or os.getegid() != expected_gid:
                raise RuntimeError(
                    "Worker không chạy bằng UID/GID sandbox đã cấu hình."
                )
            if os.geteuid() == parent_uid or os.getegid() == parent_gid:
                raise RuntimeError(
                    "Worker phải dùng UID/GID khác dịch vụ web."
                )
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
    if input_path.name != "input.json" or result_path.name != "result.json":
        raise ValueError("Tên tệp tác vụ tài liệu không hợp lệ.")


def _payload_content(payload):
    content = payload.get("content")
    if not isinstance(content, bytes) or len(content) > MAX_INPUT_CONTENT_BYTES:
        raise ValueError("Tệp công việc không tồn tại hoặc vượt giới hạn.")
    return content


def _run_operation(operation: str, payload: dict[str, Any]) -> Any:
    if (
        operation == "test_delay"
        and os.environ.get("APP_ENV", "").strip().casefold() == "test"
    ):
        import time

        time.sleep(min(10.0, max(0.0, float(payload.get("seconds", 0)))))
        return True

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

        context_manifest = payload.get("context_manifest")
        if not isinstance(context_manifest, dict):
            raise ValueError("Tác vụ Word thiếu manifest ngữ cảnh.")
        stream = generate_report_from_custom_template(
            payload["template_path"],
            payload["context"],
            context_manifest,
        )
        result = stream.getvalue()
        if len(result) > MAX_OUTPUT_BYTES:
            raise ValueError("Tệp Word kết quả vượt quá giới hạn kích thước.")
        return result

    if operation == "render_timeline_docx":
        from backend.documents.docx_context_policy import validate_docx_context_manifest
        from backend.documents.timeline_document_service import render_timeline_document

        validate_docx_context_manifest(
            payload.get("context"), payload.get("context_manifest")
        )
        stream = render_timeline_document(
            payload["template_path"],
            payload["context"],
        )
        result = stream.getvalue()
        if len(result) > MAX_OUTPUT_BYTES:
            raise ValueError("Tệp Word kết quả vượt quá giới hạn kích thước.")
        return result

    if operation == "export_excel":
        allowed_exports = {
            "create_excel_from_spec",
            "create_excel_template",
            "create_mothau_template",
            "create_phanlo_excel",
            "create_tuychonmuathem_excel",
        }
        function_name = payload.get("function")
        if function_name not in allowed_exports:
            raise ValueError("Loại xuất Excel không được hỗ trợ.")
        pure_exports = {
            "create_excel_from_spec",
            "create_excel_template",
            "create_mothau_template",
            "create_phanlo_excel",
            "create_tuychonmuathem_excel",
        }
        if function_name in pure_exports:
            from backend.documents import excel_workbook_builder as export_service
        else:
            from backend.documents import excel_service as export_service
        workbook = getattr(export_service, function_name)(*payload.get("args", []))
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
        apply_document_seccomp(
            required=os.environ.get("APP_ENV", "").lower() in {"prod", "production"}
        )
        operation, payload = read_job_manifest(input_path, input_path.parent.resolve())
        result = _run_operation(operation, payload)
        write_result(result_path, result=result)
    except Exception as exc:
        envelope = _safe_error(exc)
        try:
            write_result(
                result_path,
                error_type=envelope["error_type"],
                message=envelope["message"],
            )
        except Exception:
            return 4
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
