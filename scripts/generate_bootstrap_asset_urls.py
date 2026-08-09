"""Bind direct bootstrap script URLs to their exact SHA-256 content."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
INDEX_PATH = ROOT / "views" / "index.html"
BOOTSTRAP_ASSETS = (
    ("/vendor/route-shell.js", "views/vendor/route-shell.js"),
    ("/vendor/initial-route.js", "views/vendor/initial-route.js"),
    ("/vendor/lucide/lucide-shim.js", "views/vendor/lucide/lucide-shim.js"),
)


def _canonical_asset_bytes(path):
    return path.read_bytes().replace(b"\r\n", b"\n").replace(b"\r", b"\n")


def render_index_with_bootstrap_hashes(source):
    rendered = source
    for public_url, relative_path in BOOTSTRAP_ASSETS:
        digest = hashlib.sha256(
            _canonical_asset_bytes(ROOT / relative_path)
        ).hexdigest()
        pattern = rf'src="{re.escape(public_url)}(?:\?v=[^"]*)?"'
        rendered, replacements = re.subn(
            pattern,
            f'src="{public_url}?v={digest}"',
            rendered,
        )
        if replacements != 1:
            raise RuntimeError(
                f"Expected exactly one bootstrap reference for {public_url}; "
                f"found {replacements}."
            )
    return rendered


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Generate content-hashed direct bootstrap script URLs.",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail when a committed bootstrap URL does not match its file content",
    )
    args = parser.parse_args(argv)
    source = INDEX_PATH.read_text(encoding="utf-8")
    rendered = render_index_with_bootstrap_hashes(source)
    if args.check:
        if rendered != source:
            print(
                "Bootstrap asset hashes are stale; run "
                "`python scripts/generate_bootstrap_asset_urls.py`.",
                file=sys.stderr,
            )
            return 1
        return 0
    INDEX_PATH.write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
