"""Inspect one authorized Mua Sam Cong lookup without exposing raw browser data."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.integrations.muasamcong_browser.launchers import (
    BrowserLauncherFactory,
)
from backend.procurement_import.domain import (
    ProcurementCodeKind,
    normalize_procurement_code,
)
from backend.procurement_lookup.config import ProcurementLookupSettings
from backend.procurement_lookup.domain import ProcurementLookupError
from scripts.env_utils import load_env


_CAPABILITY_KEYS = {
    "vue2", "vueInstanceCount", "knownSearchRoot", "knownRuntimeShape",
    "genericSearchUi",
}
_METRIC_KEYS = {
    "browserStartupMs", "navigationMs", "lookupActionMs",
    "networkWaitMs", "extractMs", "totalMs",
}


def summarize_artifact(artifact, *, code, kind):
    diagnostics = artifact.get("diagnostics") or {}
    capabilities = artifact.get("capabilities") or {}
    network_count = len(artifact.get("networkResponses") or [])
    vue_count = len(artifact.get("vueStateCandidates") or [])
    dom_count = len(artifact.get("domCandidates") or [])
    summary = {
        "code": str(code),
        "kind": str(kind),
        "browserMode": str(artifact.get("browserMode") or "unknown"),
        "framework": str(artifact.get("framework") or "unknown"),
        "driver": str(artifact.get("driver") or "unknown"),
        "capabilities": {
            key: int(value) if key == "vueInstanceCount" else bool(value)
            for key, value in capabilities.items()
            if key in _CAPABILITY_KEYS
        },
        "networkResponseCount": network_count,
        "vueCandidateCount": vue_count,
        "domCandidateCount": dom_count,
        "matchingCandidates": int(
            diagnostics.get("matchingCandidates", vue_count + dom_count)
        ),
        "extractorSelected": str(
            diagnostics.get("extractorSelected") or "unknown"
        ),
        "metrics": {
            key: value
            for key, value in (artifact.get("metrics") or {}).items()
            if key in _METRIC_KEYS and isinstance(value, (int, float))
        },
    }
    if "interactionRequired" in artifact:
        summary["interactionRequired"] = bool(artifact["interactionRequired"])
    if artifact.get("lookupError"):
        summary["resultClass"] = str(artifact["lookupError"])
    return summary


def _live_artifact(code, kind):
    if os.environ.get("APP_ENV", "development").strip().casefold() == "production":
        raise RuntimeError("Live research CLI is disabled in production.")
    config = ProcurementLookupSettings.from_environ()
    if not config.enabled:
        raise RuntimeError("Set PROCUREMENT_LOOKUP_ENABLED=true for live research.")
    launcher = BrowserLauncherFactory.create(
        config.mode,
        **config.launcher_options,
    )
    try:
        runtime = launcher.get_runtime()
        try:
            probe = runtime.probe()
        except ProcurementLookupError as error:
            return {
                "schemaVersion": "muasamcong-browser-probe-v1",
                "browserMode": config.mode,
                "framework": "unknown",
                "capabilities": {},
                "interactionRequired": False,
                "lookupError": str(error),
                "metrics": {},
                "diagnostics": {},
            }
        try:
            artifact = runtime.lookup(code, kind)
            artifact["framework"] = probe.get("framework", "unknown")
            artifact["capabilities"] = probe.get("capabilities", {})
            artifact["interactionRequired"] = probe.get(
                "interactionRequired", False
            )
            return artifact
        except ProcurementLookupError as error:
            probe["lookupError"] = str(error)
            return probe
    finally:
        launcher.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("code", help="One exact PL/IB code")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--fixture", type=Path, help="Read a captured test artifact")
    source.add_argument("--live", action="store_true", help="Run one authorized dev lookup")
    args = parser.parse_args(argv)

    normalized = normalize_procurement_code(args.code)
    kind = (
        "PLAN" if normalized.kind is ProcurementCodeKind.PLAN else "PACKAGE"
    )
    if args.fixture:
        artifact = json.loads(args.fixture.read_text(encoding="utf-8"))
    else:
        load_env(PROJECT_ROOT)
        artifact = _live_artifact(normalized.base_code, kind)
    print(json.dumps(
        summarize_artifact(artifact, code=normalized.base_code, kind=kind),
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    ))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
