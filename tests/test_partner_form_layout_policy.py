from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_investor_signer_fields_are_free_text_and_grouped_by_meaning():
    modal = (ROOT / "views" / "modals" / "modal_chudautu.html").read_text(encoding="utf-8")

    assert 'class="investor-position-grid"' in modal
    assert 'class="investor-signer-grid"' in modal
    assert modal.index('class="investor-signer-grid"') < modal.index('class="investor-position-grid"')
    assert '<input type="text" id="cdt-danhxung"' in modal
    assert '<select id="cdt-danhxung"' not in modal


def test_contractor_representative_fields_use_requested_order_and_ratio():
    modal = (ROOT / "views" / "modals" / "modal_nhathau.html").read_text(encoding="utf-8")
    stylesheet = (ROOT / "views" / "css" / "components.css").read_text(encoding="utf-8")

    representative_group = modal.split('class="contractor-representative-grid"', 1)[1].split("</div>\n                        </div>", 1)[0]
    assert representative_group.index('id="nt-danhxung"') < representative_group.index('id="nt-nguoidaidien"')
    assert representative_group.index('id="nt-nguoidaidien"') < representative_group.index('id="nt-chucvudaidien"')
    assert '<input type="text" id="nt-danhxung"' in representative_group
    assert '<select id="nt-danhxung"' not in modal
    assert ".contractor-representative-grid {" in stylesheet
    assert "grid-template-columns: minmax(0, 3fr) minmax(0, 6fr) minmax(0, 3fr);" in stylesheet
