from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from threading import Event, Lock
import time

import pytest

from backend.integrations.muasamcong_browser.source import (
    MuaSamCongBrowserSource,
)
from backend.integrations.muasamcong_browser.parsers import (
    PackageParserV1,
    ParserRegistry,
    PlanParserV1,
)
from backend.procurement_lookup.cache import PostgresProcurementLookupCache
from backend.integrations.muasamcong_browser.launchers import (
    BrowserLauncherFactory,
    NodeBrowserRuntime,
    ResearchBrowserLauncher,
    StandardBrowserLauncher,
)
from backend.procurement_lookup.domain import ProcurementLookupError
from backend.procurement_lookup.service import ProcurementLookupService


FIXTURES = Path(__file__).parent / "fixtures" / "muasamcong"


class FixtureBrowserRuntime:
    def __init__(self, fixture_name):
        self.artifact = json.loads(
            (FIXTURES / fixture_name).read_text(encoding="utf-8")
        )
        self.calls = []

    def lookup(self, code, kind):
        self.calls.append((code, kind))
        return deepcopy(self.artifact)


def test_plan_lookup_returns_stable_dto_and_packages_from_one_browser_load():
    runtime = FixtureBrowserRuntime("plan_project.json")
    source = MuaSamCongBrowserSource(runtime=runtime)

    result = source.lookup("pl2600000001", "PLAN")

    assert result["schemaVersion"] == "biddingflow-procurement-preview-v1"
    assert result["found"] is True
    assert result["kind"] == "PLAN"
    assert result["inputCode"] == "pl2600000001"
    assert result["canonicalCode"] == "PL2600000001"
    assert result["source"] == {
        "provider": "MUASAMCONG_BROWSER",
        "driver": "vue2",
        "driverVersion": "2026.1",
        "browserMode": "standard",
        "extractionStrategy": "network-json",
        "parserVersion": "2026.1",
        "retrievedAt": result["source"]["retrievedAt"],
    }
    assert result["data"]["planNo"] == "PL2600000001"
    assert result["data"]["planName"] == "Kế hoạch mua sắm thiết bị năm 2026"
    assert result["data"]["investorCode"] == "INV-CREATOR"
    assert result["data"]["totalInvestment"] == 3_000_000_000
    assert [row["bidName"] for row in result["data"]["packages"]] == [
        "Gói A",
        "Gói B",
    ]
    assert result["data"]["packages"][1]["notifyNo"] == "IB2600000002"
    assert runtime.calls == [("PL2600000001", "PLAN")]


def test_package_lookup_uses_exact_identifier_and_stable_package_contract():
    runtime = FixtureBrowserRuntime("package_normal.json")
    result = MuaSamCongBrowserSource(runtime=runtime).lookup(
        "IB2600000002", "PACKAGE"
    )

    assert result["kind"] == "PACKAGE"
    assert result["canonicalCode"] == "IB2600000002"
    assert result["source"]["extractionStrategy"] == "network-json"
    assert result["data"] == {
        "notifyNo": "IB2600000002",
        "notifyId": "notice-revision-00",
        "planNo": "PL2600000001",
        "bidName": "Gói B",
        "investorName": "Chủ đầu tư nội bộ",
        "procuringEntityName": "Bên mời thầu nội bộ",
        "bidPrice": 2_000_000_000,
        "bidPriceUnit": "VND",
        "bidGuarantee": 40_000_000,
        "capitalDetail": "Ngân sách nhà nước",
        "bidField": "Xây lắp",
        "bidForm": "Đấu thầu rộng rãi",
        "bidMode": "Một giai đoạn một túi hồ sơ",
        "processApply": "LDT",
        "contractType": "Trọn gói",
        "implementationPeriod": "6 tháng",
        "bidCloseDate": "2026-09-01T09:00:00+07:00",
        "bidOpenDate": "2026-09-01T09:15:00+07:00",
        "bidOpenId": "bid-open-00",
        "inputResultId": None,
        "isMedicinePackage": None,
        "isMultiLot": None,
        "lots": None,
    }


