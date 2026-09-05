"""Shared environment-file loading for repository scripts."""

from __future__ import annotations

import os
from pathlib import Path


def load_env(project_root: Path) -> None:
    path = Path(project_root) / ".env"
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(
            key.strip(),
            value.strip().strip('"').strip("'"),
        )
    from backend.shared.database_profile import load_profile
    load_profile(project_root)
