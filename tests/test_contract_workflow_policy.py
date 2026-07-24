from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_contract_save_requires_and_commits_assignment_with_contract():
    source = (ROOT / "frontend" / "contracts" / "HopDongWorkflow.js").read_text(
        encoding="utf-8-sig"
    )
    assignment_validation = source.index(
        '"Vui lòng chọn chuyên viên phụ trách hợp đồng."'
    )
    contract_mutation = source.index("if (id) {", assignment_validation)
    sync_call = source.index(
        'persistAndSync(this, ["hopdong", "assignments"])', contract_mutation
    )
    sync_guard = source.index("if (!syncResult?.ok) return;", sync_call)
    close_modal = source.index('this.closeModal("modal-hopdong")', sync_guard)

    assert assignment_validation < contract_mutation < sync_call
    assert sync_call < sync_guard < close_modal


def test_contract_new_version_targets_assignment_to_new_contract_id():
    source = (ROOT / "frontend" / "contracts" / "HopDongWorkflow.js").read_text(
        encoding="utf-8-sig"
    )
    version_block = source[source.index("if (isNewVersion) {") :]
    version_block = version_block[: version_block.index("if (hasModalReturnState")]

    assert "finalHdId = data.id;" in version_block
    assert "a.targetId === finalHdId" in version_block
    assert "targetId: finalHdId" in version_block
    assert "finalHdId !== id" in version_block
    assert "hasHistoricalAssignment" in version_block


def test_contract_assignment_is_staged_before_atomic_persist():
    source = (ROOT / "frontend" / "contracts" / "HopDongWorkflow.js").read_text(
        encoding="utf-8-sig"
    )
    assignment_block = source[source.index("if (finalHdId) {") :]
    assignment_block = assignment_block[: assignment_block.index("if (hasModalReturnState")]

    assert 'this.model.addRecord("assignments"' not in assignment_block
    assert 'this.model.deleteRecord("assignments"' not in assignment_block
    assert "this.model.state.assignments.push" in assignment_block


def test_multi_table_persist_defers_background_sync_until_batch_is_ready():
    mutation_source = (ROOT / "frontend" / "shared" / "MutationService.js").read_text(
        encoding="utf-8"
    )
    sync_source = (ROOT / "frontend" / "app" / "BiddingControllerSync.js").read_text(
        encoding="utf-8"
    )

    assert "controller._deferImmediateSync = true;" in mutation_source
    assert "controller._deferImmediateSync = false;" in mutation_source
    assert "this._deferImmediateSync" in sync_source


def test_contract_duration_and_plan_share_requested_responsive_grid():
    modal = (ROOT / "views" / "modals" / "modal_hopdong.html").read_text(
        encoding="utf-8"
    )
    stylesheet = (ROOT / "views" / "css" / "components.css").read_text(
        encoding="utf-8"
    )

    group = modal.split('class="contract-plan-duration-grid"', 1)[1]
    group = group.split('class="form-group col-span-2"', 1)[0]
    assert group.index('id="hd-songay"') < group.index('id="hd-kehoachid"')
    assert ".contract-plan-duration-grid {" in stylesheet
    assert "grid-template-columns: minmax(0, 3fr) minmax(0, 9fr);" in stylesheet


def test_contract_partner_version_options_refresh_the_visible_controls():
    source = (ROOT / "frontend" / "contracts" / "HopDongWorkflow.js").read_text(
        encoding="utf-8-sig"
    )

    assert "initCustomSelect" in source.split("from \"../shared/view_helpers.js\";")[0]
    assert source.count("initCustomSelect(versionSelect.id);") >= 2


def test_contract_partners_use_compact_5_1_5_1_version_layout():
    modal = (ROOT / "views" / "modals" / "modal_hopdong.html").read_text(
        encoding="utf-8"
    )
    source = (ROOT / "frontend" / "contracts" / "HopDongWorkflow.js").read_text(
        encoding="utf-8-sig"
    )
    stylesheet = (ROOT / "views" / "css" / "ui-redesign.css").read_text(
        encoding="utf-8"
    )

    controls = modal[
        modal.index('<div class="contract-partner-section">'):
        modal.index('id="hd-giatri"')
    ]
    assert controls.index('id="hd-chudautuid"') < controls.index('id="hd-chudautu-version-select"')
    assert controls.index('id="hd-chudautu-version-select"') < controls.index('id="hd-nhathauid"')
    assert controls.index('id="hd-nhathauid"') < controls.index('id="hd-nhathau-version-select"')
    assert controls.count('>Phiên bản <span class="required">*</span></label>') == 2
    assert "Phiên bản Chủ đầu tư <span" not in controls
    assert "Phiên bản Nhà thầu <span" not in controls
    assert "minmax(0, 5fr) minmax(92px, 1fr)" in stylesheet
    assert "grid-template-columns: repeat(2, minmax(0, 1fr));" in stylesheet
    assert "· áp dụng" not in source
    assert "versions[0]?.id" in source
    assert "Thông tin Chủ đầu tư - Ngày ${effectiveDate}" in source
    assert "Thông tin Nhà thầu - Ngày ${effectiveDate}" in source


