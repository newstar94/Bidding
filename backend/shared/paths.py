"""Canonical filesystem locations for runtime data."""

from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data"
TEMPLATE_DATA_DIR = DATA_DIR / "templates"
IMAGE_DIR = TEMPLATE_DATA_DIR / "images"
WORD_TEMPLATE_DIR = TEMPLATE_DATA_DIR / "words"
