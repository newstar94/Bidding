"""All outbound MSC consumers share the new exact HTTPS origin."""

import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from backend.ai.configuration import get_ai_config
from backend.integrations.muasamcong_browser.launchers import OFFICIAL_HOST
from backend.integrations.vneps.violation_provider import VnepsViolationProvider
from backend.integrations.vneps.errors import VnepsConfigurationError
from backend.partners import partner_lookup_service
from backend.procurement_lookup.config import (
    MUASAMCONG_HOST, MUASAMCONG_ORIGIN, MUASAMCONG_PORTAL_URL,
    ProcurementLookupConfigurationError, ProcurementLookupSettings,
    muasamcong_host_from_environ,
)


def test_python_and_node_share_the_same_official_site():
    worker_dir = Path(__file__).resolve().parents[1] / "backend/integrations/muasamcong_browser"
    script = """
      import { OFFICIAL_HOST, OFFICIAL_ORIGIN, MSC_PORTAL_URL } from './session_provider.mjs';
      import { SEARCH_URL } from './browser_runtime.mjs';
      import { ENDPOINTS, resolveEndpoint } from './endpoint_catalog.mjs';
      process.stdout.write(JSON.stringify({
        host: OFFICIAL_HOST, origin: OFFICIAL_ORIGIN, portal: MSC_PORTAL_URL,
        sessionPortal: MSC_PORTAL_URL, searchOrigin: new URL(SEARCH_URL).origin,
        apiOrigins: [...new Set(Object.keys(ENDPOINTS).map(key => new URL(resolveEndpoint(key).url).origin))],
      }));
    """
    result = subprocess.run(["node", "--input-type=module", "-e", script], cwd=worker_dir,
                            check=True, capture_output=True, text=True, timeout=20)
    assert json.loads(result.stdout) == {
        "host": MUASAMCONG_HOST, "origin": MUASAMCONG_ORIGIN,
        "portal": MUASAMCONG_PORTAL_URL, "sessionPortal": MUASAMCONG_PORTAL_URL,
        "searchOrigin": MUASAMCONG_ORIGIN, "apiOrigins": [MUASAMCONG_ORIGIN],
    }
    assert MUASAMCONG_HOST == OFFICIAL_HOST == "muasamcong.mof.gov.vn"
    assert MUASAMCONG_HOST in get_ai_config({}).web_search_allowed_domains


@pytest.mark.parametrize("host", ["muasamcong.mof.gov.vn", " MUASAMCONG.MOF.GOV.VN "])
def test_env_host_is_normalized_and_used_by_both_runtimes(host):
    assert muasamcong_host_from_environ({"MUASAMCONG_HOST": host}) == "muasamcong.mof.gov.vn"
    assert ProcurementLookupSettings.from_environ({"MUASAMCONG_HOST": host}).allowed_hosts == {"muasamcong.mof.gov.vn"}
    project_root = Path(__file__).resolve().parents[1]
    environment = {**os.environ, "MUASAMCONG_HOST": host}
    python_result = subprocess.run(
        [sys.executable, "-c", "from backend.procurement_lookup.config import MUASAMCONG_PORTAL_URL; print(MUASAMCONG_PORTAL_URL)"],
        cwd=project_root, env=environment, check=True, capture_output=True, text=True, timeout=20,
    )
    node_result = subprocess.run(
        ["node", "--input-type=module", "-e", "import { MSC_PORTAL_URL } from './backend/integrations/muasamcong_browser/session_provider.mjs'; console.log(MSC_PORTAL_URL)"],
        cwd=project_root, env=environment, check=True, capture_output=True, text=True, timeout=20,
    )
    assert python_result.stdout.strip() == node_result.stdout.strip() == "https://muasamcong.mof.gov.vn/web/guest/contractor-selection"


@pytest.mark.parametrize("host", ["", "https://muasamcong.mof.gov.vn", "muasamcong.mpi.gov.vn", "muasamcong.mof.gov.vn.evil.test"])
def test_env_host_cannot_bypass_the_exact_official_boundary(host):
    with pytest.raises(ProcurementLookupConfigurationError, match="MUASAMCONG_HOST"):
        ProcurementLookupSettings.from_environ({"MUASAMCONG_HOST": host})
    result = subprocess.run(
        ["node", "--input-type=module", "-e", "await import('./backend/integrations/muasamcong_browser/session_provider.mjs')"],
        cwd=Path(__file__).resolve().parents[1], env={**os.environ, "MUASAMCONG_HOST": host},
        capture_output=True, text=True, timeout=20,
    )
    assert result.returncode != 0
    assert "PROCUREMENT_ADAPTER_UNSUPPORTED" in result.stderr


@pytest.mark.parametrize("service_name", ["MUASAMCONG_CONTRACTOR_SERVICE_BASE", "MUASAMCONG_INVESTOR_SERVICE_BASE"])
def test_partner_transport_uses_new_origin_and_exact_host(monkeypatch, service_name):
    class Response:
        headers = {}

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self, _limit):
            return b"{}"

    def capture(request, *, allowed_hosts, **_kwargs):
        assert request.full_url.startswith("https://muasamcong.mof.gov.vn/o/")
        assert request.get_header("Origin") == "https://muasamcong.mof.gov.vn"
        assert request.get_header("Referer") == "https://muasamcong.mof.gov.vn/"
        assert allowed_hosts == {"muasamcong.mof.gov.vn"}
        return Response()

    monkeypatch.setattr(partner_lookup_service, "open_allowlisted_https", capture)
    assert partner_lookup_service._post_muasamcong_json(
        "lookup", {}, service_base=getattr(partner_lookup_service, service_name),
    ) == {}


@pytest.mark.parametrize("service_base", [
    "https://muasamcong.mpi.gov.vn/services",
    "http://muasamcong.mof.gov.vn/services",
    "https://muasamcong.mof.gov.vn.evil.test/services",
])
def test_violation_transport_rejects_old_insecure_and_foreign_hosts(service_base):
    with pytest.raises(VnepsConfigurationError):
        VnepsViolationProvider(service_base=service_base)
