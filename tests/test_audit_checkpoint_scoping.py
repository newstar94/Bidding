import json

import pytest

from backend.shared.audit_monitor import (
    _installation_checkpoint_destination,
    _latest_checkpoint,
)


def _write_checkpoint(directory, filename, installation_id):
    directory.mkdir(parents=True, exist_ok=True)
    payload = {
        "format": "biddingflow-audit-checkpoint",
        "version": 3,
        "installationId": installation_id,
    }
    (directory / filename).write_text(
        json.dumps(payload),
        encoding="utf-8",
    )
    return payload


def test_checkpoint_selection_is_scoped_to_database_installation(tmp_path):
    destination = tmp_path / "audit-checkpoints"
    old = _write_checkpoint(
        destination,
        "audit-checkpoint-99999999T999999999999Z-old.json",
        "old-installation",
    )
    current = _write_checkpoint(
        destination / "current-installation",
        "audit-checkpoint-20260719T120000000000Z-current.json",
        "current-installation",
    )

    assert _latest_checkpoint(destination, "current-installation") == current
    assert _latest_checkpoint(destination, "old-installation") == old
    assert _latest_checkpoint(destination, "unknown-installation") is None


def test_legacy_root_checkpoint_for_current_installation_remains_compatible(tmp_path):
    destination = tmp_path / "audit-checkpoints"
    current = _write_checkpoint(
        destination,
        "audit-checkpoint-20260719T120000000000Z-current.json",
        "current-installation",
    )

    assert _latest_checkpoint(destination, "current-installation") == current


@pytest.mark.parametrize("installation_id", ["", "../escape", "nested/path"])
def test_checkpoint_installation_directory_cannot_escape_data_root(
    tmp_path, installation_id
):
    with pytest.raises(RuntimeError):
        _installation_checkpoint_destination(
            tmp_path / "audit-checkpoints",
            installation_id,
        )
