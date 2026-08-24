"""Deterministic OOXML audit and safe-fix module for Word templates."""

from .engine import (
    ENGINE_VERSION,
    SUPPORTED_MODES,
    SUPPORTED_PROFILES,
    WordStandardizationError,
    WordStandardizationResult,
    process_docx,
)
from .automatic import (
    AUTOMATIC_MODES,
    AUTOMATIC_POLICY_ID,
    AUTOMATIC_POLICY_VERSION,
    AutomaticWordStandardizationResult,
    automatic_standardization_mode,
    standardize_template_for_export,
)

__all__ = [
    "ENGINE_VERSION",
    "AUTOMATIC_MODES",
    "AUTOMATIC_POLICY_ID",
    "AUTOMATIC_POLICY_VERSION",
    "AutomaticWordStandardizationResult",
    "SUPPORTED_MODES",
    "SUPPORTED_PROFILES",
    "WordStandardizationError",
    "WordStandardizationResult",
    "automatic_standardization_mode",
    "process_docx",
    "standardize_template_for_export",
]