def test_exact_identifier_mismatch_is_not_accepted_even_with_known_schema():
    runtime = FixtureBrowserRuntime("package_normal.json")
    runtime.artifact["networkResponses"][0]["body"]["renamedNoticeState"][
        "notifyNo"
    ] = "IB2600000099"

    with pytest.raises(ProcurementLookupError, match="PROCUREMENT_NOT_FOUND"):
        MuaSamCongBrowserSource(runtime=runtime).lookup(
            "IB2600000002", "PACKAGE"
        )


def test_plan_revision_suffix_is_accepted_as_the_same_exact_family():
    runtime = FixtureBrowserRuntime("plan_project.json")
    body = runtime.artifact["networkResponses"][0]["body"]
    body["renamedPlanState"]["planNo"] = "PL2600000001-01"
    for package in body["renamedPackageCollection"]:
        package["planNo"] = "PL2600000001-01"

    result = MuaSamCongBrowserSource(runtime=runtime).lookup(
        "PL2600000001", "PLAN"
    )

    assert result["canonicalCode"] == "PL2600000001"
    assert result["data"]["planNo"] == "PL2600000001"
    assert len(result["data"]["packages"]) == 2


def test_lookup_service_is_cache_first_and_coalesces_same_key_requests():
    entered = Event()
    release = Event()
    calls = []
    calls_lock = Lock()

    class BlockingSource:
        name = "MUASAMCONG_BROWSER"
        parser_version = "2026.1"

        def lookup(self, code, kind):
            with calls_lock:
                calls.append((code, kind))
            entered.set()
            assert release.wait(timeout=2)
            return {
                "schemaVersion": "biddingflow-procurement-preview-v1",
                "found": True,
                "kind": kind,
                "canonicalCode": code,
                "data": {"notifyNo": code},
            }

    service = ProcurementLookupService(BlockingSource(), ttl_seconds=60)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(service.lookup, "IB2600000002")
        assert entered.wait(timeout=1)
        second = pool.submit(service.lookup, "ib2600000002")
        release.set()
        first_result = first.result(timeout=2)
        second_result = second.result(timeout=2)
        assert first_result["data"] == second_result["data"]
        assert first_result["metrics"]["cache"] == {
            "hit": False, "layer": "NONE",
        }
        assert second_result["metrics"]["cache"] == {
            "hit": True, "layer": "IN_FLIGHT",
        }

    assert service.lookup("IB2600000002")["data"]["notifyNo"] == (
        "IB2600000002"
    )
    assert calls == [("IB2600000002", "PACKAGE")]


def test_browser_launcher_factory_keeps_warm_runtime_and_isolates_research_mode():
    created = []

    class Runtime:
        def is_healthy(self):
            return True

    def runtime_factory(config):
        created.append(config)
        return Runtime()

    standard = BrowserLauncherFactory.create(
        "standard", runtime_factory=runtime_factory
    )
    assert isinstance(standard, StandardBrowserLauncher)
    assert standard.get_runtime() is standard.get_runtime()
    assert created == [{
        "headless": True,
        "browserMode": "standard",
        "targetHost": "muasamcong.mpi.gov.vn",
        "chromiumArgs": [],
        "drivers": {"vue2": True, "generic": True},
        "extractors": {"network": True, "vue": True, "dom": True},
        "idleTtlMs": 900_000,
        "workerResponseTimeoutMs": 25_000,
        "maxResponseBytes": 1_048_576,
        "navigationTimeoutMs": 20_000,
        "actionTimeoutMs": 15_000,
        "workerQueueTimeoutMs": 250,
    }]

    with pytest.raises(
        ProcurementLookupError, match="PROCUREMENT_ADAPTER_UNSUPPORTED"
    ):
        BrowserLauncherFactory.create(
            "research-stealth",
            research_enabled=False,
            runtime_factory=runtime_factory,
        )

    research = BrowserLauncherFactory.create(
        "research-stealth",
        research_enabled=True,
        allowed_research_hosts={"muasamcong.mpi.gov.vn"},
        runtime_factory=runtime_factory,
    )
    assert isinstance(research, ResearchBrowserLauncher)
    research.get_runtime()
    assert created[-1]["browserMode"] == "research-stealth"
    assert created[-1]["chromiumArgs"] == []

    with pytest.raises(
        ProcurementLookupError, match="PROCUREMENT_ADAPTER_UNSUPPORTED"
    ):
        BrowserLauncherFactory.create(
            "research-stealth",
            research_enabled=True,
            allowed_research_hosts={"example.test"},
            runtime_factory=runtime_factory,
        )


