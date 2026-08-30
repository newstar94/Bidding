"""Bounded subprocess runner for untrusted/expensive document operations."""

from __future__ import annotations

import asyncio
import concurrent.futures
import hashlib
import json
import os
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from backend.shared.paths import IMAGE_DIR, PROJECT_ROOT, resolve_runtime_path
from backend.documents.document_ipc import (
    DocumentIpcError,
    WORKER_EVENT_PREFIX,
    read_job_manifest,
    read_result,
    write_job_manifest,
    write_render_cache_overlay,
)
from backend.documents.document_sandbox import (
    sandbox_worker_command,
    validate_document_sandbox_configuration,
)
from backend.documents.seccomp_policy import seccomp_library_name
from backend.observability.recording import (
    document_worker_acquired,
    document_worker_finished,
    document_worker_rejected,
    document_worker_wait_started,
)
from backend.shared.idle_backoff import idle_poll_backoff_from_env
from backend.shared.audit_chain import insert_audit_row
from backend.shared.logging_utils import log_structured_event
from backend.documents.document_job_policy import (
    DocumentJobAuthorizationError,
    validate_document_job_policy_snapshot,
    verify_document_job_policy,
)
from backend.documents.document_source_authority import (
    verify_document_job_source_authority,
)
from backend.usage_analytics.service import (
    record_word_export_success_best_effort,
)


DEFAULT_TIMEOUT_SECONDS = 45.0
_BUSY_MESSAGE = (
    "Hệ thống đang xử lý quá nhiều tài liệu. Vui lòng thử lại sau."
)


class DocumentWorkerError(RuntimeError):
    """Safe, public error returned when an isolated document job fails."""


class DocumentWorkerInputError(ValueError):
    """The worker rejected document input or a template expression."""


class DocumentWorkerBusyError(DocumentWorkerError):
    """All local document worker slots are currently occupied."""


class DocumentWorkerTimeoutError(DocumentWorkerError):
    """A document job exceeded its configured deadline."""


_WORKER_EVENT_FIELDS = frozenset({
    "mode",
    "status",
    "effectiveProfile",
    "detectedDocumentType",
    "documentTypeConfidence",
    "documentTypeConflictCount",
    "plannedRuleCount",
    "plannedTargetCount",
    "storyPartCount",
    "storyXmlBytes",
    "stylesXmlBytes",
    "paragraphCount",
    "runCount",
    "styleCount",
    "preservation",
    "engineVersion",
    "policyVersion",
})


def _record_worker_events(output: bytes) -> None:
    """Record only code-owned, low-cardinality events from the sandbox."""

    prefix = WORKER_EVENT_PREFIX.encode("ascii")
    for line in bytes(output or b"").splitlines():
        if not line.startswith(prefix) or len(line) > 16 * 1024:
            continue
        try:
            event = json.loads(line[len(prefix):].decode("ascii"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
        if (
            not isinstance(event, dict)
            or event.get("event") != "document.word_standardization"
            or not isinstance(event.get("fields"), dict)
        ):
            continue
        fields = {
            key: value
            for key, value in event["fields"].items()
            if key in _WORKER_EVENT_FIELDS
            and isinstance(value, (bool, int, float, str))
        }
        try:
            log_structured_event(
                "document.word_standardization",
                fields=fields,
                nonblocking=True,
            )
        except Exception:  # noqa: BLE001 - observability cannot fail an export
            continue


_semaphore_guard = threading.Lock()
_semaphore: threading.BoundedSemaphore | None = None
_semaphore_size: int | None = None
_async_runtime_guard = threading.Lock()


class _AsyncWorkerRuntime:
    """One bounded executor generation for async document submissions."""

    def __init__(self, concurrency: int, queue_size: int) -> None:
        self.config = (concurrency, queue_size)
        self.capacity = concurrency + queue_size
        # Every admitted call gets at most one thread. Threads waiting for the
        # process semaphore are therefore bounded by ``capacity`` as well.
        self.executor = concurrent.futures.ThreadPoolExecutor(
            max_workers=self.capacity,
            thread_name_prefix="document-worker",
        )
        self.admission = threading.BoundedSemaphore(self.capacity)


_async_runtime: _AsyncWorkerRuntime | None = None


def document_worker_execution_mode(environ=None) -> str:
    """Return the queue execution boundary selected for this process."""

    environment = os.environ if environ is None else environ
    production = str(environment.get("APP_ENV", "development")).strip().casefold() in {
        "prod",
        "production",
    }
    raw_mode = str(environment.get("DOCUMENT_WORKER_EXECUTION_MODE", "")).strip().casefold()
    if not raw_mode:
        if production:
            raise RuntimeError(
                "DOCUMENT_WORKER_EXECUTION_MODE=external is required in production."
            )
        return "embedded"
    if raw_mode not in {"embedded", "external"}:
        raise RuntimeError(
            "DOCUMENT_WORKER_EXECUTION_MODE must be embedded or external."
        )
    if production and raw_mode != "external":
        raise RuntimeError(
            "Production web processes cannot execute document jobs; configure "
            "DOCUMENT_WORKER_EXECUTION_MODE=external."
        )
    return raw_mode


def external_document_worker_enabled(environ=None) -> bool:
    return document_worker_execution_mode(environ) == "external"


def _positive_int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return min(maximum, max(minimum, value))


def _bounded_float_env(
    name: str, default: float, minimum: float, maximum: float
) -> float:
    try:
        value = float(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return min(maximum, max(minimum, value))


def _worker_semaphore() -> threading.BoundedSemaphore:
    global _semaphore, _semaphore_size
    size = _positive_int_env("DOCUMENT_WORKER_MAX_CONCURRENCY", 4, 1, 8)
    with _semaphore_guard:
        if _semaphore is None or _semaphore_size != size:
            _semaphore = threading.BoundedSemaphore(size)
            _semaphore_size = size
        return _semaphore


def _worker_environment(job_dir: Path) -> dict[str, str]:
    allowed_names = {
        "APP_ENV",
        "COMSPEC",
        "DOCUMENT_WORKER_CPU_SECONDS",
        "DOCUMENT_WORKER_GID",
        "DOCUMENT_WORKER_MAX_MEMORY_MB",
        "DOCUMENT_WORKER_MAX_OUTPUT_MB",
        "DOCUMENT_WORKER_REQUIRE_PRIVILEGE_DROP",
        "DOCUMENT_WORKER_SECCOMP_LIBRARY",
        "DOCUMENT_WORKER_SANDBOX_GID",
        "DOCUMENT_WORKER_SANDBOX_UID",
        "DOCUMENT_WORKER_UID",
        "EXCEL_MAX_IMPORT_ROWS",
        "PATH",
        "PATHEXT",
        "SYSTEMDRIVE",
        "SYSTEMROOT",
        "TZ",
        "WINDIR",
        "WORD_EXPORT_STANDARDIZATION_MODE",
    }
    environment = {
        name: value
        for name, value in os.environ.items()
        if name.upper() in allowed_names
    }
    environment.update(
        {
            "MKL_NUM_THREADS": "1",
            "NUMEXPR_NUM_THREADS": "1",
            "OMP_NUM_THREADS": "1",
            "OPENBLAS_NUM_THREADS": "1",
            "PYTHONIOENCODING": "utf-8",
            # Import only the worker entrypoint and its allowlisted document
            # modules from the application tree. The child starts in its
            # private job directory and never receives the database path.
            "PYTHONPATH": str(PROJECT_ROOT),
            "PYTHONUNBUFFERED": "1",
            "DOCUMENT_WORKER_JOB_DIR": str(job_dir),
            "BIDDING_DATA_DIR": str(job_dir / "assets"),
            "BIDDING_LOG_DIR": str(job_dir / "logs"),
            "BIDDING_UPLOAD_DIR": str(job_dir / "assets" / "images"),
            "BIDDING_WORD_TEMPLATE_DIR": str(job_dir / "assets" / "words"),
            "TEMP": str(job_dir),
            "TMP": str(job_dir),
        }
    )
    if os.name == "posix" and hasattr(os, "geteuid"):
        environment["DOCUMENT_WORKER_PARENT_UID"] = str(os.geteuid())
        environment["DOCUMENT_WORKER_PARENT_GID"] = str(os.getegid())
        library_name = seccomp_library_name()
        if library_name:
            environment["DOCUMENT_WORKER_SECCOMP_LIBRARY"] = library_name
    return environment


def _prepare_privilege_drop(job_dir: Path) -> None:
    if os.name != "posix" or not hasattr(os, "chown"):
        return
    uid_raw = os.environ.get("DOCUMENT_WORKER_UID", "").strip()
    gid_raw = os.environ.get("DOCUMENT_WORKER_GID", "").strip()
    if not uid_raw and not gid_raw:
        return
    uid = int(uid_raw) if uid_raw else -1
    gid = int(gid_raw) if gid_raw else -1
    os.chown(job_dir, uid, gid)
    os.chmod(job_dir, 0o700)
    for child in job_dir.rglob("*"):
        os.chown(child, uid, gid)
        os.chmod(child, 0o700 if child.is_dir() else 0o600)


def _terminate_process(process: subprocess.Popen[bytes]) -> None:
    try:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGKILL)
        else:
            process.kill()
    except (OSError, ProcessLookupError):
        pass
    try:
        process.communicate(timeout=5)
    except (subprocess.SubprocessError, OSError):
        pass


def _assign_windows_job_object(process: subprocess.Popen[bytes]) -> int | None:
    """Apply an OS-enforced memory/child-process quota on Windows."""

    if os.name != "nt" or not hasattr(process, "_handle"):
        return None
    import ctypes
    from ctypes import wintypes

    class IO_COUNTERS(ctypes.Structure):
        _fields_ = [
            ("ReadOperationCount", ctypes.c_ulonglong),
            ("WriteOperationCount", ctypes.c_ulonglong),
            ("OtherOperationCount", ctypes.c_ulonglong),
            ("ReadTransferCount", ctypes.c_ulonglong),
            ("WriteTransferCount", ctypes.c_ulonglong),
            ("OtherTransferCount", ctypes.c_ulonglong),
        ]

    class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_longlong),
            ("PerJobUserTimeLimit", ctypes.c_longlong),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
            ("IoInfo", IO_COUNTERS),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateJobObjectW.restype = wintypes.HANDLE
    kernel32.SetInformationJobObject.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        ctypes.c_void_p,
        wintypes.DWORD,
    ]
    kernel32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]

    job_handle = kernel32.CreateJobObjectW(None, None)
    if not job_handle:
        raise ctypes.WinError(ctypes.get_last_error())
    limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
    limits.BasicLimitInformation.LimitFlags = (
        0x00000002 | 0x00000100 | 0x00000008 | 0x00002000
    )
    limits.BasicLimitInformation.PerProcessUserTimeLimit = (
        _positive_int_env("DOCUMENT_WORKER_CPU_SECONDS", 40, 5, 180) * 10_000_000
    )
    # A Windows venv ``python.exe`` launcher creates the real interpreter as
    # one child process. The job therefore needs two slots while still
    # preventing the document code from creating an unbounded process tree.
    limits.BasicLimitInformation.ActiveProcessLimit = (
        1 if Path(sys.executable).resolve() == Path(getattr(sys, "_base_executable", sys.executable)).resolve() else 2
    )
    limits.ProcessMemoryLimit = (
        _positive_int_env("DOCUMENT_WORKER_MAX_MEMORY_MB", 768, 128, 2_048)
        * 1024
        * 1024
    )
    if not kernel32.SetInformationJobObject(
        job_handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)
    ):
        error = ctypes.WinError(ctypes.get_last_error())
        kernel32.CloseHandle(job_handle)
        raise error
    if not kernel32.AssignProcessToJobObject(job_handle, int(process._handle)):
        error = ctypes.WinError(ctypes.get_last_error())
        kernel32.CloseHandle(job_handle)
        raise error
    return int(job_handle)


