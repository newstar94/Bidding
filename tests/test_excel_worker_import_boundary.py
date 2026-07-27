from __future__ import annotations

import subprocess
import sys


def test_pure_excel_worker_export_does_not_load_database_service() -> None:
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import sys; "
                "from backend.documents.document_worker_entry import _run_operation; "
                "output = _run_operation('export_excel', {"
                "'function': 'create_phanlo_excel', "
                "'args': [[{'maPhanLo': 'L1', 'tenPhanLo': 'Lô 1'}]]}); "
                "assert output.startswith(b'PK\\x03\\x04'); "
                "assert 'backend.documents.excel_service' not in sys.modules; "
                "assert 'backend.shared.helpers' not in sys.modules"
            ),
        ],
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        text=True,
        timeout=20,
        check=False,
    )

    assert result.returncode == 0, result.stderr
