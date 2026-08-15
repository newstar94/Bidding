from pathlib import Path

from PIL import Image


ASSET_ROOT = Path("views/assets")


def test_public_brand_assets_are_bounded_and_keep_transparent_corners():
    expected = {
        "favicon.png": ((192, 192), 50_000),
        "app-brand-icon.webp": ((96, 96), 15_000),
    }
    for name, (expected_size, byte_budget) in expected.items():
        path = ASSET_ROOT / name
        assert path.stat().st_size <= byte_budget
        with Image.open(path) as image:
            assert image.size == expected_size
            alpha = image.convert("RGBA").getchannel("A")
            corners = (
                alpha.getpixel((0, 0)),
                alpha.getpixel((image.width - 1, 0)),
                alpha.getpixel((0, image.height - 1)),
                alpha.getpixel((image.width - 1, image.height - 1)),
            )
            assert corners == (0, 0, 0, 0)
