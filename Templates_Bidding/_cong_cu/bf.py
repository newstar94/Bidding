"""Live BiddingFlow pieces shared by the template tools.

The tools live inside the BiddingFlow repository, so they import the real
DOCX pipeline, template policy and variable catalog instead of keeping copies
that drift whenever the backend changes.
"""
import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from backend.documents import template_security  # noqa: E402
from backend.documents.custom_exporter import (  # noqa: E402
    enrich_context_with_lowercase_keys,
    enrich_context_with_words,
    format_context_dates,
    format_context_money_values,
    replace_placeholders_with_empty,
    translate_xml_tags,
)
from backend.documents.docx_column_loop import COLUMN_LITERAL_CONTEXT  # noqa: E402
from scripts.generate_word_variable_manifest import (  # noqa: E402
    build_frontend_defaults as word_variables,
    build_frontend_field_metadata as field_metadata,
)

__all__ = [
    "COLUMN_LITERAL_CONTEXT",
    "enrich_context_with_lowercase_keys",
    "enrich_context_with_words",
    "field_metadata",
    "format_context_dates",
    "format_context_money_values",
    "replace_placeholders_with_empty",
    "template_security",
    "translate_xml_tags",
    "word_variables",
]
