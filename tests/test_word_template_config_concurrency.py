import json
import multiprocessing
from pathlib import Path

import pytest

from backend.documents import custom_exporter


def _attempt_assignment_cas(template_root, start_event, result_queue, filename):
    from backend.documents import custom_exporter as worker_exporter

    worker_exporter.TEMPLATE_DIR = template_root
    start_event.wait(timeout=10)
    try:
        worker_exporter.set_template_assignments(
            {"procurement_plan": [filename]},
            "org-a",
            owner_type="organization",
            expected_revision=0,
        )
    except worker_exporter.WordTemplateConfigConflictError as error:
        result_queue.put(("conflict", error.current_revision))
    else:
        result_queue.put(("saved", filename))


@pytest.fixture
def template_root(tmp_path, monkeypatch):
    monkeypatch.setattr(custom_exporter, "TEMPLATE_DIR", str(tmp_path))
    return tmp_path


def test_two_processes_cannot_commit_the_same_word_config_revision(template_root):
    process_context = multiprocessing.get_context("spawn")
    start_event = process_context.Event()
    result_queue = process_context.Queue()
    processes = [
        process_context.Process(
            target=_attempt_assignment_cas,
            args=(str(template_root), start_event, result_queue, filename),
        )
        for filename in ("first.docx", "second.docx")
    ]
    for process in processes:
        process.start()
    start_event.set()
    results = [result_queue.get(timeout=15) for _process in processes]
    for process in processes:
        process.join(timeout=15)
        assert process.exitcode == 0

    assert sorted(result[0] for result in results) == ["conflict", "saved"]
    assert custom_exporter.get_template_config_revision(
        "org-a", owner_type="organization"
    ) == 1
    assignments = custom_exporter.get_template_assignments(
        "org-a", owner_type="organization"
    )
    assert assignments in (
        {"procurement_plan": ["first.docx"]},
        {"procurement_plan": ["second.docx"]},
    )


def test_corrupt_word_config_is_preserved_and_blocks_mutation(template_root):
    scope = Path(custom_exporter.get_scope_template_dir("organization", "org-a"))
    config_path = scope / "config.json"
    corrupt_content = b'{"revision": 4, "template_assignments": '
    config_path.write_bytes(corrupt_content)

    with pytest.raises(
        custom_exporter.WordTemplateConfigCorruptError,
        match="bị hỏng",
    ):
        custom_exporter.set_template_assignments(
            {"procurement_plan": ["replacement.docx"]},
            "org-a",
            owner_type="organization",
            expected_revision=4,
        )

    assert config_path.read_bytes() == corrupt_content
    assert not list(scope.glob("config.json.*.tmp"))


def test_legacy_word_config_gets_a_revision_on_first_mutation(template_root):
    scope = Path(custom_exporter.get_scope_template_dir("organization", "org-a"))
    config_path = scope / "config.json"
    config_path.write_text(
        json.dumps({"active_template": "legacy.docx"}),
        encoding="utf-8",
    )

    custom_exporter.set_template_enabled(
        "legacy.docx",
        True,
        "org-a",
        owner_type="organization",
        expected_revision=0,
    )

    assert json.loads(config_path.read_text(encoding="utf-8"))["revision"] == 1