def _close_windows_job_object(job_handle: int | None) -> None:
    if os.name == "nt" and job_handle:
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel32.CloseHandle(job_handle)


def _read_result(result_path: Path, job_dir: Path) -> Any:
    if not result_path.exists():
        raise DocumentWorkerError(
            "Tiến trình xử lý tài liệu kết thúc mà không trả về kết quả."
        )
    try:
        ok, result, error_type, message = read_result(result_path, job_dir)
    except (DocumentIpcError, OSError) as exc:
        raise DocumentWorkerError("Kết quả xử lý tài liệu không hợp lệ.") from exc
    if ok:
        return result
    message = str(message or "Tác vụ tài liệu không thành công.")[:500]
    if error_type in {"TemplateRenderError", "UnsafeArchiveError", "ValueError", "DocumentIpcError"}:
        raise DocumentWorkerInputError(message)
    if not isinstance(ok, bool):
        raise DocumentWorkerError("Kết quả xử lý tài liệu không hợp lệ.")
    raise DocumentWorkerError(message)


def _start_worker_process(
    command: list[str], popen_kwargs: dict[str, Any],
) -> subprocess.Popen[bytes]:
    """Start exactly one isolated document worker for a prepared job."""

    return subprocess.Popen(command, **popen_kwargs)


def _prepare_render_payload_cache(
    operation: str,
    payload: dict[str, Any],
    *,
    organization_scope: str | None = None,
) -> tuple[dict[str, Any], list[tuple[int, Any]], list[tuple[int, bytes]]]:
    """Stage cache hits and lease misses without starting another worker."""

    if operation not in {"render_docx", "render_docx_batch"}:
        return payload, [], []
    from backend.documents.word_export_cache import (
        acquire_standardized_template_cache,
    )

    context_manifest = payload.get("context_manifest")
    if not isinstance(context_manifest, dict):
        return payload, [], []
    cache_scope = str(
        organization_scope
        or context_manifest.get("media_organization_id")
        or "unscoped"
    )
    document_type_hint = context_manifest.get("document_type")
    mode = os.environ.get("WORD_EXPORT_STANDARDIZATION_MODE")

    def source_target(raw_target: dict[str, Any]) -> tuple[dict[str, Any], bytes | None]:
        target = dict(raw_target)
        if target.get("template_prestandardized") is True:
            return target, None
        if isinstance(target.get("template_content"), bytes):
            source = bytes(target["template_content"])
        elif target.get("template_path"):
            source = Path(str(target["template_path"])).read_bytes()
        else:
            raise DocumentWorkerInputError("Tác vụ Word thiếu nguồn biểu mẫu.")
        return target, source

    prepared_payload = dict(payload)
    if operation == "render_docx":
        raw_targets = [{
            key: prepared_payload.pop(key)
            for key in ("template_path", "template_content", "template_prestandardized")
            if key in prepared_payload
        }]
    else:
        templates = prepared_payload.get("templates")
        if not isinstance(templates, list) or not all(
            isinstance(target, dict) for target in templates
        ):
            raise DocumentWorkerInputError("Biểu mẫu Word theo lô không hợp lệ.")
        raw_targets = templates

    staged = [source_target(target) for target in raw_targets]
    groups: dict[str, list[int]] = {}
    sources: dict[str, bytes] = {}
    for index, (_target, source) in enumerate(staged):
        if source is None:
            continue
        digest = hashlib.sha256(source).hexdigest()
        groups.setdefault(digest, []).append(index)
        sources[digest] = source

    leases: list[tuple[int, Any]] = []
    overrides: list[tuple[int, bytes]] = []
    try:
        # Stable ordering prevents inverse batches from holding each other's locks.
        for digest in sorted(groups):
            cached, lease = acquire_standardized_template_cache(
                sources[digest],
                organization_scope=cache_scope,
                document_type_hint=document_type_hint,
                mode=mode,
            )
            if cached is not None:
                for index in groups[digest]:
                    target, _source = staged[index]
                    target.pop("template_path", None)
                    target["template_content"] = cached
                    target["template_prestandardized"] = True
                    target["standardization_cache_hit"] = True
                    overrides.append((index, cached))
            elif lease is not None:
                # One sidecar can populate the cache for duplicate source bytes.
                leases.append((groups[digest][0], lease))
    except Exception:
        _release_render_cache_leases(leases)
        raise

    targets = [target for target, _source in staged]
    if operation == "render_docx":
        prepared_payload.update(targets[0])
    else:
        prepared_payload["templates"] = targets
    return prepared_payload, leases, overrides