def test_launcher_restarts_runtime_after_idle_ttl():
    now = [100.0]
    created = []

    class Runtime:
        def __init__(self):
            self.closed = False

        def is_healthy(self):
            return not self.closed

        def close(self):
            self.closed = True

    def runtime_factory(_config):
        runtime = Runtime()
        created.append(runtime)
        return runtime

    launcher = StandardBrowserLauncher(
        runtime_factory=runtime_factory,
        idle_ttl_seconds=60,
        clock=lambda: now[0],
    )
    assert launcher.get_runtime() is launcher.get_runtime()
    now[0] = 161.0
    replacement = launcher.get_runtime()

    assert len(created) == 2
    assert created[0].closed is True
    assert replacement is created[1]


def test_node_browser_runtime_reuses_one_worker_and_exchanges_sanitized_json_lines():
    processes = []

    class FakeStdin:
        def __init__(self):
            self.lines = []

        def write(self, value):
            self.lines.append(value)

        def flush(self):
            return None

    class FakeStdout:
        def __init__(self, process):
            self.process = process

        def readline(self):
            request = json.loads(self.process.stdin.lines[-1])
            if request["operation"] == "initialize":
                result = {"ready": True}
            else:
                result = {
                    "schemaVersion": "muasamcong-browser-artifact-v1",
                    "browserMode": request["browserMode"],
                    "driver": "generic",
                    "networkResponses": [],
                    "vueStateCandidates": [],
                    "domCandidates": [],
                    "metrics": {},
                }
            return json.dumps({
                "requestId": request["requestId"],
                "ok": True,
                "result": result,
            }) + "\n"

    class FakeProcess:
        def __init__(self):
            self.stdin = FakeStdin()
            self.stdout = FakeStdout(self)
            self.returncode = None
            self.terminated = False

        def poll(self):
            return self.returncode

        def terminate(self):
            self.terminated = True
            self.returncode = 0

        def wait(self, timeout):
            assert timeout <= 2
            return self.returncode

    def popen(command, **options):
        assert command[0].lower().endswith("node.exe") or command[0] == "node"
        assert command[1].endswith("browser_worker.mjs")
        assert options["text"] is True
        process = FakeProcess()
        processes.append(process)
        return process

    runtime = NodeBrowserRuntime(
        {
            "headless": True,
            "browserMode": "standard",
            "targetHost": "muasamcong.mpi.gov.vn",
            "chromiumArgs": [],
        },
        popen=popen,
        node_executable="node",
    )
    first = runtime.lookup("PL2600000001", "PLAN")
    second = runtime.lookup("IB2600000002", "PACKAGE")
    probe = runtime.probe()

    assert len(processes) == 1
    assert first["browserMode"] == second["browserMode"] == "standard"
    requests = [json.loads(line) for line in processes[0].stdin.lines]
    assert [row["operation"] for row in requests] == [
        "initialize", "lookup", "lookup", "probe",
    ]
    assert requests[1]["code"] == "PL2600000001"
    assert "token" not in json.dumps(requests).casefold()
    assert "cookie" not in json.dumps(requests).casefold()
    assert runtime.is_healthy() is True
    assert probe["driver"] == "generic"

    runtime.close()
    assert processes[0].terminated is True


def test_node_browser_runtime_times_out_blocked_worker_and_marks_it_unhealthy():
    release = Event()

    class FakeStdin:
        def __init__(self):
            self.lines = []

        def write(self, value):
            self.lines.append(value)

        def flush(self):
            return None

    class FakeStdout:
        def __init__(self, process):
            self.process = process

        def readline(self):
            request = json.loads(self.process.stdin.lines[-1])
            if request["operation"] == "initialize":
                return json.dumps({
                    "requestId": request["requestId"],
                    "ok": True,
                    "result": {"ready": True},
                }) + "\n"
            release.wait(timeout=1)
            return ""

    class FakeProcess:
        def __init__(self):
            self.stdin = FakeStdin()
            self.stdout = FakeStdout(self)
            self.returncode = None

        def poll(self):
            return self.returncode

        def terminate(self):
            self.returncode = 0
            release.set()

        def wait(self, timeout):
            return self.returncode

        def kill(self):
            self.returncode = -9
            release.set()

    process = FakeProcess()
    runtime = NodeBrowserRuntime(
        {
            "headless": True,
            "browserMode": "standard",
            "targetHost": "muasamcong.mpi.gov.vn",
            "chromiumArgs": [],
            "workerResponseTimeoutMs": 50,
        },
        popen=lambda *_args, **_options: process,
    )

    started = time.monotonic()
    with pytest.raises(ProcurementLookupError, match="PROCUREMENT_TIMEOUT"):
        runtime.lookup("IB2600000002", "PACKAGE")

    assert time.monotonic() - started < 0.5
    assert runtime.is_healthy() is False


