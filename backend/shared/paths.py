"""Canonical filesystem locations for runtime data."""

import os
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data"
LOG_DIR = Path(os.environ.get("BIDDING_LOG_DIR") or DATA_DIR / "logs").resolve()
TEMPLATE_DATA_DIR = DATA_DIR / "templates"
IMAGE_DIR = TEMPLATE_DATA_DIR / "images"
WORD_TEMPLATE_DIR = TEMPLATE_DATA_DIR / "words"