def _release_render_cache_leases(leases: list[tuple[int, Any]]) -> None:
    from backend.documents.word_export_cache import release_standardized_template_cache

    for _index, lease in leases:
        release_standardized_template_cache(lease)


def _publish_render_cache_sidecars(
    job_dir: Path, leases: list[tuple[int, Any]],
) -> None:
    """Publish only regular, bounded DOCX sidecars attested by the sandbox."""

    from backend.documents.archive_validation import validate_ooxml_archive
    from backend.documents.template_security import validate_docx_template_statements
    from backend.documents.word_export_cache import (
        publish_standardized_template_cache,
        release_standardized_template_cache,
    )

    resolved_job_dir = job_dir.resolve()
    for index, lease in leases:
        candidate = job_dir / f"prepared-template-{index:04d}.docx"
        try:
            candidate_stat = candidate.lstat()
            resolved = candidate.resolve(strict=True)
            if (
                resolved.parent != resolved_job_dir
                or candidate.is_symlink()
                or not stat.S_ISREG(candidate_stat.st_mode)
                or not 0 < candidate_stat.st_size <= 64 * 1024 * 1024
            ):
                continue
            content = resolved.read_bytes()
            if len(content) != candidate_stat.st_size:
                continue
            validate_ooxml_archive(content, "docx")
            validate_docx_template_statements(content)
            publish_standardized_template_cache(
                lease, content, preservation_attested=True,
            )
        except (OSError, ValueError):
            # Cache publication is optional and cannot invalidate a valid render.
            pass
        finally:
            release_standardized_template_cache(lease)


def run_document_job(
    operation: str,
    payload: dict[str, Any],
    *,
    timeout_seconds: float | None = None,
    image_root: Path | None = None,
) -> Any:
    """Run one allowlisted operation outside the web process and return its result."""

    timeout = timeout_seconds or _bounded_float_env(
        "DOCUMENT_WORKER_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS, 1.0, 180.0
    )
    timeout = min(180.0, max(1.0, timeout))
    acquire_timeout = _bounded_float_env(
        "DOCUMENT_WORKER_QUEUE_TIMEOUT_SECONDS", 2.0, 0.0, 30.0
    )
    semaphore = _worker_semaphore()
    wait_started = time.perf_counter()
    document_worker_wait_started()
    if not semaphore.acquire(timeout=max(0.0, min(30.0, acquire_timeout))):
        document_worker_rejected(time.perf_counter() - wait_started)
        raise DocumentWorkerBusyError(
            "Hệ thống đang xử lý quá nhiều tài liệu. Vui lòng thử lại sau."
        )
    document_worker_acquired(time.perf_counter() - wait_started)
    job_started = time.perf_counter()
    outcome = "failed"

    job_root = resolve_runtime_path("DOCUMENT_WORKER_TEMP_DIR")
    job_root.mkdir(parents=True, exist_ok=True)
    try:
        with tempfile.TemporaryDirectory(prefix="job-", dir=job_root) as raw_job_dir:
            job_dir = Path(raw_job_dir).resolve()
            input_path = job_dir / "input.json"
            result_path = job_dir / "result.json"
            cache_leases: list[tuple[int, Any]] = []
            try:
                payload, cache_leases, _cache_overrides = _prepare_render_payload_cache(
                    operation, payload,
                )
                write_job_manifest(
                    input_path,
                    operation,
                    payload,
                    image_root=Path(image_root or IMAGE_DIR).resolve(),
                )
            except (DocumentIpcError, OSError) as exc:
                _release_render_cache_leases(cache_leases)
                raise DocumentWorkerInputError(str(exc)) from exc
            _prepare_privilege_drop(job_dir)

            base_command = [
                sys.executable,
                "-m",
                "backend.documents.document_worker_entry",
                str(input_path),
                str(result_path),
            ]
            worker_environment = _worker_environment(job_dir)
            try:
                command = sandbox_worker_command(base_command, job_dir, worker_environment)
            except RuntimeError as exc:
                raise DocumentWorkerError("Không thể khởi tạo sandbox xử lý tài liệu.") from exc
            popen_kwargs: dict[str, Any] = {
                "cwd": str(job_dir),
                "env": worker_environment,
                "stdin": subprocess.DEVNULL,
                "stdout": subprocess.PIPE,
                "stderr": subprocess.PIPE,
            }
            if os.name == "posix":
                popen_kwargs["start_new_session"] = True
            elif hasattr(subprocess, "CREATE_NO_WINDOW"):
                popen_kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW

            process = _start_worker_process(command, popen_kwargs)
            windows_job_handle = None
            try:
                try:
                    windows_job_handle = _assign_windows_job_object(process)
                except OSError as exc:
                    _terminate_process(process)
                    raise DocumentWorkerError(
                        "Không thể áp dụng giới hạn tài nguyên cho tác vụ tài liệu."
                    ) from exc
                _stdout, _stderr = process.communicate(timeout=timeout)
                _record_worker_events(_stdout)
            except subprocess.TimeoutExpired as exc:
                _terminate_process(process)
                raise DocumentWorkerTimeoutError(
                    "Tác vụ tài liệu vượt quá thời gian xử lý cho phép."
                ) from exc
            finally:
                _close_windows_job_object(windows_job_handle)
            if process.returncode != 0 and not result_path.exists():
                raise DocumentWorkerError(
                    "Tiến trình xử lý tài liệu đã dừng bất thường."
                )
            try:
                result = _read_result(result_path, job_dir)
                _publish_render_cache_sidecars(job_dir, cache_leases)
                outcome = "completed"
                return result
            finally:
                _release_render_cache_leases(cache_leases)
    except DocumentWorkerTimeoutError:
        outcome = "timed_out"
        raise
    finally:
        _release_render_cache_leases(locals().get("cache_leases", []))
        document_worker_finished(outcome, time.perf_counter() - job_started)
        semaphore.release()
        try:
            if job_root.exists() and not any(job_root.iterdir()):
                job_root.rmdir()
        except OSError:
            pass


