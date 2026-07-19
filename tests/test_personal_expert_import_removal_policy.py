from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_personal_expert_import_feature_is_not_exposed():
    expert_tab = (ROOT / "views" / "tabs" / "tab_chuyengia.html").read_text(encoding="utf-8")
    form_controller = (ROOT / "frontend" / "app" / "BiddingControllerForms.js").read_text(encoding="utf-8")
    app_source = (ROOT / "backend" / "app.py").read_text(encoding="utf-8")

    for source in (expert_tab, form_controller, app_source):
        assert "btn-import-personal-chuyengia" not in source
        assert "/api/personal-import/experts" not in source

    assert "Nhập từ cá nhân" not in expert_tab
    assert not (ROOT / "backend" / "api" / "personal_import_routes.py").exists()
