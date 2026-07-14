"""Canonical filesystem locations for runtime data.

Development keeps backwards-compatible paths below the project directory.
Production startup validation requires explicit absolute paths so mutable data
can be mounted independently from source code and from the SQLite volume.
"""

import os
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("BIDDING_DATA_DIR") or PROJECT_ROOT / "data").resolve()
LOG_DIR = Path(os.environ.get("BIDDING_LOG_DIR") or DATA_DIR / "logs").resolve()
TEMPLATE_DATA_DIR = Path(
    os.environ.get("BIDDING_TEMPLATE_DATA_DIR") or DATA_DIR / "templates"
).resolve()
IMAGE_DIR = Path(os.environ.get("BIDDING_UPLOAD_DIR") or TEMPLATE_DATA_DIR / "images").resolve()
WORD_TEMPLATE_DIR = Path(
    os.environ.get("BIDDING_WORD_TEMPLATE_DIR") or TEMPLATE_DATA_DIR / "words"
).resolve()
