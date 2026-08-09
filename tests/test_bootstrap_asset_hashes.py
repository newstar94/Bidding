import hashlib
from pathlib import Path

from scripts.generate_bootstrap_asset_urls import (
    BOOTSTRAP_ASSETS,
    render_index_with_bootstrap_hashes,
)


def test_bootstrap_asset_urls_match_their_file_contents():
    index_path = Path("views/index.html")
    source = index_path.read_text(encoding="utf-8")

    assert render_index_with_bootstrap_hashes(source) == source
    for public_url, relative_path in BOOTSTRAP_ASSETS:
        canonical_bytes = (
            Path(relative_path)
            .read_bytes()
            .replace(b"\r\n", b"\n")
            .replace(b"\r", b"\n")
        )
        digest = hashlib.sha256(canonical_bytes).hexdigest()
        assert f'src="{public_url}?v={digest}"' in source
