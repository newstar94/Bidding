from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _source(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding="utf-8")


def test_tab_navigation_uses_latest_transition_only():
    source = _source("frontend/app/BiddingControllerUI.js")

    assert "this._tabTransitionVersion" in source
    assert "isCurrentTransition()" in source
    assert "this.switchTab(tabName, action, updateState, transitionVersion)" in source


def test_active_tab_still_renders_during_startup_and_workspace_changes():
    source = _source("frontend/app/BiddingControllerUI.js")
    switch_block = source[source.index("export function switchTab"):source.index("export function resetTimelineOnNavigation")]

    assert "requestedPane?.classList.contains(\"active\")" not in switch_block
    assert "this.renderTabData(tabName, action);" in switch_block


def test_background_sync_does_not_reenter_router_for_list_tabs():
    source = _source("frontend/app/BiddingControllerSync.js")
    render_block = source[source.index("function renderChangedState"):source.index("export function buildSyncErrorDetailLines")]

    assert "controller.handlePathRouting" not in render_block
    assert "detailTabs.has(activeTab)" in render_block


def test_icon_rendering_skips_already_rendered_svg_trees():
    source = _source("frontend/app/BiddingView.js")

    assert 'root?.querySelector?.("i[data-lucide]")' in source
    assert "if (!hasPendingIcon) return;" in source


def test_timeline_searchable_comboboxes_do_not_install_mutation_observers():
    template = _source("views/tabs/tab_goithau_timeline.html")
    timeline = _source("frontend/packages/PackageTimelineView.js")
    combobox = _source("frontend/shared/accessibleCombobox.js")

    for control_id in (
        "timeline-plan-select",
        "timeline-package-select",
        "timeline-version-select",
        "timeline-status-filter",
    ):
        control_markup = template[template.index(f'id="{control_id}"'):]
        assert 'data-no-custom="true"' in control_markup.split(">", 1)[0]
    assert 'import { initAccessibleCombobox }' in timeline
    assert "MutationObserver" not in combobox
    assert 'role", "combobox"' in combobox
    assert 'role", "listbox"' in combobox
    assert 'event.key === "ArrowDown"' in combobox
    assert 'event.key === "Escape"' in combobox


def test_timeline_hides_completed_plans_and_debounces_package_search():
    timeline = _source("frontend/packages/PackageTimelineView.js")

    assert 'timelinePlanProgressStatus(plan.id, packages) !== "Hoàn thành"' in timeline
    assert "state.packageSearchTimer = setTimeout" in timeline
    assert "loadPackageOptions(view, query), 300" in timeline


def test_timeline_combobox_uses_standard_control_focus_ring():
    stylesheet = _source("views/css/views.css")
    focus_rule = stylesheet[
        stylesheet.index(".timeline-page .bf-combobox-input:focus {"):
        stylesheet.index(".timeline-page .bf-combobox-input:disabled")
    ]

    assert "outline: none !important;" in focus_rule
    assert "box-shadow: 0 0 0 2px var(--focus-ring);" in focus_rule
    assert "0 0 0 3px" not in focus_rule


def test_sidebar_focus_ring_does_not_stack_a_second_thick_border():
    stylesheet = _source("views/css/ui-redesign.css")
    focus_rule = stylesheet[
        stylesheet.index(".nav-btn:focus-visible {"):
        stylesheet.index(".nav-btn.active {")
    ]

    assert "outline: 1px solid var(--brand) !important;" in focus_rule
    assert "outline-offset: 2px !important;" in focus_rule


def test_modal_close_button_is_visually_compact_with_full_touch_target():
    stylesheet = _source("views/css/ui-redesign.css")
    button_rule = stylesheet[
        stylesheet.index(".modal-close {"):
        stylesheet.index(".modal-close::before {")
    ]
    icon_rule = stylesheet[
        stylesheet.index(".modal-close::before {"):
        stylesheet.index(".modal-header .modal-close {")
    ]
    touch_target_rule = stylesheet[
        stylesheet.index(".modal-close::after {"):
        stylesheet.index(".modal-close:hover {")
    ]

    assert "width: 36px;" in button_rule
    assert "height: 36px;" in button_rule
    assert "width: 12px;" in icon_rule
    assert "height: 12px;" in icon_rule
    assert "inset: -4px;" in touch_target_rule