def test_node_browser_runtime_rejects_a_second_different_lookup_when_busy():
    entered = Event()
    release = Event()

    class FakeStdin:
        def __init__(self):
            self.lines = []

        def write(self, value):
            self.lines.append(value)

        def flush(self):
            return None

    class FakeStdout:
        def __init__(self, process):
            self.process = process

        def readline(self):
            request = json.loads(self.process.stdin.lines[-1])
            if request["operation"] == "lookup":
                entered.set()
                assert release.wait(timeout=1)
            result = {"ready": True} if request["operation"] == "initialize" else {
                "schemaVersion": "muasamcong-browser-artifact-v1",
                "browserMode": "standard",
                "driver": "generic",
                "networkResponses": [],
                "vueStateCandidates": [],
                "domCandidates": [],
                "metrics": {},
            }
            return json.dumps({
                "requestId": request["requestId"], "ok": True, "result": result,
            }) + "\n"

    class FakeProcess:
        def __init__(self):
            self.stdin = FakeStdin()
            self.stdout = FakeStdout(self)
            self.returncode = None

        def poll(self):
            return self.returncode

        def terminate(self):
            self.returncode = 0
            release.set()

        def wait(self, timeout):
            return self.returncode

        def kill(self):
            self.returncode = -9
            release.set()

    runtime = NodeBrowserRuntime(
        {
            "headless": True,
            "browserMode": "standard",
            "targetHost": "muasamcong.mpi.gov.vn",
            "chromiumArgs": [],
            "workerResponseTimeoutMs": 1000,
            "workerQueueTimeoutMs": 50,
        },
        popen=lambda *_args, **_options: FakeProcess(),
    )
    with ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(runtime.lookup, "IB2600000002", "PACKAGE")
        assert entered.wait(timeout=1)
        with pytest.raises(
            ProcurementLookupError, match="PROCUREMENT_LOOKUP_BUSY"
        ):
            runtime.lookup("PL2600000001", "PLAN")
        release.set()
        assert first.result(timeout=1)["driver"] == "generic"
    runtime.close()


def test_extraction_falls_back_to_vue_then_semantic_dom_with_versioned_parser():
    vue_result = MuaSamCongBrowserSource(
        runtime=FixtureBrowserRuntime("plan_budget.json")
    ).lookup("PL2600000003", "PLAN")
    assert vue_result["source"]["extractionStrategy"] == "vue-state"
    assert vue_result["data"]["planName"] == "Kế hoạch dự toán mua sắm"

    dom_result = MuaSamCongBrowserSource(
        runtime=FixtureBrowserRuntime("package_lots.json")
    ).lookup("IB2600000005", "PACKAGE")
    assert dom_result["source"]["extractionStrategy"] == "semantic-dom"
    assert dom_result["data"]["lots"] == [
        {"lotNo": "01", "lotName": "Lô 1", "lotPrice": 100},
        {"lotNo": "02", "lotName": "Lô 2", "lotPrice": 200},
    ]


