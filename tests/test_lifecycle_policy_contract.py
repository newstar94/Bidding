import json
import subprocess
from pathlib import Path

from backend.shared.lifecycle_policy import lifecycle_contract
from backend.sync.payload_validation import get_package_field_policy


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_frontend_runtime_status_projection_matches_backend_source():
    contract = lifecycle_contract()
    inputs = [*contract["statuses"], *contract["aliases"]]
    command = (
        "import { normalizeStatus, presentStatus } "
        "from './frontend/packages/LifecyclePolicy.js';"
        f"const inputs = {json.dumps(inputs, ensure_ascii=False)};"
        "console.log(JSON.stringify({"
        "normalized: Object.fromEntries(inputs.map((value) => [value, normalizeStatus(value)])),"
        "presented: Object.fromEntries(Object.keys("
        f"{json.dumps(contract['statuses'], ensure_ascii=False)}"
        ").map((value) => [value, presentStatus(value)]))"
        "}));"
    )
    completed = subprocess.run(
        ["node", "--input-type=module", "-e", command],
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )

    frontend = json.loads(completed.stdout)
    assert frontend["normalized"] == {
        value: value if value in contract["statuses"] else contract["aliases"][value]
        for value in inputs
    }
    assert frontend["presented"] == contract["statuses"]


def test_authoritative_package_field_policy_keeps_scheduling_fields_locked():
    policy = get_package_field_policy()

    assert policy["statusOrder"] == [
        "Chưa xác định",
        "Chuẩn bị",
        "Đang mời thầu",
        "Đã mở thầu",
        "Đang chấm thầu",
        "Đã có kết quả một phần",
        "Đã có kết quả",
        "Hủy thầu",
    ]
    assert {
        "thoiGianThucHien",
        "thoiGianToChuc",
        "thoiGianBatDauToChuc",
    }.issubset(policy["lockedAfterInvitation"])
