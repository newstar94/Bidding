import sqlite3

from backend.shared import media_helper


def _database_with_media_tables():
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE nha_thau (id TEXT PRIMARY KEY, anh_dau TEXT)")
    conn.execute(
        "CREATE TABLE chuyen_gia ("
        "id TEXT PRIMARY KEY, anh_chung_chi TEXT, anh_chu_ky TEXT)"
    )
    return conn


def test_cleanup_keeps_an_image_referenced_by_an_older_version(tmp_path, monkeypatch):
    monkeypatch.setattr(media_helper, "IMAGE_DIR", tmp_path)
    image_path = "images/nha_thau/nt-root-v00_stamp.png"
    physical_path = tmp_path / "nha_thau" / "nt-root-v00_stamp.png"
    physical_path.parent.mkdir(parents=True)
    physical_path.write_bytes(b"old-version")

    conn = _database_with_media_tables()
    conn.execute(
        "INSERT INTO nha_thau (id, anh_dau) VALUES (?, ?)",
        ("nt-version-00", image_path),
    )

    removed = media_helper.remove_unreferenced_image_files(conn.cursor(), [image_path])

    assert removed == []
    assert physical_path.exists()
    conn.close()


def test_cleanup_removes_replaced_unreferenced_image_and_optimized_copy(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(media_helper, "IMAGE_DIR", tmp_path)
    old_image = "images/chuyen_gia/cg-version-00_sig.png"
    original = tmp_path / "chuyen_gia" / "cg-version-00_sig.png"
    optimized = tmp_path / "chuyen_gia" / "cg-version-00_sig_opt_300.jpg"
    original.parent.mkdir(parents=True)
    original.write_bytes(b"old")
    optimized.write_bytes(b"optimized-old")

    conn = _database_with_media_tables()
    conn.execute(
        "INSERT INTO chuyen_gia (id, anh_chu_ky) VALUES (?, ?)",
        ("cg-version-00", "images/chuyen_gia/cg-version-00_sig.jpg"),
    )

    removed = media_helper.remove_unreferenced_image_files(conn.cursor(), [old_image])

    assert set(removed) == {str(original), str(optimized)}
    assert not original.exists()
    assert not optimized.exists()
    conn.close()
