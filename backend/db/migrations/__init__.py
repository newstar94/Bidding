"""Ordered database migrations. Never edit an applied migration; add the next version."""

from . import m0001_clean_baseline


MIGRATIONS = (m0001_clean_baseline,)
