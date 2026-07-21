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


def test_contract_edit_loads_and_preserves_linked_packages():
    source = (ROOT / "frontend" / "contracts" / "HopDongWorkflow.js").read_text(
        encoding="utf-8-sig"
    )

    assert 'await this.fetchRecordByLookup("hopdong", id)' in source
    assert '...(hd.goiThauIds || []).map((packageId) => ["goithau", packageId])' in source
    assert "packageCheckboxes.length === 0 && currentContractForPackages" in source
    assert 'form.dataset.originalPackageIds = JSON.stringify(hd.goiThauIds || [])' in source
    assert "[...originalPackageIds]" in source


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
