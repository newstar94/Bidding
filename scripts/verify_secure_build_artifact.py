"""Verify the secure frontend artifact immediately after a CI restore."""

from __future__ import annotations

import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from backend.frontend_assets import (  # noqa: E402
    FrontendAssetError,
    assert_production_frontend_ready,
)


def verify_secure_build_artifact(project_root: Path = PROJECT_ROOT) -> None:
    """Reject an incomplete/corrupt restored artifact before a dependent gate."""

    assert_production_frontend_ready(project_root)


def main() -> int:
    try:
        verify_secure_build_artifact()
    except FrontendAssetError as error:
        print(f"Secure build artifact verification failed: {error}", file=sys.stderr)
        return 1
    print("Secure build artifact verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
