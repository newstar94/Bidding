"""Canonical filesystem locations for runtime data.

Development keeps backwards-compatible paths below the project directory.
Production startup validation requires explicit absolute paths so mutable data
can be mounted independently from source code and from the PostgreSQL volume.
"""

import os
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("BIDDING_DATA_DIR") or PROJECT_ROOT / "data").resolve()

_RUNTIME_PATH_DEFAULTS = {
    "AUDIT_CHECKPOINT_DIR": Path("audit-checkpoints"),
    "BIDDING_BACKUP_DIR": Path("backups"),
    "BIDDING_LOG_DIR": Path("logs"),
    "BIDDING_UPLOAD_DIR": Path("templates") / "images",
    "BIDDING_WORD_TEMPLATE_DIR": Path("templates") / "words",
    "DOCUMENT_WORKER_TEMP_DIR": Path("document-worker-temp"),
}


def resolve_runtime_path(name, *, environ=None, allow_empty=False):
    """Resolve an optional runtime override below the configured data root."""

    if name not in _RUNTIME_PATH_DEFAULTS:
        raise KeyError(f"Unknown runtime path: {name}")
    environment = os.environ if environ is None else environ
    configured = environment.get(name)
    if configured is not None:
        configured = str(configured).strip()
        if configured:
            return Path(configured).resolve()
        if allow_empty:
            return None
    data_root = Path(
        environment.get("BIDDING_DATA_DIR") or PROJECT_ROOT / "data"
    ).resolve()
    return (data_root / _RUNTIME_PATH_DEFAULTS[name]).resolve()


LOG_DIR = resolve_runtime_path("BIDDING_LOG_DIR")
IMAGE_DIR = resolve_runtime_path("BIDDING_UPLOAD_DIR")
WORD_TEMPLATE_DIR = resolve_runtime_path("BIDDING_WORD_TEMPLATE_DIR")
