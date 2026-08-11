import pytest

from backend.startup import (
    StartupValidationError,
    validate_procurement_lookup_configuration,
)


def test_disabled_procurement_lookup_does_not_require_browser_runtime():
    validate_procurement_lookup_configuration({"PROCUREMENT_LOOKUP_ENABLED": "false"})


def test_research_launcher_requires_exact_gate_and_official_host():
    base = {
        "PROCUREMENT_LOOKUP_ENABLED": "true",
        "PROCUREMENT_BROWSER_MODE": "research-stealth",
        "RESEARCH_STEALTH_ENABLED": "true",
        "RESEARCH_STEALTH_ALLOWED_TARGET_HOSTS": "example.test",
    }
    with pytest.raises(StartupValidationError, match="official hostname"):
        validate_procurement_lookup_configuration(base)


def test_enabled_lookup_requires_at_least_one_driver_and_extractor():
    base = {
        "PROCUREMENT_LOOKUP_ENABLED": "true",
        "PROCUREMENT_BROWSER_MODE": "standard",
        "MUASAMCONG_DRIVER_VUE2": "false",
        "MUASAMCONG_DRIVER_GENERIC": "false",
    }
    with pytest.raises(StartupValidationError, match="driver"):
        validate_procurement_lookup_configuration(base)

    base.update({
        "MUASAMCONG_DRIVER_GENERIC": "true",
        "MUASAMCONG_EXTRACT_NETWORK": "false",
        "MUASAMCONG_EXTRACT_VUE": "false",
        "MUASAMCONG_EXTRACT_DOM": "false",
    })
    with pytest.raises(StartupValidationError, match="extractor"):
        validate_procurement_lookup_configuration(base)


def test_enabled_standard_lookup_accepts_bounded_configuration():
    validate_procurement_lookup_configuration({
        "PROCUREMENT_LOOKUP_ENABLED": "true",
        "PROCUREMENT_BROWSER_MODE": "standard",
        "MUASAMCONG_DRIVER_VUE2": "true",
        "MUASAMCONG_DRIVER_GENERIC": "true",
        "MUASAMCONG_EXTRACT_NETWORK": "true",
        "MUASAMCONG_EXTRACT_VUE": "true",
        "MUASAMCONG_EXTRACT_DOM": "true",
        "PROCUREMENT_BROWSER_IDLE_TTL_SECONDS": "900",
        "PROCUREMENT_BROWSER_WORKER_TIMEOUT_SECONDS": "25",
        "MUASAMCONG_MAX_RESPONSE_BYTES": "1048576",
    })


def test_lookup_rejects_invalid_cache_configuration_at_startup():
    with pytest.raises(
        StartupValidationError,
        match="PROCUREMENT_LOOKUP_PLAN_CACHE_TTL_SECONDS",
    ):
        validate_procurement_lookup_configuration({
            "PROCUREMENT_LOOKUP_ENABLED": "true",
            "PROCUREMENT_LOOKUP_PLAN_CACHE_TTL_SECONDS": "forever",
        })


def test_lookup_requires_http_timeout_headroom_over_browser_worker():
    with pytest.raises(
        StartupValidationError,
        match="at least 5 seconds lower",
    ):
        validate_procurement_lookup_configuration({
            "PROCUREMENT_LOOKUP_ENABLED": "true",
            "PROCUREMENT_BROWSER_WORKER_TIMEOUT_SECONDS": "30",
            "PROCUREMENT_LOOKUP_TIMEOUT_SECONDS": "30",
        })
