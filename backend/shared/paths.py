"""Canonical filesystem locations for runtime data.

Development keeps backwards-compatible paths below the project directory.
Production startup validation requires explicit absolute paths so mutable data
can be mounted independently from source code and from the SQLite volume.
"""

import os
import shutil
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

SYSTEM_WORD_TEMPLATE_DIR = (PROJECT_ROOT / "data" / "templates" / "words").resolve()
SYSTEM_WORD_TEMPLATE_NAMES = (
    "mau_bao_cao_dau_thau.docx",
    "mau_hop_dong_lcnt.docx",
    "mau_timeline_goi_thau.docx",
)


def provision_system_word_templates(source_dir=None, target_dir=None):
    """Copy missing bundled Word templates into the mutable runtime directory.

    Existing runtime templates are preserved so an application upgrade cannot
    overwrite an operator-managed or customized file.
    """
    source = Path(source_dir or SYSTEM_WORD_TEMPLATE_DIR).resolve()
    target = Path(target_dir or WORD_TEMPLATE_DIR).resolve()
    target.mkdir(parents=True, exist_ok=True)

    copied = []
    for filename in SYSTEM_WORD_TEMPLATE_NAMES:
        source_path = source / filename
        destination_path = target / filename
        if destination_path.exists():
            continue
        if not source_path.is_file():
            raise FileNotFoundError(f"Bundled Word template is missing: {source_path}")
        shutil.copyfile(source_path, destination_path)
        copied.append(destination_path)
    return copied
