from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_excel_preview_uses_csp_safe_semantic_classes():
    source = (ROOT / "frontend" / "packages" / "GoiThauModals.js").read_text(encoding="utf-8")
    preview_source = source.split("export function populatePhathanhHsmtForm", 1)[0]

    assert "<style>" not in preview_source
    assert 'class="excel-preview-cell' in preview_source
    assert "excel-preview-input--numeric" in preview_source
    assert "excel-preview-input--emphasized" in preview_source
    assert 'aria-invalid="${errorText ? "true" : "false"}"' in preview_source
    assert "aria-describedby" in preview_source


def test_excel_preview_styles_cover_interaction_and_validation_states():
    stylesheet = (ROOT / "views" / "css" / "views.css").read_text(encoding="utf-8")

    assert "#modal-excel-preview .excel-preview-input {" in stylesheet
    assert "#modal-excel-preview .excel-preview-input:focus-visible" in stylesheet
    assert '#modal-excel-preview .excel-preview-input[aria-invalid="true"]' in stylesheet
    assert "#modal-excel-preview .excel-preview-input:disabled" in stylesheet
    assert "var(--focus-ring)" in stylesheet
    assert "var(--danger-soft)" in stylesheet
    assert "box-shadow: 0 0 0 2px var(--focus-ring);" in stylesheet
    assert "box-shadow: 0 0 0 3px var(--focus-ring);" not in stylesheet[
        stylesheet.index("#modal-excel-preview .excel-preview-input {"):
        stylesheet.index("#modal-excel-preview .excel-preview-feedback")
    ]


def test_excel_preview_stylesheet_cache_version_is_current():
    index = (ROOT / "views" / "index.html").read_text(encoding="utf-8")

    assert '/css/views.css?v=1.3.4' in index
    assert index.count('/frontend/app/app.js?v=1.3.4') == 2
