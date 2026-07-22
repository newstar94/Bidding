from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_hsmt_appraisal_radio_options_are_inline_and_centered():
    template = (ROOT / "views" / "modals" / "modal_phathanh_hsmt.html").read_text(
        encoding="utf-8"
    )
    stylesheet = (ROOT / "views" / "css" / "ui-redesign.css").read_text(
        encoding="utf-8"
    )

    assert 'class="radio-group radio-options"' in template
    assert template.count('class="radio-option"') == 2
    assert template.count('class="radio-option-input"') == 2

    group_rule = stylesheet[
        stylesheet.index(".form-group .radio-options {"):
        stylesheet.index("}", stylesheet.index(".form-group .radio-options {"))
    ]
    option_rule = stylesheet[
        stylesheet.index(".form-group .radio-options .radio-option {"):
        stylesheet.index("}", stylesheet.index(".form-group .radio-options .radio-option {"))
    ]
    input_rule = stylesheet[
        stylesheet.index(".form-group .radio-options .radio-option-input {"):
        stylesheet.index("}", stylesheet.index(".form-group .radio-options .radio-option-input {"))
    ]

    assert "display: flex;" in group_rule
    assert "align-items: center;" in group_rule
    assert "display: inline-flex;" in option_rule
    assert "align-items: center;" in option_rule
    assert "margin: 0;" in option_rule
    assert "width: 18px !important;" in input_rule
    assert "height: 18px !important;" in input_rule
    assert "margin: 0;" in input_rule
