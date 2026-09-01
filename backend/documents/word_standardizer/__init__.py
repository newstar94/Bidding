"""Deterministic OOXML audit and safe-fix module for Word templates."""

from .engine import (
    ENGINE_VERSION,
    SUPPORTED_MODES,
    SUPPORTED_PROFILES,
    WordStandardizationError,
    WordStandardizationResult,
    process_docx,
    standardization_rule_set_sha256,
)
__all__ = [
    "ENGINE_VERSION",
    "SUPPORTED_MODES",
    "SUPPORTED_PROFILES",
    "WordStandardizationError",
    "WordStandardizationResult",
    "process_docx",
    "standardization_rule_set_sha256",
]
