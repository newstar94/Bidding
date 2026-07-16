"""Ordered database migrations. Never edit an applied migration; add the next version."""

from . import m0001_clean_baseline, m0002_record_edit_ownership


MIGRATIONS = (m0001_clean_baseline, m0002_record_edit_ownership)