def test_contract_empty_partner_state_keeps_disabled_version_columns_visible():
    modal = (ROOT / "views" / "modals" / "modal_hopdong.html").read_text(
        encoding="utf-8"
    )
    source = (ROOT / "frontend" / "contracts" / "HopDongWorkflow.js").read_text(
        encoding="utf-8-sig"
    )

    owner_group = modal[
        modal.index('id="hd-chudautu-version-group"') - 80:
        modal.index('id="hd-nhathauid"')
    ]
    contractor_group = modal[
        modal.index('id="hd-nhathau-version-group"') - 80:
        modal.index('class="contract-partner-info-grid"')
    ]
    assert "bf-s-65d1f1c3d7" not in owner_group
    assert "bf-s-65d1f1c3d7" not in contractor_group
    assert 'id="hd-chudautu-version-select" required disabled' in owner_group
    assert 'id="hd-nhathau-version-select" required disabled' in contractor_group
    assert source.count('versionSelect.disabled = true;') >= 2
    assert source.count('versionSelect.disabled = false;') >= 2
    assert source.count('initCustomSelect(versionSelect.id);') >= 4


def test_contract_employee_dropdown_always_contains_the_current_specialist():
    source = (ROOT / "frontend" / "contracts" / "HopDongWorkflow.js").read_text(
        encoding="utf-8-sig"
    )
    populate = source[
        source.index("const _populateHdEmpDropdown"):
        source.index("if (!this.model.state.employees")
    ]

    assert "ensureCurrentUserAssignee" in populate
    assert "selectableEmployees" in populate
    assert "selectableEmployees.map" in populate
    assert "empSelect.value = currentUserId;" in source

    reset_position = source.index("form.reset();")
    populate_position = source.index("loadAndPopulateHdEmpDropdown();", reset_position)
    assert populate_position > reset_position


def test_contract_package_links_are_not_restricted_by_procurement_result():
    source = (ROOT / "frontend" / "contracts" / "HopDongWorkflow.js").read_text(
        encoding="utf-8-sig"
    )
    package_renderer = source[
        source.index("const renderPackagesForPlan"):
        source.index("const handleCdtChange")
    ]

    assert "planVersionIds.includes(g.keHoachId)" in package_renderer
    assert "g.trangThai" not in package_renderer
    assert "nhaThauTrungThauId" not in package_renderer
    assert "selectedContractorId" not in package_renderer
    assert "Không có gói thầu đủ điều kiện lập hợp đồng" not in package_renderer


def test_contract_classification_supports_other():
    modal = (ROOT / "views" / "modals" / "modal_hopdong.html").read_text(
        encoding="utf-8"
    )
    classification = modal[
        modal.index('id="hd-phanloai"'):
        modal.index('id="hd-coqdchidinh"')
    ]
    excel_handler = (ROOT / "backend" / "documents" / "excel_handler.py").read_text(
        encoding="utf-8"
    )

    assert '<option value="Khác">Khác</option>' in classification
    assert "'options': ['Tư vấn', 'Thẩm định', 'Khác']" in excel_handler


def test_searchable_word_combobox_removes_the_superseded_generic_control():
    source = (ROOT / "frontend" / "shared" / "PartnerHelpers.js").read_text(
        encoding="utf-8-sig"
    )
    helper = source[
        source.index("export function makeSearchableSelect"):
        source.index("function searchableSelectSignature")
    ]

    assert ".custom-select-container[data-target=" in helper
    assert "genericContainer.remove();" in helper
    assert 'body > .custom-select-options[data-parent="' in helper


def test_contract_package_checkboxes_align_with_their_labels():
    stylesheet = (ROOT / "views" / "css" / "ui-redesign.css").read_text(
        encoding="utf-8"
    )
    label_start = stylesheet.index("#hd-goithau-list .checkbox-item {")
    label_rule = stylesheet[label_start:stylesheet.index("}", label_start)]
    input_start = stylesheet.index("#hd-goithau-list .checkbox-item input[type=checkbox] {")
    input_rule = stylesheet[input_start:stylesheet.index("}", input_start)]

    assert "align-items: center;" in label_rule
    assert "grid-template-columns: 18px minmax(0, 1fr);" in label_rule
    assert "min-height: 18px;" in input_rule
    assert "margin: 0;" in input_rule
