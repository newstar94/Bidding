"""Bounded subprocess runner for untrusted/expensive document operations."""

from __future__ import annotations

import asyncio
import concurrent.futures
import os
import pickle
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

from backend.shared.paths import IMAGE_DIR, PROJECT_ROOT, resolve_runtime_path
from backend.observability.metrics import (
    document_worker_acquired,
    document_worker_finished,
    document_worker_rejected,
    document_worker_wait_started,
)


DEFAULT_TIMEOUT_SECONDS = 45.0
MAX_RESULT_BYTES = 64 * 1024 * 1024
MAX_JOB_BYTES = 64 * 1024 * 1024
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
    size = _positive_int_env("DOCUMENT_WORKER_MAX_CONCURRENCY", 2, 1, 8)
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
        "DOCUMENT_WORKER_UID",
        "EXCEL_MAX_IMPORT_ROWS",
        "PATH",
        "PATHEXT",
        "SYSTEMDRIVE",
        "SYSTEMROOT",
        "TZ",
        "WINDIR",
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
            "TEMP": str(job_dir),
            "TMP": str(job_dir),
        }
    )
    return environment


def _prepare_privilege_drop(job_dir: Path, input_path: Path) -> None:
    if os.name != "posix" or not hasattr(os, "chown"):
        return
    uid_raw = os.environ.get("DOCUMENT_WORKER_UID", "").strip()
    gid_raw = os.environ.get("DOCUMENT_WORKER_GID", "").strip()
    if not uid_raw and not gid_raw:
        return
    uid = int(uid_raw) if uid_raw else -1
    gid = int(gid_raw) if gid_raw else -1
    os.chown(job_dir, uid, gid)
    os.chown(input_path, uid, gid)
    os.chmod(job_dir, 0o700)
    os.chmod(input_path, 0o600)


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
    limits.BasicLimitInformation.ActiveProcessLimit = 2
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


def _read_result(result_path: Path) -> Any:
    try:
        file_stat = result_path.lstat()
    except FileNotFoundError as exc:
        raise DocumentWorkerError(
            "Tiến trình xử lý tài liệu kết thúc mà không trả về kết quả."
        ) from exc
    if not stat.S_ISREG(file_stat.st_mode) or file_stat.st_size > MAX_RESULT_BYTES:
        raise DocumentWorkerError("Kết quả xử lý tài liệu không hợp lệ.")
    with result_path.open("rb") as result_file:
        envelope = pickle.load(result_file)
    if not isinstance(envelope, dict) or not isinstance(envelope.get("ok"), bool):
        raise DocumentWorkerError("Kết quả xử lý tài liệu không hợp lệ.")
    if envelope["ok"]:
        return envelope.get("result")

    message = str(envelope.get("message") or "Tác vụ tài liệu không thành công.")[:500]
    error_type = str(envelope.get("error_type") or "")
    if error_type in {"TemplateRenderError", "UnsafeArchiveError", "ValueError"}:
        raise DocumentWorkerInputError(message)
    raise DocumentWorkerError(message)


def run_document_job(
    operation: str,
    payload: dict[str, Any],
    *,
    timeout_seconds: float | None = None,
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
            input_path = job_dir / "input.pkl"
            result_path = job_dir / "result.pkl"
            with input_path.open("wb") as input_file:
                pickle.dump(
                    {"operation": operation, "payload": payload},
                    input_file,
                    protocol=pickle.HIGHEST_PROTOCOL,
                )
            if input_path.stat().st_size > MAX_JOB_BYTES:
                raise DocumentWorkerInputError("Dữ liệu đầu vào của tác vụ quá lớn.")
            _prepare_privilege_drop(job_dir, input_path)

            command = [
                sys.executable,
                "-m",
                "backend.documents.document_worker_entry",
                str(input_path),
                str(result_path),
            ]
            popen_kwargs: dict[str, Any] = {
                "cwd": str(job_dir),
                "env": _worker_environment(job_dir),
                "stdin": subprocess.DEVNULL,
                "stdout": subprocess.PIPE,
                "stderr": subprocess.PIPE,
            }
            if os.name == "posix":
                popen_kwargs["start_new_session"] = True
            elif hasattr(subprocess, "CREATE_NO_WINDOW"):
                popen_kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW

            process = subprocess.Popen(command, **popen_kwargs)
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
            result = _read_result(result_path)
            outcome = "completed"
            return result
    except DocumentWorkerTimeoutError:
        outcome = "timed_out"
        raise
    finally:
        document_worker_finished(outcome, time.perf_counter() - job_started)
        semaphore.release()
        try:
            if job_root.exists() and not any(job_root.iterdir()):
                job_root.rmdir()
        except OSError:
            pass


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
    concurrency = _positive_int_env("DOCUMENT_WORKER_MAX_CONCURRENCY", 2, 1, 8)
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
        concurrent_future = runtime.executor.submit(
            run_document_job,
            operation,
            payload,
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


def validate_document_worker_configuration() -> None:
    """Fail startup when production would run document parsers with admin rights."""

    if os.environ.get("APP_ENV", "development").lower() not in {"prod", "production"}:
        return
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