def _run_staged_document_job(
    job_dir: Path,
    input_path: Path,
    result_path: Path,
    *,
    timeout_seconds: float | None = None,
) -> Any:
    """Run directly from an already-hashed durable staging directory."""

    timeout = timeout_seconds or _bounded_float_env(
        "DOCUMENT_WORKER_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS, 1.0, 180.0
    )
    timeout = min(180.0, max(1.0, timeout))
    acquire_timeout = _bounded_float_env(
        "DOCUMENT_WORKER_QUEUE_TIMEOUT_SECONDS", 2.0, 0.0, 30.0
    )
    semaphore = _worker_semaphore()
    wait_started = time.perf_counter()
    document_worker_wait_started()
    if not semaphore.acquire(timeout=max(0.0, min(30.0, acquire_timeout))):
        document_worker_rejected(time.perf_counter() - wait_started)
        raise DocumentWorkerBusyError(_BUSY_MESSAGE)
    document_worker_acquired(time.perf_counter() - wait_started)
    job_started = time.perf_counter()
    outcome = "failed"
    try:
        resolved_job_dir = job_dir.resolve(strict=True)
        if (
            input_path.resolve().parent != resolved_job_dir
            or result_path.resolve().parent != resolved_job_dir
        ):
            raise DocumentWorkerInputError("Đường dẫn tác vụ tài liệu không hợp lệ.")
        _prepare_privilege_drop(resolved_job_dir)
        base_command = [
            sys.executable,
            "-m",
            "backend.documents.document_worker_entry",
            str(input_path),
            str(result_path),
        ]
        worker_environment = _worker_environment(resolved_job_dir)
        try:
            command = sandbox_worker_command(
                base_command, resolved_job_dir, worker_environment
            )
        except RuntimeError as exc:
            raise DocumentWorkerError(
                "Không thể khởi tạo sandbox xử lý tài liệu."
            ) from exc
        popen_kwargs: dict[str, Any] = {
            "cwd": str(resolved_job_dir),
            "env": worker_environment,
            "stdin": subprocess.DEVNULL,
            "stdout": subprocess.PIPE,
            "stderr": subprocess.PIPE,
        }
        if os.name == "posix":
            popen_kwargs["start_new_session"] = True
        elif hasattr(subprocess, "CREATE_NO_WINDOW"):
            popen_kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
        process = _start_worker_process(command, popen_kwargs)
        windows_job_handle = None
        try:
            try:
                windows_job_handle = _assign_windows_job_object(process)
            except OSError as exc:
                _terminate_process(process)
                raise DocumentWorkerError(
                    "Không thể áp dụng giới hạn tài nguyên cho tác vụ tài liệu."
                ) from exc
            stdout, _stderr = process.communicate(timeout=timeout)
            _record_worker_events(stdout)
        except subprocess.TimeoutExpired as exc:
            _terminate_process(process)
            outcome = "timed_out"
            raise DocumentWorkerTimeoutError(
                "Tác vụ tài liệu vượt quá thời gian xử lý cho phép."
            ) from exc
        finally:
            _close_windows_job_object(windows_job_handle)
        if process.returncode != 0 and not result_path.exists():
            raise DocumentWorkerError(
                "Tiến trình xử lý tài liệu đã dừng bất thường."
            )
        result = _read_result(result_path, resolved_job_dir)
        outcome = "completed"
        return result
    finally:
        document_worker_finished(outcome, time.perf_counter() - job_started)
        semaphore.release()


_DOCUMENT_QUEUE_WORKER_ID = f"{os.getpid()}-{uuid.uuid4().hex[:12]}"
_DOCUMENT_QUEUE_ADMISSION_LOCK = 4_242_260_715


def _document_queue_database():
    # Lazy import avoids constructing the application database while tooling
    # imports the isolated document runner.
    from backend.shared.helpers import database

    return database


def _document_job_dir(job_id: str) -> Path:
    candidate = str(job_id or "")
    if len(candidate) != 32 or any(character not in "0123456789abcdef" for character in candidate):
        raise DocumentWorkerError("Mã tác vụ tài liệu không hợp lệ.")
    root = resolve_runtime_path("DOCUMENT_WORKER_TEMP_DIR").resolve()
    path = (root / f"job-{candidate}").resolve()
    if path.parent != root:
        raise DocumentWorkerError("Đường dẫn tác vụ tài liệu không hợp lệ.")
    return path


def _external_queue_capacity() -> int:
    concurrency = _positive_int_env(
        "DOCUMENT_WORKER_MAX_CONCURRENCY", 4, 1, 8
    )
    queue_size = _positive_int_env("DOCUMENT_WORKER_QUEUE_SIZE", 2, 0, 32)
    instances = _positive_int_env("DOCUMENT_WORKER_INSTANCE_COUNT", 1, 1, 64)
    return instances * (concurrency + queue_size)


def _external_worker_shared_gid() -> int:
    if os.name != "posix" or not hasattr(os, "chown"):
        raise RuntimeError(
            "External document workers require POSIX ownership enforcement."
        )
    raw_gid = os.environ.get("DOCUMENT_WORKER_SHARED_GID", "").strip()
    try:
        shared_gid = int(raw_gid)
    except (TypeError, ValueError) as exc:
        raise RuntimeError(
            "DOCUMENT_WORKER_SHARED_GID must identify the dedicated shared group."
        ) from exc
    if shared_gid <= 0:
        raise RuntimeError("DOCUMENT_WORKER_SHARED_GID must be greater than zero.")
    return shared_gid


def _prepare_external_job_permissions(job_dir: Path) -> None:
    """Grant only the dedicated document-worker group access to one job."""

    if not external_document_worker_enabled():
        return
    shared_gid = _external_worker_shared_gid()

    def apply_permissions(target: Path) -> None:
        target_stat = target.lstat()
        if stat.S_ISLNK(target_stat.st_mode):
            raise RuntimeError(
                "Document-worker exchange paths cannot contain symbolic links."
            )
        expected_mode = 0o770 if stat.S_ISDIR(target_stat.st_mode) else 0o660
        if target_stat.st_gid != shared_gid:
            os.chown(target, -1, shared_gid)
            target_stat = target.lstat()
        if stat.S_IMODE(target_stat.st_mode) != expected_mode:
            os.chmod(target, expected_mode)

    targets = [job_dir.parent, job_dir, *job_dir.rglob("*")]
    for target in targets:
        apply_permissions(target)


def _external_shared_root(*, provision: bool) -> Path:
    """Provision or verify the web/worker exchange directory."""

    shared_root = resolve_runtime_path("DOCUMENT_WORKER_TEMP_DIR").resolve()
    shared_gid = _external_worker_shared_gid()
    if provision:
        shared_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        root_stat = shared_root.lstat()
        if stat.S_ISLNK(root_stat.st_mode):
            raise RuntimeError(
                "DOCUMENT_WORKER_TEMP_DIR cannot be a symbolic link."
            )
        if root_stat.st_gid != shared_gid:
            os.chown(shared_root, -1, shared_gid)
            root_stat = shared_root.lstat()
        if stat.S_IMODE(root_stat.st_mode) != 0o770:
            os.chmod(shared_root, 0o770)
    try:
        root_stat = shared_root.lstat()
    except FileNotFoundError as exc:
        raise RuntimeError(
            "DOCUMENT_WORKER_TEMP_DIR must be provisioned before starting the worker."
        ) from exc
    if not stat.S_ISDIR(root_stat.st_mode) or stat.S_ISLNK(root_stat.st_mode):
        raise RuntimeError(
            "DOCUMENT_WORKER_TEMP_DIR must be a real directory, not a symbolic link."
        )
    if root_stat.st_gid != shared_gid or stat.S_IMODE(root_stat.st_mode) != 0o770:
        raise RuntimeError(
            "DOCUMENT_WORKER_TEMP_DIR must use the dedicated shared GID and mode 0770."
        )
    if not os.access(shared_root, os.R_OK | os.W_OK | os.X_OK):
        raise RuntimeError(
            "The current service account cannot access DOCUMENT_WORKER_TEMP_DIR."
        )
    return shared_root


def validate_external_document_worker_shared_root() -> Path:
    """Verify the pre-provisioned exchange directory without changing ownership."""

    if not external_document_worker_enabled():
        raise RuntimeError("External document-worker mode is not enabled.")
    return _external_shared_root(provision=False)


