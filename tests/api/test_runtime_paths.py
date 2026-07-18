from pathlib import Path

from backend.shared.paths import SYSTEM_WORD_TEMPLATE_NAMES, provision_system_word_templates


def test_provision_system_word_templates_copies_all_bundled_templates(tmp_path):
    source = tmp_path / "source"
    target = tmp_path / "runtime"
    source.mkdir()
    for index, filename in enumerate(SYSTEM_WORD_TEMPLATE_NAMES):
        (source / filename).write_bytes(f"template-{index}".encode())

    copied = provision_system_word_templates(source, target)

    assert {path.name for path in copied} == set(SYSTEM_WORD_TEMPLATE_NAMES)
    for index, filename in enumerate(SYSTEM_WORD_TEMPLATE_NAMES):
        assert (target / filename).read_bytes() == f"template-{index}".encode()


def test_provision_system_word_templates_does_not_overwrite_existing_file(tmp_path):
    source = tmp_path / "source"
    target = tmp_path / "runtime"
    source.mkdir()
    target.mkdir()
    for filename in SYSTEM_WORD_TEMPLATE_NAMES:
        (source / filename).write_bytes(b"bundled")
    existing = target / SYSTEM_WORD_TEMPLATE_NAMES[0]
    existing.write_bytes(b"operator-managed")

    copied = provision_system_word_templates(source, target)

    assert existing.read_bytes() == b"operator-managed"
    assert existing not in copied


def test_provision_system_word_templates_fails_when_bundle_is_incomplete(tmp_path):
    source = tmp_path / "source"
    source.mkdir()

    try:
        provision_system_word_templates(source, tmp_path / "runtime")
    except FileNotFoundError as exc:
        assert Path(SYSTEM_WORD_TEMPLATE_NAMES[0]).name in str(exc)
    else:
        raise AssertionError("Expected an incomplete bundled template set to fail fast")
