"""Immutable Word-template catalog with legacy compatibility projections."""

from .service import (
    CatalogConflictError,
    CatalogError,
    CatalogNotFoundError,
    WordTemplateCatalog,
)

__all__ = [
    "CatalogConflictError",
    "CatalogError",
    "CatalogNotFoundError",
    "WordTemplateCatalog",
]