def _enqueue_durable_document_job(
    operation: str,
    payload: dict[str, Any],
    *,
    database=None,
    owner_scope: dict[str, Any] | None = None,
    audit_event: dict[str, Any] | None = None,
) -> str:
    database = database or _document_queue_database()
    job_id = uuid.uuid4().hex
    job_dir = _document_job_dir(job_id)
    job_dir.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    job_dir.mkdir(mode=0o700)
    try:
        write_job_manifest(
            job_dir / "input.json",
            operation,
            payload,
            image_root=IMAGE_DIR,
        )
        _prepare_external_job_permissions(job_dir)
        now = int(time.time())
        retention_seconds = _positive_int_env(
            "DOCUMENT_JOB_RETENTION_SECONDS",
            86_400,
            300,
            2_592_000,
        )
        connection = database.get_connection()
        try:
            if external_document_worker_enabled():
                # Serialize admission across all ASGI workers. Per-process
                # semaphores alone cannot cap a shared PostgreSQL queue.
                connection.execute(
                    "SELECT pg_advisory_xact_lock(?)",
                    (_DOCUMENT_QUEUE_ADMISSION_LOCK,),
                )
                active_jobs = int(
                    connection.execute(
                        """SELECT COUNT(*) FROM document_jobs
                           WHERE status IN ('pending', 'processing', 'retry')
                             AND expires_at > ?""",
                        (now,),
                    ).fetchone()[0]
                    or 0
                )
                if active_jobs >= _external_queue_capacity():
                    raise DocumentWorkerBusyError(_BUSY_MESSAGE)
            scope = owner_scope or {}
            connection.execute(
                """INSERT INTO document_jobs (
                       id, operation, organization_id, user_id, package_id,
                       record_type, record_id,
                       filename, content_type, policy_json, policy_hash,
                       status, progress_phase, progress_completed_items,
                       progress_total_items, attempt_count,
                       available_at, expires_at, created_at, updated_at
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending',
                             ?, ?, ?, 0, ?, ?, ?, ?)""",
                (
                    job_id,
                    operation,
                    scope.get("organization_id"),
                    scope.get("user_id"),
                    scope.get("package_id"),
                    scope.get("record_type"),
                    scope.get("record_id"),
                    scope.get("filename"),
                    scope.get("content_type"),
                    json.dumps(
                        scope.get("policy") or {},
                        ensure_ascii=False,
                        sort_keys=True,
                        separators=(",", ":"),
                    ),
                    scope.get("policy_hash") or "",
                    scope.get("progress_phase") or "queued",
                    max(0, int(scope.get("progress_completed_items") or 0)),
                    max(1, int(scope.get("progress_total_items") or 1)),
                    now,
                    now + retention_seconds,
                    now,
                    now,
                ),
            )
            if audit_event is not None:
                metadata = dict(audit_event.get("metadata") or {})
                metadata["job_id"] = job_id
                insert_audit_row(
                    connection,
                    actor_user_id=audit_event.get("actor_user_id"),
                    organization_id=audit_event.get("organization_id"),
                    action=str(audit_event["action"]),
                    target_type=audit_event.get("target_type"),
                    target_id=audit_event.get("target_id"),
                    ip_address=audit_event.get("ip_address"),
                    metadata_json=json.dumps(
                        metadata, ensure_ascii=False, default=str,
                    ),
                )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
        return job_id
    except Exception:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise


def _claim_durable_document_job(database, job_id: str | None = None):
    now = int(time.time())
    stale_seconds = _positive_int_env(
        "DOCUMENT_JOB_STALE_SECONDS",
        240,
        60,
        900,
    )
    max_attempts = _positive_int_env(
        "DOCUMENT_JOB_MAX_ATTEMPTS",
        2,
        1,
        5,
    )
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        row = connection.execute(
            """SELECT id, operation, organization_id, user_id, package_id,
                      record_type, record_id, policy_json, policy_hash,
                      progress_phase, progress_completed_items,
                      progress_total_items, attempt_count
               FROM document_jobs
               WHERE (CAST(? AS TEXT) IS NULL OR id = ?)
                 AND attempt_count < ?
                 AND expires_at > ?
                 AND (
                       (status IN ('pending', 'retry') AND available_at <= ?)
                    OR (status = 'processing' AND locked_at <= ?)
                 )
               ORDER BY available_at, created_at, id
               FOR UPDATE SKIP LOCKED
               LIMIT 1""",
            (
                job_id,
                job_id,
                max_attempts,
                now,
                now,
                now - stale_seconds,
            ),
        ).fetchone()
        if row is None:
            connection.commit()
            return None
        lock_token = f"{_DOCUMENT_QUEUE_WORKER_ID}:{uuid.uuid4().hex}"
        attempt_count = int(row["attempt_count"] or 0) + 1
        connection.execute(
            """UPDATE document_jobs
               SET status = 'processing', attempt_count = ?, locked_at = ?,
                   locked_by = ?, updated_at = ?
               WHERE id = ?""",
            (attempt_count, now, lock_token, now, row["id"]),
        )
        connection.commit()
        claimed = dict(row)
        claimed["attempt_count"] = attempt_count
        claimed["lock_token"] = lock_token
        return claimed
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _finish_durable_document_job(
    database,
    claimed,
    error: Exception | None = None,
    result: Any = None,
) -> str:
    now = int(time.time())
    attempts = int(claimed["attempt_count"])
    max_attempts = _positive_int_env(
        "DOCUMENT_JOB_MAX_ATTEMPTS",
        2,
        1,
        5,
    )
    if error is None:
        status = "completed"
        available_at = now
        error_code = None
        error_message = None
        completed_at = now
    else:
        retryable = not isinstance(
            error, (DocumentWorkerInputError, DocumentJobAuthorizationError)
        )
        status = "retry" if retryable and attempts < max_attempts else "failed"
        available_at = now + min(30, 2 ** attempts) if status == "retry" else now
        error_code = error.__class__.__name__[:96]
        if isinstance(
            error,
            (DocumentWorkerInputError, DocumentWorkerError, DocumentJobAuthorizationError),
        ):
            error_message = str(error)[:500]
        else:
            error_message = "Tác vụ tài liệu không thành công."
        completed_at = now if status == "failed" else None
    connection = database.get_connection()
    try:
        record_type = str(
            claimed.get("record_type")
            or ("goi_thau" if claimed.get("package_id") else "")
        ).strip()
        record_id = str(
            claimed.get("record_id") or claimed.get("package_id") or ""
        ).strip()
        owner_values = (
            str(claimed.get("organization_id") or "").strip(),
            str(claimed.get("user_id") or "").strip(),
            record_type,
            record_id,
        )
        owner_scoped = any(owner_values)
        if owner_scoped and not all(owner_values):
            raise DocumentJobAuthorizationError("DOCUMENT_EXPORT_POLICY_INVALID")
        if error is None and owner_scoped:
            policy = validate_document_job_policy_snapshot(
                claimed.get("policy_json"), claimed.get("policy_hash")
            )
            provenance_value = policy.get("artifactProvenance")
            if provenance_value is not None:
                if not isinstance(result, bytes) or not result:
                    raise DocumentWorkerInputError(
                        "Kết quả Word không hợp lệ để ghi provenance."
                    )
                from backend.documents.template_catalog.repository import (
                    WordTemplateCatalogRepository,
                )
                from backend.documents.template_catalog.service import (
                    WordTemplateCatalog,
                )
                from backend.documents.template_catalog.storage import (
                    ImmutableTemplateStorage,
                )

                provenances = (
                    provenance_value
                    if isinstance(provenance_value, list)
                    else [provenance_value]
                )
                if not provenances or any(
                    not isinstance(item, dict) for item in provenances
                ):
                    raise DocumentWorkerInputError(
                        "Thông tin nguồn biểu mẫu Word không hợp lệ."
                    )
                if len(provenances) == 1:
                    artifact_contents = [result]
                else:
                    from io import BytesIO
                    from zipfile import BadZipFile, ZipFile

                    try:
                        with ZipFile(BytesIO(result)) as archive:
                            entries = archive.infolist()
                            artifact_contents = [archive.read(entry) for entry in entries]
                    except BadZipFile as exc:
                        raise DocumentWorkerInputError(
                            "Gói kết quả Word không hợp lệ để ghi provenance."
                        ) from exc
                    if len(artifact_contents) != len(provenances):
                        raise DocumentWorkerInputError(
                            "Gói kết quả Word không khớp số biểu mẫu nguồn."
                        )
                catalog = WordTemplateCatalog(
                    WordTemplateCatalogRepository(connection.cursor()),
                    ImmutableTemplateStorage(),
                )
                for index, (provenance, artifact_content) in enumerate(
                    zip(provenances, artifact_contents, strict=True)
                ):
                    artifact_id = f"document-job:{claimed['id']}"
                    if len(provenances) > 1:
                        artifact_id = f"{artifact_id}:{index + 1}"
                    catalog.record_generated_provenance(
                        organization_id=claimed["organization_id"],
                        artifact_id=artifact_id,
                        template_version_id=provenance["templateVersionId"],
                        template_sha256=provenance["templateSha256"],
                        record_type=provenance["recordType"],
                        record_id=provenance["recordId"],
                        record_row_version=provenance["recordRowVersion"],
                        artifact_sha256=hashlib.sha256(artifact_content).hexdigest(),
                        actor_user_id=claimed["user_id"],
                    )
        progress_phase = (
            "completed" if status == "completed"
            else "queued" if status == "retry"
            else "failed"
        )
        progress_total = max(1, int(claimed.get("progress_total_items") or 1))
        progress_completed = (
            progress_total
            if status == "completed"
            else max(0, int(claimed.get("progress_completed_items") or 0))
        )
        updated = connection.execute(
            """UPDATE document_jobs
               SET status = ?, available_at = ?, locked_at = NULL,
                   locked_by = NULL, last_error_code = ?,
                   last_error_message = ?, completed_at = ?,
                   progress_phase = ?, progress_completed_items = ?,
                   progress_total_items = ?, updated_at = ?
               WHERE id = ? AND status = 'processing' AND locked_by = ?""",
            (
                status,
                available_at,
                error_code,
                error_message,
                completed_at,
                progress_phase,
                progress_completed,
                progress_total,
                now,
                claimed["id"],
                claimed["lock_token"],
            ),
        )
        if (
            status == "completed"
            and int(updated.rowcount or 0) == 1
            and owner_scoped
            and claimed.get("operation") in {"render_docx", "render_docx_batch"}
        ):
            record_word_export_success_best_effort(
                connection.cursor(),
                user_id=claimed["user_id"],
                organization_id=claimed["organization_id"],
                now=now,
            )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
    return status


