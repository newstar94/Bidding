"""Process-wide registry for the one Mua Sắm Công runtime."""

from __future__ import annotations

import os
from threading import RLock

from backend.integrations.muasamcong_browser.procurement_source import (
    MuaSamCongProcurementSource,
)
from backend.shared.logging_utils import log_structured_event


_LOCK = RLock()
_SOURCE = None
_FINGERPRINT = None
_CONFIG_KEYS = (
    "MUASAMCONG_BROWSER_EXECUTABLE_PATH",
    "MUASAMCONG_BROWSER_HEADLESS",
    "MUASAMCONG_DRIVER_VUE2",
    "MUASAMCONG_DRIVER_GENERIC",
    "MUASAMCONG_EXTRACT_NETWORK",
    "MUASAMCONG_EXTRACT_VUE",
    "MUASAMCONG_EXTRACT_VUE3",
    "MUASAMCONG_EXTRACT_REACT",
    "MUASAMCONG_EXTRACT_DOM",
    "MUASAMCONG_ENDPOINT_PROFILE",
    "MUASAMCONG_SESSION_TTL_SECONDS",
    "MUASAMCONG_SESSION_TIMEOUT_SECONDS",
    "MUASAMCONG_API_TIMEOUT_SECONDS",
    "MUASAMCONG_API_RETRIES",
    "MUASAMCONG_CIRCUIT_SECONDS",
    "MUASAMCONG_MAX_CONCURRENCY",
    "MUASAMCONG_API_QUEUE_TIMEOUT_MS",
    "MUASAMCONG_WORKER_TIMEOUT_SECONDS",
    "MUASAMCONG_WORKER_QUEUE_TIMEOUT_MS",
    "MUASAMCONG_MAX_RESPONSE_BYTES",
    "MUASAMCONG_NAVIGATION_TIMEOUT_MS",
    "MUASAMCONG_ACTION_TIMEOUT_MS",
    "MUASAMCONG_DIAGNOSTICS_ENABLED",
    "MUASAMCONG_DIAGNOSTICS_DIR",
    "MUASAMCONG_SHADOW_PARSER_ENABLED",
)


def _fingerprint():
    return tuple((key, os.environ.get(key)) for key in _CONFIG_KEYS)


def _observe_source(event):
    event = dict(event or {})
    request_id = event.pop("lookupRequestId", None)
    log_structured_event(
        "procurement.source.completed",
        request_id=request_id,
        fields=event,
        nonblocking=True,
    )


def get_muasamcong_source():
    global _SOURCE, _FINGERPRINT
    fingerprint = _fingerprint()
    with _LOCK:
        if _SOURCE is not None and _FINGERPRINT == fingerprint:
            return _SOURCE
        previous = _SOURCE
        _SOURCE = MuaSamCongProcurementSource.from_environ(
            observer=_observe_source
        )
        _FINGERPRINT = fingerprint
    if previous is not None:
        previous.close()
    return _SOURCE


def close_muasamcong_source():
    global _SOURCE, _FINGERPRINT
    with _LOCK:
        source = _SOURCE
        _SOURCE = None
        _FINGERPRINT = None
    if source is not None:
        source.close()
