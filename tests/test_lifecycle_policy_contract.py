import json
import subprocess
from pathlib import Path

from backend.shared.lifecycle_policy import lifecycle_contract


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_frontend_lifecycle_contract_matches_backend_source():
    command = (
        "import { lifecycleContract } from './frontend/packages/LifecyclePolicy.js';"
        "console.log(JSON.stringify(lifecycleContract()));"
    )
    completed = subprocess.run(
        ["node", "--input-type=module", "-e", command],
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )

    assert json.loads(completed.stdout) == lifecycle_contract()