def _delete_consumed_completed_document_job(database, job_id: str) -> bool:
    """Retire a successfully consumed result; failed jobs expire via retention."""

    connection = database.get_connection()
    try:
        deleted = connection.execute(
            "DELETE FROM document_jobs WHERE id = ? AND status = 'completed'",
            (job_id,),
        )
        deleted_count = int(deleted.rowcount or 0)
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
    if deleted_count == 1:
        shutil.rmtree(_document_job_dir(job_id), ignore_errors=True)
        return True
    return False


def retry_failed_durable_document_job(database, job_id: str) -> bool:
    """Schedule one failed immutable job for another operator-approved attempt.

    The conditional update is the idempotency guard: only the first caller can
    move a given failed row back to ``retry``. The previous error remains
    visible until the retried attempt records its own outcome.
    """

    job_dir = _document_job_dir(job_id)
    manifest_path = job_dir / "input.json"
    if not job_dir.is_dir() or not manifest_path.is_file():
        raise DocumentWorkerError(
            "Không còn dữ liệu đầu vào của tác vụ tài liệu để chạy lại."
        )
    operation, _payload = read_job_manifest(manifest_path, job_dir)
    now = int(time.time())
    retention_seconds = _positive_int_env(
        "DOCUMENT_JOB_RETENTION_SECONDS",
        86_400,
        300,
        2_592_000,
    )
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        job_row = connection.execute(
            """SELECT id, organization_id, user_id, package_id,
                      record_type, record_id,
                      policy_json, policy_hash
                 FROM document_jobs WHERE id = ? FOR UPDATE""",
            (job_id,),
        ).fetchone()
        if job_row is None:
            connection.commit()
            return False
        verify_document_job_policy(connection.cursor(), dict(job_row))
        updated = connection.execute(
            """UPDATE document_jobs
               SET status = 'retry', attempt_count = 0, available_at = ?,
                   locked_at = NULL, locked_by = NULL, completed_at = NULL,
                   progress_phase = 'queued', progress_completed_items = 0,
                   expires_at = ?, updated_at = ?
               WHERE id = ? AND operation = ? AND status = 'failed'
                 AND cancelled_at IS NULL""",
            (now, now + retention_seconds, now, job_id, operation),
        )
        updated_count = int(updated.rowcount or 0)
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
    return updated_count == 1


def enqueue_document_export(
    operation: str,
    payload: dict[str, Any],
    *,
    organization_id: str,
    user_id: str,
    package_id: str | None,
    record_type: str | None = None,
    record_id: str | None = None,
    filename: str,
    content_type: str,
    progress_phase: str = "queued",
    progress_completed_items: int = 0,
    progress_total_items: int = 1,
    policy: dict[str, Any] | None = None,
    policy_hash: str = "",
    database=None,
    audit_event: dict[str, Any] | None = None,
) -> str:
    validated_policy = validate_document_job_policy_snapshot(policy, policy_hash)
    normalized_record_type = str(
        record_type or ("goi_thau" if package_id else "")
    ).strip()
    normalized_record_id = str(record_id or package_id or "").strip()
    if normalized_record_type not in {"goi_thau", "ke_hoach_lcnt"} or not normalized_record_id:
        raise DocumentJobAuthorizationError("DOCUMENT_EXPORT_POLICY_INVALID")
    return _enqueue_durable_document_job(
        operation,
        payload,
        database=database,
        owner_scope={
            "organization_id": organization_id,
            "user_id": user_id,
            "package_id": package_id,
            "record_type": normalized_record_type,
            "record_id": normalized_record_id,
            "filename": filename,
            "content_type": content_type,
            "progress_phase": progress_phase,
            "progress_completed_items": progress_completed_items,
            "progress_total_items": progress_total_items,
            "policy": validated_policy,
            "policy_hash": policy_hash,
        },
        audit_event=audit_event,
    )


def get_document_export_job(database, job_id: str, organization_id: str, user_id: str):
    connection = database.get_connection()
    try:
        row = connection.execute(
            """SELECT id, operation, organization_id, user_id, package_id,
                      record_type, record_id,
                      filename, content_type, status, attempt_count,
                      last_error_code, completed_at, expires_at, cancelled_at,
                      policy_json, policy_hash, progress_phase,
                      progress_completed_items, progress_total_items
               FROM document_jobs
               WHERE id = ? AND organization_id = ? AND user_id = ?""",
            (job_id, organization_id, user_id),
        ).fetchone()
        return dict(row) if row else None
    finally:
        connection.close()


def read_document_export_result(database, job_id: str, organization_id: str, user_id: str):
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        row = connection.execute(
            """SELECT id, operation, organization_id, user_id, package_id,
                      record_type, record_id,
                      filename, content_type, status, attempt_count,
                      last_error_code, completed_at, expires_at, cancelled_at,
                      policy_json, policy_hash, progress_phase,
                      progress_completed_items, progress_total_items
                 FROM document_jobs
                WHERE id = ? AND organization_id = ? AND user_id = ?
                FOR SHARE""",
            (job_id, organization_id, user_id),
        ).fetchone()
        job = dict(row) if row else None
        if not job or job["status"] != "completed":
            connection.commit()
            return job, None
        verify_document_job_policy(connection.cursor(), job)
        result = _read_result(
            _document_job_dir(job_id) / "result.json", _document_job_dir(job_id)
        )
        connection.commit()
        return job, result
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def cancel_document_export(database, job_id: str, organization_id: str, user_id: str) -> bool:
    now = int(time.time())
    connection = database.get_connection()
    try:
        updated = connection.execute(
            """UPDATE document_jobs
               SET status = 'failed', cancelled_at = ?, completed_at = ?,
                   last_error_code = 'JOB_CANCELLED',
                   last_error_message = NULL, progress_phase = 'cancelled',
                   updated_at = ?
               WHERE id = ? AND organization_id = ? AND user_id = ?
                 AND status IN ('pending', 'retry')""",
            (now, now, now, job_id, organization_id, user_id),
        )
        connection.commit()
        return int(updated.rowcount or 0) == 1
    except Exception:  # noqa: BLE001 - transaction boundary must roll back any driver failure
        connection.rollback()
        raise
    finally:
        connection.close()