def test_many_package_plan_stays_in_one_lookup_and_schema_drift_fails_closed():
    runtime = FixtureBrowserRuntime("plan_many_packages.json")
    result = MuaSamCongBrowserSource(runtime=runtime).lookup(
        "PL2600000004", "PLAN"
    )
    assert [row["bidName"] for row in result["data"]["packages"]] == [
        "Gói 1", "Gói 2", "Gói 3",
    ]
    assert runtime.calls == [("PL2600000004", "PLAN")]

    with pytest.raises(
        ProcurementLookupError, match="PROCUREMENT_SCHEMA_CHANGED"
    ):
        MuaSamCongBrowserSource(
            runtime=FixtureBrowserRuntime("schema_changed.json")
        ).lookup("IB2600000006", "PACKAGE")

    with pytest.raises(ProcurementLookupError, match="PROCUREMENT_NOT_FOUND"):
        MuaSamCongBrowserSource(
            runtime=FixtureBrowserRuntime("not_found.json")
        ).lookup("IB2600000007", "PACKAGE")


def test_lookup_service_circuit_breaker_stops_repeating_browser_failures():
    now = [100.0]

    class FailingSource:
        name = "MUASAMCONG_BROWSER"
        parser_version = "2026.1"

        def __init__(self):
            self.calls = 0

        def lookup(self, _code, _kind):
            self.calls += 1
            raise ProcurementLookupError("PROCUREMENT_BROWSER_FAILED")

    source = FailingSource()
    service = ProcurementLookupService(
        source,
        failure_threshold=3,
        circuit_seconds=30,
        clock=lambda: now[0],
    )
    for _ in range(3):
        with pytest.raises(
            ProcurementLookupError, match="PROCUREMENT_BROWSER_FAILED"
        ):
            service.lookup("IB2600000002")

    with pytest.raises(ProcurementLookupError, match="PROCUREMENT_LOOKUP_BUSY"):
        service.lookup("IB2600000002")
    assert source.calls == 3

    now[0] = 131.0
    with pytest.raises(
        ProcurementLookupError, match="PROCUREMENT_BROWSER_FAILED"
    ):
        service.lookup("IB2600000002")
    assert source.calls == 4


def test_lookup_service_observer_distinguishes_source_and_cache_results():
    events = []

    class Source:
        name = "MUASAMCONG_BROWSER"
        parser_version = "2026.1"

        def lookup(self, code, kind):
            return {
                "schemaVersion": "biddingflow-procurement-preview-v1",
                "kind": kind,
                "canonicalCode": code,
                "source": {
                    "driver": "generic",
                    "browserMode": "standard",
                    "extractionStrategy": "network-json",
                    "parserVersion": "2026.1",
                },
                "metrics": {"totalMs": 42},
                "data": {"notifyNo": code},
            }

    service = ProcurementLookupService(Source(), observer=events.append)
    service.lookup("IB2600000002", lookup_request_id="request-1")
    service.lookup("IB2600000002", lookup_request_id="request-1")

    assert [event["cache"] for event in events] == ["miss", "hit"]
    assert events[0] == {
        "provider": "MUASAMCONG_BROWSER",
        "lookupRequestId": "request-1",
        "kind": "PACKAGE",
        "canonicalCode": "IB2600000002",
        "driver": "generic",
        "browserMode": "standard",
        "extractor": "network-json",
        "cache": "miss",
        "cacheLayer": "NONE",
        "detailLevel": "CANONICAL",
        "revisionMode": "LATEST",
        "durationMs": 42,
        "browserStartupMs": 0,
        "sessionAcquireMs": 0,
        "sessionCacheHit": False,
        "upstreamDurationMs": 0,
        "collectionDurationMs": 0,
        "mappingDurationMs": 0,
        "normalizeDurationMs": 0,
        "upstreamRequestCount": 0,
        "partialFailureCount": 0,
        "resultClass": "success",
        "parserVersion": "2026.1",
    }


def test_lookup_service_checks_l1_before_shared_l2_cache():
    class Source:
        name = "MUASAMCONG_BROWSER"
        parser_version = "2026.1"

        def lookup(self, code, kind):
            return {
                "schemaVersion": "biddingflow-procurement-preview-v1",
                "kind": kind,
                "canonicalCode": code,
                "source": {"parserVersion": self.parser_version},
                "metrics": {},
                "data": {},
            }

    class SharedCache:
        def __init__(self):
            self.get_calls = 0
            self.value = None

        def get(self, _key):
            self.get_calls += 1
            return self.value

        def put(self, _key, value, _ttl_seconds):
            self.value = value

    shared = SharedCache()
    service = ProcurementLookupService(Source(), shared_cache=shared)

    service.lookup("PL2600244105")
    service.lookup("PL2600244105")

    assert shared.get_calls == 1


