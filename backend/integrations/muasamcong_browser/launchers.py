"""Isolated browser-launcher adapters for the Mua Sắm Công runtime."""

from __future__ import annotations

import json
from pathlib import Path
from queue import Empty, Queue
import subprocess
from threading import RLock, Thread
import time
from uuid import uuid4

from backend.procurement_lookup.domain import ProcurementLookupError


OFFICIAL_HOST = "muasamcong.mpi.gov.vn"


class NodeBrowserRuntime:
    """Persistent JSON-lines client for the isolated Playwright worker."""

    def __init__(
        self,
        configuration,
        *,
        popen=subprocess.Popen,
        node_executable="node",
        worker_path=None,
    ):
        self.configuration = dict(configuration)
        self.response_timeout_seconds = max(
            0.05,
            min(
                float(self.configuration.get("workerResponseTimeoutMs", 25_000))
                / 1000,
                60.0,
            ),
        )
        self.queue_timeout_seconds = max(
            0.01,
            min(
                float(self.configuration.get("workerQueueTimeoutMs", 1000))
                / 1000,
                5.0,
            ),
        )
        self._lock = RLock()
        self._closed = False
        path = Path(worker_path or Path(__file__).with_name("browser_worker.mjs"))
        self._process = popen(
            [node_executable, str(path)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        initialized = self._exchange(
            "initialize", configuration=self.configuration
        )
        if initialized.get("ready") is not True:
            self.close()
            raise ProcurementLookupError("PROCUREMENT_BROWSER_FAILED")

    def _exchange(self, operation, **payload):
        acquired = self._lock.acquire(timeout=self.queue_timeout_seconds)
        if not acquired:
            raise ProcurementLookupError("PROCUREMENT_LOOKUP_BUSY")
        try:
            if self._closed or self._process.poll() is not None:
                raise ProcurementLookupError("PROCUREMENT_BROWSER_FAILED")
            request_id = uuid4().hex
            request = {
                "requestId": request_id,
                "operation": operation,
                "browserMode": self.configuration.get(
                    "browserMode", "standard"
                ),
                **payload,
            }
            try:
                self._process.stdin.write(
                    json.dumps(request, ensure_ascii=False, separators=(",", ":"))
                    + "\n"
                )
                self._process.stdin.flush()
                raw = self._readline_with_timeout()
                response = json.loads(raw)
            except (AttributeError, BrokenPipeError, OSError, ValueError) as error:
                raise ProcurementLookupError("PROCUREMENT_BROWSER_FAILED") from error
            if (
                not isinstance(response, dict)
                or response.get("requestId") != request_id
            ):
                raise ProcurementLookupError("PROCUREMENT_BROWSER_FAILED")
            if response.get("ok") is not True:
                code = str(response.get("error") or "PROCUREMENT_BROWSER_FAILED")
                allowed = {
                    "PROCUREMENT_NOT_FOUND",
                    "PROCUREMENT_INTERACTION_REQUIRED",
                    "PROCUREMENT_TIMEOUT",
                    "PROCUREMENT_UPSTREAM_UNAVAILABLE",
                    "PROCUREMENT_BROWSER_FAILED",
                    "PROCUREMENT_SCHEMA_CHANGED",
                    "PROCUREMENT_ADAPTER_UNSUPPORTED",
                    "PROCUREMENT_LOOKUP_BUSY",
                    "PROCUREMENT_SESSION_FAILED",
                    "PROCUREMENT_ENDPOINT_CHANGED",
                }
                raise ProcurementLookupError(
                    code if code in allowed else "PROCUREMENT_BROWSER_FAILED"
                )
            result = response.get("result")
            if not isinstance(result, dict):
                raise ProcurementLookupError("PROCUREMENT_SCHEMA_CHANGED")
            return result
        finally:
            self._lock.release()

    def _readline_with_timeout(self):
        completed = Queue(maxsize=1)

        def read_line():
            try:
                completed.put((self._process.stdout.readline(), None))
            except Exception as error:  # noqa: BLE001 - worker I/O boundary.
                completed.put((None, error))

        Thread(target=read_line, daemon=True).start()
        try:
            raw, error = completed.get(timeout=self.response_timeout_seconds)
        except Empty as error:
            self._invalidate_process()
            raise ProcurementLookupError("PROCUREMENT_TIMEOUT") from error
        if error is not None:
            raise error
        return raw

    def _invalidate_process(self):
        self._closed = True
        if self._process.poll() is None:
            self._process.terminate()
            try:
                self._process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self._process.kill()

    def lookup(self, code, kind):
        return self._exchange("lookup", code=str(code), kind=str(kind))

    def probe(self):
        return self._exchange("probe")

    def list_plan_revisions(self, plan_no):
        return self._exchange("listPlanRevisions", planNo=str(plan_no))

    def get_plan_revision(self, plan_no, revision_id):
        return self._exchange(
            "getPlanRevision", planNo=str(plan_no), revisionId=str(revision_id)
        )

    def search(self, code, kind):
        return self._exchange("search", code=str(code), kind=str(kind))

    def list_notice_revisions(self, notice_no):
        return self._exchange("listNoticeRevisions", noticeNo=str(notice_no))

    def get_notice_revision(self, notice_no, revision_id):
        return self._exchange(
            "getNoticeRevision",
            noticeNo=str(notice_no),
            revisionId=str(revision_id),
        )

    def get_opening_bundle(self, notice_no, revision_id):
        return self._exchange(
            "getOpeningBundle",
            noticeNo=str(notice_no),
            revisionId=str(revision_id),
        )

    def get_result_bundle(self, notice_no, revision_id):
        return self._exchange(
            "getResultBundle",
            noticeNo=str(notice_no),
            revisionId=str(revision_id),
        )

    def collect_complete_bundle(
        self,
        record,
        *,
        detail_level="COMPLETE",
        revision_mode="ALL",
        revision_numbers=None,
        search_source=None,
    ):
        if not isinstance(record, dict):
            raise ProcurementLookupError("PROCUREMENT_ADAPTER_UNSUPPORTED")
        return self._exchange(
            "collectCompleteBundle",
            record=record,
            detailLevel=str(detail_level or "COMPLETE").upper(),
            revisionMode=str(revision_mode or "ALL"),
            revisionNumbers=list(revision_numbers or []),
            searchSource=search_source if isinstance(search_source, dict) else None,
        )

    def refresh_session(self):
        return self._exchange("refreshSession")

    def integration_health(self):
        return self._exchange("integrationHealth")

    def is_healthy(self):
        return not self._closed and self._process.poll() is None

    def close(self):
        with self._lock:
            if self._closed:
                return
            try:
                if self._process.poll() is None:
                    self._exchange("shutdown")
            except ProcurementLookupError:
                pass
            finally:
                self._closed = True
                if self._process.poll() is None:
                    self._process.terminate()
                    try:
                        self._process.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        self._process.kill()


class StandardBrowserLauncher:
    """Create one safe, headless runtime and keep it warm between lookups."""

    browser_mode = "standard"

    def __init__(
        self,
        *,
        runtime_factory,
        target_host=OFFICIAL_HOST,
        driver_flags=None,
        extractor_flags=None,
        idle_ttl_seconds=900,
        worker_response_timeout_seconds=25,
        max_response_bytes=1_048_576,
        navigation_timeout_ms=20_000,
        action_timeout_ms=15_000,
        worker_queue_timeout_ms=250,
        clock=time.monotonic,
    ):
        if str(target_host).strip().casefold() != OFFICIAL_HOST:
            raise ProcurementLookupError("PROCUREMENT_ADAPTER_UNSUPPORTED")
        self.runtime_factory = runtime_factory
        self.target_host = OFFICIAL_HOST
        self.driver_flags = {
            "vue2": (driver_flags or {}).get("vue2", True) is True,
            "generic": (driver_flags or {}).get("generic", True) is True,
        }
        self.extractor_flags = {
            "network": (extractor_flags or {}).get("network", True) is True,
            "vue": (extractor_flags or {}).get("vue", True) is True,
            "dom": (extractor_flags or {}).get("dom", True) is True,
        }
        if not any(self.driver_flags.values()) or not any(
            self.extractor_flags.values()
        ):
            raise ProcurementLookupError("PROCUREMENT_ADAPTER_UNSUPPORTED")
        self.idle_ttl_seconds = max(60.0, min(float(idle_ttl_seconds), 3600.0))
        self.worker_response_timeout_seconds = max(
            5.0, min(float(worker_response_timeout_seconds), 60.0)
        )
        self.max_response_bytes = max(
            65_536, min(int(max_response_bytes), 4_194_304)
        )
        self.navigation_timeout_ms = max(
            5_000, min(int(navigation_timeout_ms), 60_000)
        )
        self.action_timeout_ms = max(
            5_000, min(int(action_timeout_ms), 60_000)
        )
        self.worker_queue_timeout_ms = max(
            10, min(int(worker_queue_timeout_ms), 5_000)
        )
        self.clock = clock
        self._runtime = None
        self._last_used_at = None
        self._lock = RLock()

    def _configuration(self):
        return {
            "headless": True,
            "browserMode": self.browser_mode,
            "targetHost": self.target_host,
            "chromiumArgs": [],
            "drivers": dict(self.driver_flags),
            "extractors": dict(self.extractor_flags),
            "idleTtlMs": round(self.idle_ttl_seconds * 1000),
            "workerResponseTimeoutMs": round(
                self.worker_response_timeout_seconds * 1000
            ),
            "maxResponseBytes": self.max_response_bytes,
            "navigationTimeoutMs": self.navigation_timeout_ms,
            "actionTimeoutMs": self.action_timeout_ms,
            "workerQueueTimeoutMs": self.worker_queue_timeout_ms,
        }

    def get_runtime(self):
        with self._lock:
            now = self.clock()
            expired = (
                self._last_used_at is not None
                and now - self._last_used_at > self.idle_ttl_seconds
            )
            if (
                self._runtime is not None
                and self._runtime.is_healthy()
                and not expired
            ):
                self._last_used_at = now
                return self._runtime
            if self._runtime is not None:
                close = getattr(self._runtime, "close", None)
                if callable(close):
                    close()
            self._runtime = self.runtime_factory(self._configuration())
            self._last_used_at = now
            return self._runtime

    def close(self):
        with self._lock:
            runtime = self._runtime
            self._runtime = None
            self._last_used_at = None
        close = getattr(runtime, "close", None)
        if callable(close):
            close()


class ResearchBrowserLauncher(StandardBrowserLauncher):
    """Separately gated research mode without embedded challenge bypass."""

    browser_mode = "research-stealth"


class BrowserLauncherFactory:
    @staticmethod
    def create(
        mode,
        *,
        runtime_factory=NodeBrowserRuntime,
        research_enabled=False,
        allowed_research_hosts=None,
        target_host=OFFICIAL_HOST,
        driver_flags=None,
        extractor_flags=None,
        idle_ttl_seconds=900,
        worker_response_timeout_seconds=25,
        max_response_bytes=1_048_576,
        navigation_timeout_ms=20_000,
        action_timeout_ms=15_000,
        worker_queue_timeout_ms=250,
    ):
        normalized = str(mode or "standard").strip().casefold()
        if normalized == "standard":
            return StandardBrowserLauncher(
                runtime_factory=runtime_factory,
                target_host=target_host,
                driver_flags=driver_flags,
                extractor_flags=extractor_flags,
                idle_ttl_seconds=idle_ttl_seconds,
                worker_response_timeout_seconds=worker_response_timeout_seconds,
                max_response_bytes=max_response_bytes,
                navigation_timeout_ms=navigation_timeout_ms,
                action_timeout_ms=action_timeout_ms,
                worker_queue_timeout_ms=worker_queue_timeout_ms,
            )
        if normalized != "research-stealth" or not research_enabled:
            raise ProcurementLookupError("PROCUREMENT_ADAPTER_UNSUPPORTED")
        allowed = {
            str(host).strip().casefold()
            for host in (allowed_research_hosts or set())
            if str(host).strip()
        }
        if target_host.casefold() != OFFICIAL_HOST or allowed != {OFFICIAL_HOST}:
            raise ProcurementLookupError("PROCUREMENT_ADAPTER_UNSUPPORTED")
        return ResearchBrowserLauncher(
            runtime_factory=runtime_factory,
            target_host=target_host,
            driver_flags=driver_flags,
            extractor_flags=extractor_flags,
            idle_ttl_seconds=idle_ttl_seconds,
            worker_response_timeout_seconds=worker_response_timeout_seconds,
            max_response_bytes=max_response_bytes,
            navigation_timeout_ms=navigation_timeout_ms,
            action_timeout_ms=action_timeout_ms,
            worker_queue_timeout_ms=worker_queue_timeout_ms,
        )