def _update_document_job_progress(
    database,
    claimed,
    phase: str,
    *,
    completed_items: int = 0,
    total_items: int = 1,
) -> None:
    connection = database.get_connection()
    try:
        connection.execute(
            """UPDATE document_jobs
               SET progress_phase = ?, progress_completed_items = ?,
                   progress_total_items = ?, updated_at = ?
               WHERE id = ? AND status = 'processing' AND locked_by = ?""",
            (
                str(phase)[:64],
                max(0, int(completed_items)),
                max(1, int(total_items)),
                int(time.time()),
                claimed["id"],
                claimed["lock_token"],
            ),
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _remove_prepared_document_sidecars(job_dir: Path) -> None:
    for candidate in (
        job_dir / "prepared-input.json",
        *job_dir.glob("input-prepared-*.bin"),
        *job_dir.glob("input-cache-*.bin"),
        *job_dir.glob("prepared-template-*.docx"),
        *job_dir.glob("prepared-template-*.tmp"),
    ):
        try:
            candidate.unlink(missing_ok=True)
        except OSError:
            pass


def _process_claimed_document_job(database, claimed) -> None:
    job_dir = _document_job_dir(claimed["id"])
    cache_leases: list[tuple[int, Any]] = []
    try:
        owner_values = tuple(
            str(claimed.get(field) or "").strip()
            for field in ("organization_id", "user_id", "record_type", "record_id")
        )
        owner_scoped = any(owner_values)
        if owner_scoped and not all(owner_values):
            raise DocumentJobAuthorizationError("DOCUMENT_EXPORT_POLICY_INVALID")
        if owner_scoped:
            policy_connection = database.get_connection()
            try:
                verify_document_job_policy(policy_connection.cursor(), claimed)
            finally:
                policy_connection.close()
        operation, payload = read_job_manifest(job_dir / "input.json", job_dir)
        if operation != claimed["operation"]:
            raise DocumentWorkerInputError("Loại tác vụ tài liệu không khớp.")
        templates = payload.get("templates")
        total_items = (
            len(templates)
            if operation == "render_docx_batch" and isinstance(templates, list)
            else 1
        )
        _update_document_job_progress(
            database, claimed, "preparing", total_items=total_items
        )
        input_path = job_dir / "input.json"
        if operation in {"render_docx", "render_docx_batch"}:
            _remove_prepared_document_sidecars(job_dir)
            _prepared_payload, cache_leases, cache_overrides = _prepare_render_payload_cache(
                operation,
                payload,
                organization_scope=str(claimed.get("organization_id") or ""),
            )
            if cache_overrides:
                input_path = job_dir / "prepared-input.json"
                write_render_cache_overlay(
                    input_path,
                    job_dir / "input.json",
                    operation,
                    cache_overrides,
                )
                _prepare_external_job_permissions(job_dir)
        result_path = job_dir / "result.json"
        for result_file in (result_path, job_dir / "result.bin"):
            result_file.unlink(missing_ok=True)
        _update_document_job_progress(
            database, claimed, "rendering", total_items=total_items
        )
        result = _run_staged_document_job(job_dir, input_path, result_path)
        _publish_render_cache_sidecars(job_dir, cache_leases)
        _update_document_job_progress(
            database,
            claimed,
            "finalizing",
            completed_items=total_items,
            total_items=total_items,
        )
        if owner_scoped:
            policy_connection = database.get_connection()
            try:
                verify_document_job_policy(policy_connection.cursor(), claimed)
            finally:
                policy_connection.close()
            verify_document_job_source_authority(claimed)
        _prepare_external_job_permissions(job_dir)
        _finish_durable_document_job(database, claimed, result=result)
        _remove_prepared_document_sidecars(job_dir)
    except Exception as error:
        for result_file in (job_dir / "result.json", job_dir / "result.bin"):
            try:
                result_file.unlink(missing_ok=True)
            except OSError:
                pass
        _finish_durable_document_job(database, claimed, error)
        _remove_prepared_document_sidecars(job_dir)
        # Keep the immutable input and failed metadata for operator inspection
        # and an explicit retry. The retention sweep is the only deletion path.
    finally:
        _release_render_cache_leases(cache_leases)


def process_next_durable_document_job(database=None, *, job_id=None) -> bool:
    database = database or _document_queue_database()
    claimed = _claim_durable_document_job(database, job_id)
    if claimed is None:
        return False
    _process_claimed_document_job(database, claimed)
    return True


def _consume_durable_document_result(
    job_id: str,
    *,
    database=None,
    timeout_seconds: float | None = None,
) -> Any:
    database = database or _document_queue_database()
    per_attempt = timeout_seconds or _bounded_float_env(
        "DOCUMENT_WORKER_TIMEOUT_SECONDS",
        DEFAULT_TIMEOUT_SECONDS,
        1.0,
        180.0,
    )
    max_attempts = _positive_int_env("DOCUMENT_JOB_MAX_ATTEMPTS", 2, 1, 5)
    deadline = time.monotonic() + min(900.0, max(15.0, per_attempt * max_attempts + 30.0))
    job_dir = _document_job_dir(job_id)
    external_worker = external_document_worker_enabled()
    while time.monotonic() < deadline:
        if not external_worker:
            claimed = _claim_durable_document_job(database, job_id)
            if claimed is not None:
                _process_claimed_document_job(database, claimed)

        connection = database.get_connection()
        try:
            row = connection.execute(
                """SELECT status, last_error_code, last_error_message
                   FROM document_jobs WHERE id = ?""",
                (job_id,),
            ).fetchone()
        finally:
            connection.close()
        if row is None:
            raise DocumentWorkerError("Tác vụ tài liệu không còn tồn tại.")
        if row["status"] == "completed":
            try:
                result = _read_result(job_dir / "result.json", job_dir)
            except Exception:
                # A malformed/hash-mismatched result is terminal and must not
                # leave untrusted sidecars behind after the parent rejects it.
                _delete_consumed_completed_document_job(database, job_id)
                raise
            _delete_consumed_completed_document_job(database, job_id)
            return result
        if row["status"] == "failed":
            message = str(
                row["last_error_message"]
                or "Tác vụ tài liệu không thành công."
            )
            error_code = str(row["last_error_code"] or "")
            if error_code == "DocumentWorkerInputError":
                raise DocumentWorkerInputError(message)
            raise DocumentWorkerError(message)
        if not external_worker:
            time.sleep(0.05)
        else:
            time.sleep(0.25)
    raise DocumentWorkerTimeoutError(
        "Tác vụ tài liệu vượt quá thời gian chờ cho phép."
    )


async def run_durable_document_queue_worker(database) -> None:
    """Recover queued/orphaned document jobs after a web-worker restart."""

    backoff = idle_poll_backoff_from_env(
        "DOCUMENT_JOB_POLL_SECONDS",
        "DOCUMENT_JOB_MAX_POLL_SECONDS",
        default_initial=5.0,
    )
    while True:
        try:
            concurrency = _positive_int_env(
                "DOCUMENT_WORKER_MAX_CONCURRENCY", 4, 1, 8
            )
            outcomes = await asyncio.gather(*(
                asyncio.to_thread(process_next_durable_document_job, database)
                for _index in range(concurrency)
            ))
            processed = any(outcomes)
        except asyncio.CancelledError:
            raise
        except Exception:
            processed = False
        if processed:
            backoff.reset()
        await asyncio.sleep(0.1 if processed else backoff.next_delay())


async def run_document_job_async(
    operation: str,
    payload: dict[str, Any],
    *,
    timeout_seconds: float | None = None,
) -> Any:
    """Submit one job only after acquiring a bounded executor admission slot.

    ``asyncio.to_thread`` uses the event loop's shared executor, whose pending
    queue is unbounded. A burst of exports could therefore retain every
    payload in memory even though the subprocess semaphore was bounded. This
    wrapper owns both a fixed executor and an admission semaphore. Admission
    is non-blocking so overload has a deterministic 503 path at the route.

    The admission slot is released by the *concurrent* future callback, not by
    the awaiting task. Cancelling an HTTP request therefore cannot free a slot
    while its underlying worker thread/subprocess is still running.
    """

    global _async_runtime
    concurrency = _positive_int_env("DOCUMENT_WORKER_MAX_CONCURRENCY", 4, 1, 8)
    queue_size = _positive_int_env("DOCUMENT_WORKER_QUEUE_SIZE", 2, 0, 32)
    config = (concurrency, queue_size)
    with _async_runtime_guard:
        if _async_runtime is None or _async_runtime.config != config:
            previous = _async_runtime
            _async_runtime = _AsyncWorkerRuntime(*config)
            if previous is not None:
                previous.executor.shutdown(wait=False, cancel_futures=False)
        runtime = _async_runtime
        admitted = runtime.admission.acquire(blocking=False)

    if not admitted:
        document_worker_wait_started()
        document_worker_rejected(0.0)
        raise DocumentWorkerBusyError(_BUSY_MESSAGE)

    try:
        job_id = _enqueue_durable_document_job(operation, payload)
        concurrent_future = runtime.executor.submit(
            _consume_durable_document_result,
            job_id,
            timeout_seconds=timeout_seconds,
        )
    except BaseException:
        runtime.admission.release()
        raise

    concurrent_future.add_done_callback(lambda _future: runtime.admission.release())
    wrapped_future = asyncio.wrap_future(concurrent_future)
    return await asyncio.shield(wrapped_future)


def cleanup_stale_document_jobs(max_age_seconds: int = 3_600) -> int:
    """Remove abandoned per-job directories left by a terminated web process."""

    root = resolve_runtime_path("DOCUMENT_WORKER_TEMP_DIR")
    if not root.exists():
        return 0
    cutoff = __import__("time").time() - max(60, max_age_seconds)
    removed = 0
    for child in root.glob("job-*"):
        try:
            if child.is_dir() and child.stat().st_mtime < cutoff:
                shutil.rmtree(child)
                removed += 1
        except OSError:
            continue
    return removed


def cleanup_orphaned_durable_document_jobs(
    database,
    *,
    min_age_seconds: int = 300,
) -> int:
    """Remove old exchange directories that have no durable queue record.

    A web process can be killed after creating the directory but before its DB
    transaction commits.  In external mode, age alone is insufficient because
    another host may still be processing the job.  The durable row is therefore
    authoritative and only row-less, old, real directories are removed.
    """

    root = resolve_runtime_path("DOCUMENT_WORKER_TEMP_DIR")
    if not root.exists():
        return 0
    cutoff = time.time() - max(60, int(min_age_seconds))
    candidates: list[tuple[str, Path]] = []
    for child in root.glob("job-*"):
        try:
            child_stat = child.lstat()
            job_id = child.name.removeprefix("job-")
            if (
                stat.S_ISDIR(child_stat.st_mode)
                and not stat.S_ISLNK(child_stat.st_mode)
                and len(job_id) == 32
                and all(character in "0123456789abcdef" for character in job_id)
                and child_stat.st_mtime < cutoff
            ):
                candidates.append((job_id, child))
        except OSError:
            continue
    if not candidates:
        return 0
    connection = database.get_connection()
    try:
        durable_ids = {
            str(row["id"])
            for row in connection.execute("SELECT id FROM document_jobs").fetchall()
        }
    finally:
        connection.close()
    removed = 0
    for job_id, child in candidates:
        if job_id in durable_ids:
            continue
        try:
            shutil.rmtree(child)
            removed += 1
        except OSError:
            continue
    return removed


def purge_expired_durable_document_jobs(database) -> int:
    """Delete terminal/expired queue metadata, then remove its dedicated files."""

    now = int(time.time())
    connection = database.get_connection()
    try:
        connection.execute("BEGIN")
        rows = connection.execute(
            """SELECT id FROM document_jobs
               WHERE expires_at <= ?
                 AND (
                       status IN ('completed', 'failed')
                    OR (status IN ('pending', 'retry') AND updated_at <= ?)
                    OR (status = 'processing' AND locked_at <= ?)
                 )
               FOR UPDATE SKIP LOCKED""",
            (now, now - 300, now - 900),
        ).fetchall()
        job_ids = [str(row["id"]) for row in rows]
        if job_ids:
            connection.cursor().executemany(
                "DELETE FROM document_jobs WHERE id = ?",
                [(job_id,) for job_id in job_ids],
            )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
    for job_id in job_ids:
        shutil.rmtree(_document_job_dir(job_id), ignore_errors=True)
    return len(job_ids)


def validate_document_worker_configuration() -> None:
    """Fail startup when production would run document parsers with admin rights."""

    mode = document_worker_execution_mode()
    production = os.environ.get("APP_ENV", "development").lower() in {
        "prod",
        "production",
    }
    if mode == "embedded":
        validate_document_sandbox_configuration()
    if not production:
        return
    if os.name != "posix":
        raise RuntimeError(
            "Production external document workers currently require a POSIX host."
        )
    required_external = (
        "DOCUMENT_WORKER_SERVICE_ACCOUNT_CONFIRMED",
        "DOCUMENT_WORKER_SHARED_STORAGE_CONFIRMED",
    )
    missing_external = [
        name
        for name in required_external
        if os.environ.get(name, "").strip().casefold() != "true"
    ]
    if missing_external:
        raise RuntimeError(
            "Missing production external document-worker configuration: "
            + ", ".join(missing_external)
        )
    _external_shared_root(provision=True)
    if (
        _positive_int_env("APP_INSTANCE_COUNT", 1, 1, 1_000) > 1
        and os.environ.get(
            "DOCUMENT_WORKER_SHARED_STORAGE_CONFIRMED",
            "",
        ).strip().lower()
        != "true"
    ):
        raise RuntimeError(
            "Multiple instances require a dedicated shared, encrypted "
            "DOCUMENT_WORKER_TEMP_DIR and "
            "DOCUMENT_WORKER_SHARED_STORAGE_CONFIRMED=true."
        )
    require_drop = os.environ.get(
        "DOCUMENT_WORKER_REQUIRE_PRIVILEGE_DROP", "false"
    ).lower() == "true"
    if os.name == "posix" and hasattr(os, "geteuid"):
        if os.geteuid() == 0 and not os.environ.get("DOCUMENT_WORKER_UID", "").strip():
            raise RuntimeError(
                "Production document workers cannot run as root; configure "
                "DOCUMENT_WORKER_UID/GID or run the service as a non-root account."
            )
    elif os.name == "nt":
        if require_drop:
            raise RuntimeError(
                "DOCUMENT_WORKER_REQUIRE_PRIVILEGE_DROP is not supported on Windows; "
                "run the application under a dedicated non-administrator service account."
            )
        try:
            import ctypes

            if bool(ctypes.windll.shell32.IsUserAnAdmin()):
                raise RuntimeError(
                    "Production document workers must run under a dedicated "
                    "non-administrator Windows service account."
                )
        except AttributeError:
            raise RuntimeError("Cannot verify the Windows service account privileges.")
