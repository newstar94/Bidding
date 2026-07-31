import base64
import io
import os
import time

from PIL import Image

from backend.shared import media_helper


def _image_data_url():
    output = io.BytesIO()
    Image.new("RGB", (8, 8), "blue").save(output, format="PNG")
    return "data:image/png;base64," + base64.b64encode(output.getvalue()).decode()


class Connection:
    def __init__(self):
        self.calls = []
        self.commits = 0

    def execute(self, statement, params=()):
        self.calls.append((" ".join(statement.split()), tuple(params)))
        return self

    def commit(self):
        self.commits += 1


def test_asset_is_staged_then_promoted_after_business_commit(tmp_path, monkeypatch):
    monkeypatch.setattr(media_helper, "IMAGE_DIR", str(tmp_path))
    asset = media_helper.stage_base64_image(
        _image_data_url(),
        "chuyen_gia",
        "expert-1_sig",
        tenant_id="org-a",
        client_mutation_id="mutation-1",
    )

    staged_file = media_helper._staging_file(asset["staging_path"])
    final_file = media_helper._managed_image_file(asset["managed_path"])
    assert os.path.isfile(staged_file)
    assert not os.path.exists(final_file)

    connection = Connection()
    assert media_helper.promote_staged_assets(connection, [asset]) == [asset["managed_path"]]

    assert not os.path.exists(staged_file)
    assert os.path.isfile(final_file)
    assert connection.commits == 1
    assert any("status = 'promoted'" in statement for statement, _ in connection.calls)


def test_asset_rollback_discards_staging_without_touching_final(tmp_path, monkeypatch):
    monkeypatch.setattr(media_helper, "IMAGE_DIR", str(tmp_path))
    asset = media_helper.stage_base64_image(
        _image_data_url(),
        "nha_thau",
        "contractor-1_stamp",
        tenant_id="org-a",
        client_mutation_id="mutation-rollback",
    )
    staged_file = media_helper._staging_file(asset["staging_path"])

    media_helper.discard_staged_assets([asset])

    assert not os.path.exists(staged_file)
    assert not os.path.exists(media_helper._managed_image_file(asset["managed_path"]))


def test_rowless_staging_is_swept_after_grace_period(tmp_path, monkeypatch):
    monkeypatch.setattr(media_helper, "IMAGE_DIR", str(tmp_path))
    asset = media_helper.stage_base64_image(
        _image_data_url(),
        "nha_thau",
        "orphan_stamp",
        tenant_id="org-a",
        client_mutation_id="mutation-orphan",
    )
    staged_file = media_helper._staging_file(asset["staging_path"])
    old = time.time() - 1_000
    os.utime(staged_file, (old, old))

    class RowsConnection:
        def execute(self, _statement):
            return self

        def fetchall(self):
            return []

        def close(self):
            pass

    class Database:
        def get_connection(self):
            return RowsConnection()

    assert media_helper.sweep_orphaned_staged_assets(
        Database(), grace_seconds=300
    ) == 1
    assert not os.path.exists(staged_file)
