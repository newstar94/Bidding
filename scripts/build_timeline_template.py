"""Rebuild the system-owned package timeline DOCX template."""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.documents.timeline_document_service import create_timeline_template
from backend.shared.paths import WORD_TEMPLATE_DIR


if __name__ == "__main__":
    output = Path(WORD_TEMPLATE_DIR) / "mau_timeline_goi_thau.docx"
    create_timeline_template(output)
    print(output)
