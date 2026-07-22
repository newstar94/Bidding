import subprocess


def test_package_workflow_regressions_node_suite():
    subprocess.run(
        [
            "node",
            "--test",
            "tests/js/evaluation_clarification_controls.test.mjs",
            "tests/js/package_workflow_regressions.test.mjs",
            "tests/js/lot_evaluation_scope.test.mjs",
            "tests/js/scoped_award_result_merge.test.mjs",
        ],
        check=True,
    )
