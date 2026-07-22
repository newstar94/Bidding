import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_package_assignment_policy_behavior():
    subprocess.run(
        ["node", "--test", "tests/js/package_assignment_policy.test.mjs"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


def test_package_workflow_applies_creator_fallback_to_every_create_branch():
    source = (ROOT / "frontend" / "packages" / "GoiThauWorkflow.js").read_text(
        encoding="utf-8"
    )

    assert "ensureCurrentUserAssignee(this.model.state.employees, currentUserCandidate)" in source
    assert "const assignedEmpId = resolvePackageAssigneeId(" in source
    assert source.count("empId: assignedEmpId") == 3
    assert 'const assignedEmpId = document.getElementById("gt-nhanvienphutrach").value' not in source


def test_package_form_initial_assignment_has_no_personal_workspace_exception():
    source = (ROOT / "frontend" / "packages" / "GoiThauWorkflow.js").read_text(
        encoding="utf-8"
    )
    restore_block = source[
        source.index("const restoreEmpValue = () => {"):
        source.index("const _populateEmpDropdown = () => {")
    ]

    assert "derivePackageAssigneeControlState" in restore_block
    assert "isActivePersonalWorkspace" not in restore_block


def test_package_form_resets_before_loading_and_selecting_assignee_options():
    source = (ROOT / "frontend" / "packages" / "GoiThauWorkflow.js").read_text(
        encoding="utf-8"
    )

    create_branch = source[
        source.index("  } else {\n    captureModalReturnState"):
        source.index("    if (this.updatePhuongPhapDanhGiaOptions)", source.index("form.reset();"))
    ]

    assert create_branch.index("form.reset();") < create_branch.index(
        "loadAndPopulateEmpDropdown();"
    )


def test_existing_package_also_loads_and_restores_saved_assignee():
    source = (ROOT / "frontend" / "packages" / "GoiThauWorkflow.js").read_text(
        encoding="utf-8"
    )
    edit_branch = source[
        source.index("  if (id) {"):
        source.index("  } else {\n    captureModalReturnState")
    ]

    assert "loadAndPopulateEmpDropdown();" in edit_branch
