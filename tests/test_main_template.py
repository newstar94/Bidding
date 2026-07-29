from pathlib import Path
import re


INDEX_TEMPLATE = Path(__file__).resolve().parents[1] / "views" / "index.html"


def test_main_template_has_standard_author_metadata():
    html = INDEX_TEMPLATE.read_text(encoding="utf-8")

    assert '<meta name="author" content="Vy Tuấn Dương">' in html
    assert not re.search(r'<meta\s+name="Vy Tuấn Dương"', html)