def test_lookup_service_l2_hit_never_calls_upstream_source():
    cached = {
        "schemaVersion": "biddingflow-procurement-preview-v1",
        "kind": "PLAN",
        "canonicalCode": "PL2600244105",
        "source": {"parserVersion": "2026.1"},
        "metrics": {},
        "data": {"planNo": "PL2600244105"},
    }

    class Source:
        name = "MUASAMCONG_BROWSER"
        parser_version = "2026.1"

        def lookup(self, _code, _kind):
            raise AssertionError("L2 hit must not call upstream")

    class SharedCache:
        def get(self, _key):
            return cached

        def put(self, *_args):
            raise AssertionError("L2 hit must not rewrite cache")

    result = ProcurementLookupService(
        Source(), shared_cache=SharedCache()
    ).lookup("PL2600244105")

    assert result["data"] == cached["data"]
    assert result["metrics"]["cache"] == {"hit": True, "layer": "L2"}


def test_lookup_service_uses_separate_plan_open_and_closed_package_ttls():
    stored = []

    class SharedCache:
        def get(self, _key):
            return None

        def put(self, key, value, ttl_seconds):
            stored.append((key[1], value["canonicalCode"], ttl_seconds))

    class Source:
        name = "MUASAMCONG_BROWSER"
        parser_version = "2026.1"

        def lookup(self, code, kind):
            close_date = {
                "IB2600000002": "2026-09-01T09:00:00+07:00",
                "IB2600000003": "2025-09-01T09:00:00+07:00",
            }.get(code)
            return {
                "schemaVersion": "biddingflow-procurement-preview-v1",
                "kind": kind,
                "canonicalCode": code,
                "source": {"parserVersion": "2026.1"},
                "data": {"bidCloseDate": close_date} if close_date else {},
            }

    service = ProcurementLookupService(
        Source(),
        shared_cache=SharedCache(),
        ttl_by_kind={"PLAN": 100, "OPEN_PACKAGE": 20, "CLOSED_PACKAGE": 300},
        utc_now=lambda: datetime(2026, 8, 11, tzinfo=timezone.utc),
    )

    service.lookup("PL2600000001")
    service.lookup("IB2600000002")
    service.lookup("IB2600000003")

    assert stored == [
        ("PLAN", "PL2600000001", 100.0),
        ("PACKAGE", "IB2600000002", 20.0),
        ("PACKAGE", "IB2600000003", 300.0),
    ]


def test_lookup_service_observes_sanitized_failure_class():
    events = []

    class Source:
        name = "MUASAMCONG_BROWSER"
        parser_version = "2026.1"

        def lookup(self, _code, _kind):
            raise ProcurementLookupError("PROCUREMENT_INTERACTION_REQUIRED")

    service = ProcurementLookupService(Source(), observer=events.append)

    with pytest.raises(
        ProcurementLookupError, match="PROCUREMENT_INTERACTION_REQUIRED"
    ):
        service.lookup("IB2600000002")

    assert events == [{
        "provider": "MUASAMCONG_BROWSER",
        "lookupRequestId": "",
        "kind": "PACKAGE",
        "canonicalCode": "IB2600000002",
        "driver": "unknown",
        "browserMode": "unknown",
        "extractor": "unknown",
        "cache": "miss",
        "cacheLayer": "NONE",
        "detailLevel": "CANONICAL",
        "revisionMode": "LATEST",
        "durationMs": events[0]["durationMs"],
        "browserStartupMs": 0,
        "sessionAcquireMs": 0,
        "sessionCacheHit": False,
        "upstreamDurationMs": 0,
        "collectionDurationMs": 0,
        "mappingDurationMs": 0,
        "normalizeDurationMs": 0,
        "upstreamRequestCount": 0,
        "partialFailureCount": 0,
        "resultClass": "PROCUREMENT_INTERACTION_REQUIRED",
        "parserVersion": "2026.1",
    }]
    assert isinstance(events[0]["durationMs"], (int, float))


