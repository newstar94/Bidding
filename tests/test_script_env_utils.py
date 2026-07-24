from scripts.env_utils import load_env


def test_load_env_handles_bom_quotes_comments_and_preserves_process_values(
    tmp_path,
    monkeypatch,
) -> None:
    (tmp_path / ".env").write_text(
        "\ufeff# comment\nFROM_FILE='value'\nKEEP=file\nINVALID\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("KEEP", "process")

    load_env(tmp_path)

    assert __import__("os").environ["FROM_FILE"] == "value"
    assert __import__("os").environ["KEEP"] == "process"
