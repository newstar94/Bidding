import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_package_timeline_automatic_source_behavior():
    subprocess.run(
        ["node", "--test", "tests/js/package_timeline_rows.test.mjs"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
