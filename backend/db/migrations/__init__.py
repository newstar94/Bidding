"""Ordered database migrations. Never edit an applied migration; add the next version."""

from . import (
    m0001_clean_baseline,
    m0002_record_edit_ownership,
    m0003_package_timeline,
    m0004_pending_email_changes,
    m0005_selective_fts_updates,
    m0006_document_export_capabilities,
    m0007_audit_chain_single_successor,
    m0008_package_pagination_index,
)


MIGRATIONS = (
    m0001_clean_baseline,
    m0002_record_edit_ownership,
    m0003_package_timeline,
    m0004_pending_email_changes,
    m0005_selective_fts_updates,
    m0006_document_export_capabilities,
    m0007_audit_chain_single_successor,
    m0008_package_pagination_index,
)
