import pytest

from backend.lifecycle import _procurement_source_initialization_enabled
from backend.startup import (
    StartupValidationError,
    validate_procurement_lookup_configuration,
)


def test_procurement_source_initializes_only_when_lookup_is_enabled():
    assert _procurement_source_initialization_enabled({}) is True
    assert _procurement_source_initialization_enabled({
        "PROCUREMENT_LOOKUP_ENABLED": "true",
    }) is True
    assert _procurement_source_initialization_enabled({
        "PROCUREMENT_LOOKUP_ENABLED": "false",
    }) is False


def test_disabled_procurement_lookup_does_not_require_browser_runtime():
    validate_procurement_lookup_configuration({"PROCUREMENT_LOOKUP_ENABLED": "false"})


def test_procurement_browser_mode_and_gate_default_enabled():
    from backend.procurement_lookup.config import ProcurementLookupSettings

    settings = ProcurementLookupSettings.from_environ({})

    assert settings.enabled is True


@pytest.mark.parametrize("mode", ["standard", "", "invalid"])
def test_legacy_flags_cannot_disable_fixed_browser(mode):
    from backend.procurement_lookup.config import ProcurementLookupSettings
    settings = ProcurementLookupSettings.from_environ({
        "PROCUREMENT_BROWSER_MODE": mode, "PROCUREMENT_BROWSER_ENABLED": "false",
    })
    assert settings == ProcurementLookupSettings.from_environ({})
    assert not hasattr(settings, "mode")
    assert not hasattr(settings, "research_enabled")


def test_research_launcher_requires_exact_gate_and_official_host():
    base = {
        "PROCUREMENT_LOOKUP_ENABLED": "true",
        "PROCUREMENT_BROWSER_MODE": "procurement-browser",
        "PROCUREMENT_BROWSER_ENABLED": "true",
        "PROCUREMENT_ALLOWED_TARGET_HOSTS": "example.test",
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
