"""Deterministic-friendly idle polling backoff for durable queue workers."""

from __future__ import annotations

import math
import os
import random
from collections.abc import Callable
from collections.abc import Mapping


class IdlePollBackoff:
    """Increase empty-queue delays, add bounded jitter, and reset after work.

    Jitter is subtracted rather than added so the configured maximum remains a
    hard upper bound for cross-process job pickup latency.
    """

    __slots__ = (
        "_current_seconds",
        "_initial_seconds",
        "_jitter_ratio",
        "_maximum_seconds",
        "_multiplier",
        "_random_fraction",
    )

    def __init__(
        self,
        initial_seconds: float,
        maximum_seconds: float,
        *,
        multiplier: float = 2.0,
        jitter_ratio: float = 0.1,
        random_fraction: Callable[[], float] | None = None,
    ) -> None:
        values = (initial_seconds, maximum_seconds, multiplier, jitter_ratio)
        if not all(math.isfinite(float(value)) for value in values):
            raise ValueError("Idle polling backoff values must be finite.")
        initial_seconds = float(initial_seconds)
        maximum_seconds = float(maximum_seconds)
        multiplier = float(multiplier)
        jitter_ratio = float(jitter_ratio)
        if initial_seconds <= 0 or maximum_seconds < initial_seconds:
            raise ValueError("Idle polling maximum must be >= a positive initial delay.")
        if multiplier < 1:
            raise ValueError("Idle polling multiplier must be at least 1.")
        if not 0 <= jitter_ratio < 1:
            raise ValueError("Idle polling jitter ratio must be in [0, 1).")

        self._initial_seconds = initial_seconds
        self._maximum_seconds = maximum_seconds
        self._multiplier = multiplier
        self._jitter_ratio = jitter_ratio
        self._random_fraction = random_fraction or random.random
        self._current_seconds = initial_seconds

    def reset(self) -> None:
        self._current_seconds = self._initial_seconds

    def next_delay(self) -> float:
        base_delay = self._current_seconds
        fraction = min(1.0, max(0.0, float(self._random_fraction())))
        delay = base_delay * (1.0 - self._jitter_ratio * fraction)
        self._current_seconds = min(
            self._maximum_seconds,
            base_delay * self._multiplier,
        )
        return delay


def idle_poll_backoff_from_env(
    initial_name: str,
    maximum_name: str,
    *,
    default_initial: float,
    default_maximum: float = 10.0,
    environ: Mapping[str, str] | None = None,
) -> IdlePollBackoff:
    """Build the canonical queue backoff from bounded environment values."""

    environ = os.environ if environ is None else environ

    def bounded(name: str, default: float, minimum: float, maximum: float) -> float:
        try:
            value = float(environ.get(name, str(default)))
        except (TypeError, ValueError):
            value = default
        if not math.isfinite(value):
            value = default
        return min(maximum, max(minimum, value))

    initial_seconds = bounded(initial_name, default_initial, 0.1, 30.0)
    maximum_seconds = max(
        initial_seconds,
        bounded(maximum_name, default_maximum, 0.1, 30.0),
    )
    return IdlePollBackoff(
        initial_seconds,
        maximum_seconds,
        jitter_ratio=bounded(
            "WORKER_IDLE_POLL_JITTER_RATIO",
            0.1,
            0.0,
            0.5,
        ),
    )