def test_google_identity_script_starts_before_full_window_load():
    source = _source("frontend/auth/AuthFlowController.js")
    loader_block = source[
        source.index('if (document.readyState === "loading")'):
        source.index("\n}", source.index('if (document.readyState === "loading")'))
    ]

    assert 'document.addEventListener("DOMContentLoaded"' in loader_block
    assert 'window.addEventListener("load"' not in loader_block


def test_employee_editor_loads_lazy_modal_before_populating_fields():
    source = _source("frontend/admin/AdminUserController.js")
    edit_block = source[
        source.index("export async function editEmployee"):
        source.index("export async function deleteEmployee")
    ]

    lazy_load = edit_block.index('await this.ensureLazyModal?.("modal-manager-employee")')
    populate_title = edit_block.index('document.getElementById("modal-employee-title").textContent')

    assert 'if (!document.getElementById("modal-manager-employee"))' in edit_block
    assert lazy_load < populate_title


def test_timeline_combobox_empty_state_is_compact_and_readable():
    stylesheet = _source("views/css/views.css")
    empty_rule = stylesheet[
        stylesheet.index(".timeline-page .bf-combobox-empty {"):
        stylesheet.index("@media (prefers-reduced-motion", stylesheet.index(".timeline-page .bf-combobox-empty {"))
    ]

    assert "color: var(--ink);" in empty_rule
    assert "font-weight: 600;" in empty_rule
    assert "text-align: left;" in empty_rule
    assert "text-align: center;" not in empty_rule


def test_runtime_style_assignment_is_idempotent():
    source = _source("frontend/shared/runtimeStyles.js")

    assert "if (previous === className) return value;" in source


def test_personal_workspace_owner_is_not_filtered_by_employee_assignments():
    source = _source("frontend/app/BiddingModel.js")

    assert "isActivePersonalWorkspace()" in source
    assert 'activeOrganizationId.startsWith("personal:")' in source
    for method_name in (
        "getFilteredKeHoach()",
        "getFilteredGoiThau()",
        "getFilteredHopDong()",
    ):
        method = source[source.index(method_name):]
        method = method[:method.index("\n  }")]
        assert "this.isActivePersonalWorkspace()" in method


def test_server_paginated_mutations_render_only_after_sync_confirmation():
    source = _source("frontend/shared/MutationService.js")

    pre_sync_render = source.index('if (!usesServerPagination && typeof afterPersist === "function")')
    sync_call = source.index("await controller.autoSync()")
    post_sync_render = source.index('if (usesServerPagination && syncResult?.ok !== false')

    assert pre_sync_render < sync_call < post_sync_render


def test_plan_success_waits_for_paginated_tables_to_finish_refreshing():
    source = _source("frontend/plans/KeHoachWorkflow.js")
    save_block = source[source.index('const syncResult = await persistAndSync(this, ["kehoach"'):]
    save_block = save_block[:save_block.index('await this.view.customAlert("Thành công"')]

    assert "afterPersist: () => Promise.all([" in save_block
    assert "this.view.renderKeHoachTable()" in save_block
    assert "this.view.renderGoiThauTable()" in save_block


def test_server_paginated_mutation_defers_duplicate_post_commit_render():
    mutation_source = _source("frontend/shared/MutationService.js")
    sync_source = _source("frontend/app/BiddingControllerSync.js")

    assert "controller._deferPostCommitRender = true;" in mutation_source
    assert "const deferPostCommitRender = this._deferPostCommitRender === true;" in sync_source
    assert "if (!deferPostCommitRender)" in sync_source
