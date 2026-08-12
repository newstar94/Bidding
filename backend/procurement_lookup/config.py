"""Single source of truth for procurement lookup runtime configuration."""

from __future__ import annotations

from dataclasses import dataclass
import os
from typing import Mapping


OFFICIAL_MUASAMCONG_HOST = "muasamcong.mpi.gov.vn"


class ProcurementLookupConfigurationError(ValueError):
    """Raised when an enabled lookup profile cannot run safely."""


def _boolean(environ, name, default):
    value = str(environ.get(name, default)).strip().casefold()
    if value not in {"true", "false"}:
        raise ProcurementLookupConfigurationError(
            f"{name} must be true or false."
        )
    return value == "true"


def _number(environ, name, default, minimum, maximum, *, integer=False):
    raw = str(environ.get(name, default)).strip()
    try:
        value = int(raw) if integer else float(raw)
    except (TypeError, ValueError) as error:
        kind = "an integer" if integer else "a number"
        raise ProcurementLookupConfigurationError(
            f"{name} must be {kind}."
        ) from error
    if value < minimum or value > maximum:
        raise ProcurementLookupConfigurationError(
            f"{name} must be between {minimum} and {maximum}."
        )
    return value


@dataclass(frozen=True, slots=True)
class ProcurementLookupSettings:
    """Validated settings consumed by startup, HTTP and browser boundaries."""

    enabled: bool
    mode: str
    research_enabled: bool
    allowed_hosts: frozenset[str]
    ttl_seconds: float
    plan_cache_ttl_seconds: float
    open_package_cache_ttl_seconds: float
    closed_package_cache_ttl_seconds: float
    raw_cache_ttl_seconds: float
    shared_cache_enabled: bool
    coalesce_timeout_seconds: float
    idle_ttl_seconds: float
    worker_timeout_seconds: float
    request_timeout_seconds: float
    max_response_bytes: int
    navigation_timeout_ms: int
    action_timeout_ms: int
    worker_queue_timeout_ms: int
    driver_vue2: bool
    driver_generic: bool
    extract_network: bool
    extract_vue: bool
    extract_vue3: bool
    extract_react: bool
    extract_dom: bool

    @classmethod
    def from_environ(cls, environ: Mapping[str, object] | None = None):
        environ = os.environ if environ is None else environ
        enabled = _boolean(
            environ, "PROCUREMENT_LOOKUP_ENABLED", "false"
        )
        mode = str(
            environ.get("PROCUREMENT_BROWSER_MODE", "standard")
        ).strip().casefold()
        research_enabled = _boolean(
            environ, "RESEARCH_STEALTH_ENABLED", "false"
        )
        allowed_hosts = frozenset(
            host.strip().casefold()
            for host in str(environ.get(
                "RESEARCH_STEALTH_ALLOWED_TARGET_HOSTS",
                OFFICIAL_MUASAMCONG_HOST,
            )).split(",")
            if host.strip()
        )
        driver_vue2 = _boolean(
            environ, "MUASAMCONG_DRIVER_VUE2", "true"
        )
        driver_generic = _boolean(
            environ, "MUASAMCONG_DRIVER_GENERIC", "true"
        )
        extract_network = _boolean(
            environ, "MUASAMCONG_EXTRACT_NETWORK", "true"
        )
        extract_vue = _boolean(
            environ, "MUASAMCONG_EXTRACT_VUE", "true"
        )
        extract_vue3 = _boolean(
            environ,
            "MUASAMCONG_EXTRACT_VUE3",
            str(extract_vue).lower(),
        )
        extract_react = _boolean(
            environ,
            "MUASAMCONG_EXTRACT_REACT",
            str(extract_vue).lower(),
        )
        extract_dom = _boolean(
            environ, "MUASAMCONG_EXTRACT_DOM", "true"
        )

        if enabled and mode not in {"standard", "research-stealth"}:
            raise ProcurementLookupConfigurationError(
                "PROCUREMENT_BROWSER_MODE must be standard or research-stealth."
            )
        if enabled and mode == "research-stealth":
            if not research_enabled:
                raise ProcurementLookupConfigurationError(
                    "research-stealth mode requires "
                    "RESEARCH_STEALTH_ENABLED=true."
                )
            if allowed_hosts != {OFFICIAL_MUASAMCONG_HOST}:
                raise ProcurementLookupConfigurationError(
                    "research-stealth requires the exact official hostname "
                    "allowlist."
                )
        if enabled and not (driver_vue2 or driver_generic):
            raise ProcurementLookupConfigurationError(
                "At least one Mua Sam Cong browser driver must be enabled."
            )
        if enabled and not (
            extract_network
            or extract_vue
            or extract_vue3
            or extract_react
            or extract_dom
        ):
            raise ProcurementLookupConfigurationError(
                "At least one Mua Sam Cong extractor must be enabled."
            )

        ttl_seconds = _number(
            environ, "PROCUREMENT_LOOKUP_CACHE_TTL_SECONDS", 300, 1, 86400
        )
        worker_timeout_seconds = _number(
            environ,
            "PROCUREMENT_BROWSER_WORKER_TIMEOUT_SECONDS",
            25,
            5,
            55,
        )
        request_timeout_seconds = _number(
            environ,
            "PROCUREMENT_LOOKUP_TIMEOUT_SECONDS",
            30,
            10,
            60,
        )
        if (
            enabled
            and worker_timeout_seconds + 5 > request_timeout_seconds
        ):
            raise ProcurementLookupConfigurationError(
                "PROCUREMENT_BROWSER_WORKER_TIMEOUT_SECONDS must be at "
                "least 5 seconds lower than "
                "PROCUREMENT_LOOKUP_TIMEOUT_SECONDS."
            )
        return cls(
            enabled=enabled,
            mode=mode,
            research_enabled=research_enabled,
            allowed_hosts=allowed_hosts,
            ttl_seconds=ttl_seconds,
            plan_cache_ttl_seconds=_number(
                environ,
                "PROCUREMENT_LOOKUP_PLAN_CACHE_TTL_SECONDS",
                ttl_seconds,
                1,
                86400,
            ),
            open_package_cache_ttl_seconds=_number(
                environ,
                "PROCUREMENT_LOOKUP_OPEN_PACKAGE_CACHE_TTL_SECONDS",
                ttl_seconds,
                1,
                86400,
            ),
            closed_package_cache_ttl_seconds=_number(
                environ,
                "PROCUREMENT_LOOKUP_CLOSED_PACKAGE_CACHE_TTL_SECONDS",
                ttl_seconds,
                1,
                86400,
            ),
            raw_cache_ttl_seconds=_number(
                environ,
                "PROCUREMENT_RAW_CACHE_TTL_SECONDS",
                900,
                1,
                86400,
            ),
            shared_cache_enabled=_boolean(
                environ, "PROCUREMENT_LOOKUP_SHARED_CACHE_ENABLED", "true"
            ),
            coalesce_timeout_seconds=_number(
                environ,
                "PROCUREMENT_LOOKUP_COALESCE_TIMEOUT_SECONDS",
                25,
                1,
                60,
            ),
            idle_ttl_seconds=_number(
                environ,
                "PROCUREMENT_BROWSER_IDLE_TTL_SECONDS",
                900,
                60,
                3600,
            ),
            worker_timeout_seconds=worker_timeout_seconds,
            request_timeout_seconds=request_timeout_seconds,
            max_response_bytes=_number(
                environ,
                "MUASAMCONG_MAX_RESPONSE_BYTES",
                1_048_576,
                65_536,
                4_194_304,
                integer=True,
            ),
            navigation_timeout_ms=_number(
                environ,
                "MUASAMCONG_NAVIGATION_TIMEOUT_MS",
                20_000,
                5_000,
                60_000,
                integer=True,
            ),
            action_timeout_ms=_number(
                environ,
                "MUASAMCONG_ACTION_TIMEOUT_MS",
                15_000,
                5_000,
                60_000,
                integer=True,
            ),
            worker_queue_timeout_ms=_number(
                environ,
                "PROCUREMENT_BROWSER_QUEUE_TIMEOUT_MS",
                250,
                10,
                5_000,
                integer=True,
            ),
            driver_vue2=driver_vue2,
            driver_generic=driver_generic,
            extract_network=extract_network,
            extract_vue=extract_vue,
            extract_vue3=extract_vue3,
            extract_react=extract_react,
            extract_dom=extract_dom,
        )

    @property
    def driver_flags(self):
        return {"vue2": self.driver_vue2, "generic": self.driver_generic}

    @property
    def extractor_flags(self):
        return {
            "network": self.extract_network,
            "vue": self.extract_vue,
            "vue3": self.extract_vue3,
            "react": self.extract_react,
            "dom": self.extract_dom,
        }

    @property
    def ttl_by_kind(self):
        return {
            "PLAN": self.plan_cache_ttl_seconds,
            "OPEN_PACKAGE": self.open_package_cache_ttl_seconds,
            "CLOSED_PACKAGE": self.closed_package_cache_ttl_seconds,
        }

    @property
    def launcher_options(self):
        """Return the complete server-owned browser launcher contract."""

        return {
            "research_enabled": self.research_enabled,
            "allowed_research_hosts": self.allowed_hosts,
            "driver_flags": self.driver_flags,
            "extractor_flags": self.extractor_flags,
            "idle_ttl_seconds": self.idle_ttl_seconds,
            "worker_response_timeout_seconds": self.worker_timeout_seconds,
            "max_response_bytes": self.max_response_bytes,
            "navigation_timeout_ms": self.navigation_timeout_ms,
            "action_timeout_ms": self.action_timeout_ms,
            "worker_queue_timeout_ms": self.worker_queue_timeout_ms,
        }

    @property
    def fingerprint(self):
        return tuple(
            getattr(self, field)
            for field in self.__dataclass_fields__
        )
