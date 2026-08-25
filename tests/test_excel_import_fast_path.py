import subprocess
import sys
from io import BytesIO

from openpyxl import Workbook

from backend.documents.excel_handler import parse_excel
from backend.documents.document_worker import run_document_job


def _workbook_bytes(rows):
    workbook = Workbook()
    sheet = workbook.active
    for row in rows:
        sheet.append(row)
    stream = BytesIO()
    workbook.save(stream)
    workbook.close()
    return stream.getvalue()


def test_xlsx_parser_module_does_not_eagerly_import_pandas():
    completed = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import sys; "
                "import backend.documents.excel_handler; "
                "raise SystemExit(1 if 'pandas' in sys.modules else 0)"
            ),
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert completed.returncode == 0, completed.stderr


def test_xlsx_expert_import_preserves_horizontal_contract():
    content = _workbook_bytes([
        ["Họ tên", "Số CCCD", "Số chứng chỉ"],
        ["Dòng kiểm thử A", "012345678901", "CC-001"],
    ])

    assert parse_excel(content, "chuyengia", kind="xlsx") == [{
        "rowIdx": 2,
        "data": {
            "hoTen": "Dòng kiểm thử A",
            "soCCCD": "012345678901",
            "ngayCapCCCD": "",
            "noiCapCCCD": "",
            "soChungChi": "CC-001",
            "ngayCapChungChi": "",
            "donViCapChungChi": "",
            "anhChungChi": "",
        },
        "isValid": True,
        "comments": "",
    }]


def test_xlsx_expert_import_preserves_vertical_contract():
    content = _workbook_bytes([
        ["Họ tên", "Dòng kiểm thử A", "Dòng kiểm thử B"],
        ["Số CCCD", "012345678901", "123456789012"],
        ["Số chứng chỉ", "CC-001", "CC-002"],
    ])

    rows = parse_excel(content, "chuyengia", kind="xlsx")

    assert [row["rowIdx"] for row in rows] == [1, 2]
    assert [row["data"]["hoTen"] for row in rows] == [
        "Dòng kiểm thử A",
        "Dòng kiểm thử B",
    ]
    assert all(row["isValid"] for row in rows)


def test_isolated_xlsx_worker_preserves_expert_rows(tmp_path):
    content = _workbook_bytes([
        ["Họ tên", "Số CCCD", "Số chứng chỉ"],
        ["Dòng kiểm thử", "123456789012", "CC-WORKER"],
    ])
    workbook_path = tmp_path / "experts.xlsx"
    workbook_path.write_bytes(content)

    rows = run_document_job(
        "parse_excel",
        {
            "content_path": str(workbook_path),
            "kind": "xlsx",
            "import_type": "chuyengia",
        },
        timeout_seconds=10,
    )

    assert len(rows) == 1
    assert rows[0]["isValid"] is True
    assert rows[0]["data"]["hoTen"] == "Dòng kiểm thử"