def test_lookup_service_uses_raw_snapshot_before_upstream_and_projects_once():
    calls = []
    raw_bundle = {
        "schemaVersion": "biddingflow-muasamcong-raw-bundle-v2",
        "entity": {"kind": "PLAN", "planNo": "PL2600244105"},
    }

    class Source:
        name = "MUASAMCONG"
        parser_version = "2026.08"

        def lookup(self, *_args):
            raise AssertionError("raw hit must not call upstream")

        def lookup_from_raw_bundle(self, code, bundle, *, revision_mode):
            calls.append((code, bundle, revision_mode))
            return {
                "schemaVersion": "biddingflow-procurement-preview-v1",
                "kind": "PLAN",
                "canonicalCode": code,
                "detailLevel": "COMPLETE",
                "revisionMode": revision_mode,
                "source": {"provider": self.name},
                "metrics": {"upstream": {"requestCount": 0}},
                "data": {"planNo": code},
                "rawBundle": bundle,
            }

    service = ProcurementLookupService(Source())
    result = service.lookup(
        "PL2600244105",
        detail_level="COMPLETE",
        revision_mode="ALL",
        raw_bundle_loader=lambda: raw_bundle,
        cache_scope="org-1",
    )

    assert calls == [("PL2600244105", raw_bundle, "ALL")]
    assert result["metrics"]["cache"] == {
        "hit": True, "layer": "RAW_SNAPSHOT",
    }
    assert result["metrics"]["upstream"]["requestCount"] == 0


def test_lookup_cache_scope_prevents_cross_organization_complete_hits():
    calls = []

    class Source:
        name = "MUASAMCONG_BROWSER"
        parser_version = "2026.1"

        def lookup(self, code, kind):
            calls.append((code, kind))
            return {
                "schemaVersion": "biddingflow-procurement-preview-v1",
                "kind": kind,
                "canonicalCode": code,
                "source": {"parserVersion": self.parser_version},
                "metrics": {},
                "data": {},
            }

    service = ProcurementLookupService(Source())
    service.lookup("PL2600244105", cache_scope="org-1")
    service.lookup("PL2600244105", cache_scope="org-2")

    assert calls == [
        ("PL2600244105", "PLAN"),
        ("PL2600244105", "PLAN"),
    ]


def test_postgres_shared_cache_namespaces_and_validates_stable_contract():
    rows = {}

    class Connection:
        def execute(self, sql, parameters):
            if sql.lstrip().startswith("SELECT"):
                cache_key, now = parameters
                row = rows.get(cache_key)
                if not row or row["expires_at"] <= now:
                    return type("Result", (), {"fetchone": lambda self: None})()
                return type(
                    "Result", (), {"fetchone": lambda self: row}
                )()
            cache_key, result_json, expires_at, updated_at = parameters
            rows[cache_key] = {
                "result_json": result_json,
                "expires_at": expires_at,
                "updated_at": updated_at,
            }
            return type("Result", (), {"fetchone": lambda self: None})()

        def commit(self):
            return None

        def rollback(self):
            return None

        def close(self):
            return None

    database = type(
        "Database", (), {"get_connection": lambda self: Connection()}
    )()
    cache = PostgresProcurementLookupCache(database=database, epoch_clock=lambda: 100)
    key = ("MUASAMCONG_BROWSER", "PACKAGE", "IB2600000002", "2026.1")
    value = {
        "schemaVersion": "biddingflow-procurement-preview-v1",
        "kind": "PACKAGE",
        "canonicalCode": "IB2600000002",
        "data": {"notifyNo": "IB2600000002"},
    }

    cache.put(key, value, 60)

    assert len(rows) == 1
    assert next(iter(rows)) != hashlib.sha256(
        "IB2600000002".encode()
    ).hexdigest()
    assert cache.get(key) == value
    rows[next(iter(rows))]["result_json"] = json.dumps({
        **value, "canonicalCode": "IB2600000099",
    })
    assert cache.get(key) is None


def test_parser_registry_resolves_versioned_plan_and_package_parsers():
    registry = ParserRegistry([PlanParserV1(), PackageParserV1()])

    assert isinstance(registry.resolve("PLAN", "2026.1"), PlanParserV1)
    assert isinstance(registry.resolve("PACKAGE"), PackageParserV1)
    with pytest.raises(
        ProcurementLookupError, match="PROCUREMENT_ADAPTER_UNSUPPORTED"
    ):
        registry.resolve("PACKAGE", "2099.1")
