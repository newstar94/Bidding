import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_hsmt_release_submit_behavior():
    subprocess.run(
        ["node", "--test", "tests/js/hsmt_release_workflow.test.mjs"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


def test_hsmt_modal_keeps_required_fields_inside_a_scrollable_body():
    stylesheet = (ROOT / "views" / "css" / "components.css").read_text(
        encoding="utf-8"
    )

    assert "#modal-phathanh-hsmt .modal-card," not in stylesheet
    assert "#modal-phathanh-hsmt .modal-card > form," not in stylesheet
    assert "#modal-phathanh-hsmt .modal-body {\n  overflow: visible !important;" not in stylesheet


def test_hsmt_modal_uses_shared_wide_width_without_fixed_height():
    template = (ROOT / "views" / "modals" / "modal_phathanh_hsmt.html").read_text(
        encoding="utf-8"
    )
    stylesheet = (ROOT / "views" / "css" / "ui-redesign.css").read_text(
        encoding="utf-8"
    )
    card_markup = template[template.index('<div class="modal-card'):]
    card_markup = card_markup[:card_markup.index(">")]
    width_rule = stylesheet[
        stylesheet.index(".modal-card.modal-wide-width {"):
        stylesheet.index("}", stylesheet.index(".modal-card.modal-wide-width {"))
    ]
    body_rule = stylesheet[
        stylesheet.index(".modal-card.modal-wide-width .modal-body {"):
        stylesheet.index(
            "}", stylesheet.index(".modal-card.modal-wide-width .modal-body {")
        )
    ]

    assert "modal-wide-width" in card_markup
    assert "modal-wide-form" not in card_markup
    assert template.index("modal-header") < template.index("form-phathanh-hsmt")
    assert template.index("form-phathanh-hsmt") < template.index("modal-body")
    assert template.index("modal-body") < template.index("modal-footer")
    assert "width: min(1120px, 100%);" in width_rule
    assert "max-width: min(1120px, 100%);" in width_rule
    assert "height:" not in width_rule
    assert "flex: 0 1 auto;" in body_rule
    assert "overflow-y: auto;" in body_rule
