import re
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


def test_sidebar_has_compact_tablet_mode_and_reachable_mobile_drawer():
    shell = _source("frontend/app/shellAccessibility.js")
    controller = _source("frontend/app/BiddingControllerUI.js")
    base = _source("views/css/base.css")
    redesign = _source("views/css/ui-redesign.css")
    initial_route = _source("views/vendor/initial-route.js")

    assert 'const COMPACT_SIDEBAR_QUERY = "(min-width: 769px) and (max-width: 1180px)";' in shell
    assert "createCompactSidebarMediaQuery" in shell
    assert "compactMediaQuery" in controller
    assert 'classList.toggle("sidebar-auto-collapsed", autoCollapsed)' in shell
    assert "desktopCollapsed" in shell
    assert "compactMediaQuery.matches" in controller
    assert "sidebarToggle.contains(event.target)" in controller
    assert 'matchMedia("(min-width: 769px) and (max-width: 1180px)")' in initial_route

    mobile_rule = redesign[redesign.index("@media (max-width: 768px)"):]
    assert ".menu-toggle-btn" in mobile_rule
    assert "display: inline-flex !important;" in mobile_rule
    assert "align-items: center;" in mobile_rule
    assert "justify-content: center;" in mobile_rule
    assert "transform: translateX(-100%);" in base
    assert ".sidebar.active" in base


def test_mobile_sidebar_trigger_uses_brand_icon_and_drawer_stays_above_scrim():
    header = _source("views/components/header.html")
    base = _source("views/css/base.css")
    redesign = _source("views/css/ui-redesign.css")

    trigger = header[
        header.index('class="menu-toggle-btn"'):
        header.index("</button>", header.index('class="menu-toggle-btn"'))
    ]
    assert 'class="mobile-brand-icon"' in trigger
    assert 'data-lucide="layers"' in trigger
    assert 'data-lucide="menu"' not in trigger

    mobile_rule = base[base.index("@media (max-width: 768px)"):]
    assert ".sidebar.active {" in mobile_rule
    assert "z-index: 201;" in mobile_rule
    scrim_rule = mobile_rule[
        mobile_rule.index(".app-container:has(.sidebar.active)::after {"):
        mobile_rule.index("}", mobile_rule.index(".app-container:has(.sidebar.active)::after {"))
    ]
    assert "left: min(var(--sidebar-width), calc(100vw - 32px));" in scrim_rule
    assert "pointer-events: auto;" in scrim_rule

    mobile_redesign = redesign[redesign.index("@media (max-width: 768px)"):]
    assert ".menu-toggle-btn .mobile-brand-icon" in mobile_redesign

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
    assert "box-shadow: 0 0 0 var(--focus-ring-width) var(--focus-ring);" in focus_rule


def test_package_lot_table_keeps_all_headers_visible_and_aligned():
    template = _source("views/modals/modal_goithau.html")
    controller = _source("frontend/app/BiddingControllerForms.js")
    table = template[
        template.index('<table class="phanlo-table" id="phanlo-table">'):
        template.index('</table>', template.index('<table class="phanlo-table" id="phanlo-table">'))
    ]

    assert 'id="th-baodam-phanlo"' in table
    assert "Bảo đảm dự thầu (VNĐ)" in table
    assert '<th class="col-action">Thao tác</th>' in table
    assert 'setVisible(thBaoDam, true, "table-cell");' in controller


def test_package_lot_input_focus_ring_is_compact():
    stylesheet = _source("views/css/views.css")
    focus_rule = stylesheet[
        stylesheet.index(".phanlo-table td input:focus {"):
        stylesheet.index("}", stylesheet.index(".phanlo-table td input:focus {"))
    ]

    assert "outline: none;" in focus_rule
    assert "box-shadow: 0 0 0 var(--focus-ring-width) var(--primary-soft);" in focus_rule


def test_package_subtable_add_buttons_use_idempotent_event_binding():
    source = _source("frontend/app/BiddingControllerForms.js")

    for button_id in (
        "btn-them-phanlo",
        "btn-them-tuychonmuathem",
        "btn-them-giahan",
        "btn-them-yeucaulamro",
        "btn-them-traloilamro",
    ):
        assert f'onById("{button_id}", "click"' in source


def test_lotted_package_price_is_readonly_and_recalculated_from_rows():
    form_controller = _source("frontend/app/BiddingControllerForms.js")
    sub_tables = _source("frontend/shared/FormSubTables.js")
    workflow = _source("frontend/packages/GoiThauWorkflow.js")
    template = _source("views/modals/modal_goithau.html")

    assert "export function recalculateTotalLotPrice()" in form_controller
    assert 'setReadonlyVisual(packagePriceInput, phanLo === "Có")' in form_controller
    assert "this.recalculateTotalLotPrice()" in sub_tables
    assert "Cảnh báo chênh lệch giá" not in workflow
    assert "giaGoiThau: packagePriceToSave" in workflow
    assert 'id="gt-gia-derived-hint"' in template
    assert "Tự động tính bằng tổng giá trị các phần lô." in template


def test_delete_controls_use_the_compact_trash_icon_pattern():
    components = _source("views/css/components.css")
    sub_tables = _source("frontend/shared/FormSubTables.js")
    breakdown = _source("frontend/plans/KeHoachWorkflow.js")
    evaluation = _source("frontend/packages/bidEvaluationRender.js")
    expert_modal = _source("views/modals/modal_chuyengia.html")
    contractor_modal = _source("views/modals/modal_nhathau.html")

    button_rule = components[components.index(".action-btn {"):components.index(".action-btn i,")]
    assert "width: 32px;" in button_rule
    assert "height: 32px;" in button_rule
    icon_rule = components[components.index(".action-btn i,"):components.index(".action-btn:hover {")]
    assert ".action-btn svg" in icon_rule
    assert "width: 14px;" in icon_rule
    assert "height: 14px;" in icon_rule

    assert "btn btn-icon btn-danger" not in sub_tables
    assert sub_tables.count('class="action-btn btn-delete') >= 5
    for source in (breakdown, evaluation):
        assert "&times;" not in source
        assert 'data-lucide="trash-2"' in source
    for source in (expert_modal, contractor_modal):
        remove_file_markup = source[source.index("btn-remove-file"):]
        assert 'data-lucide="trash-2"' in remove_file_markup


def test_notification_actions_and_rows_use_the_compact_panel_pattern():
    template = _source("views/components/header.html")
    index = _source("views/index.html")
    stylesheet = _source("views/css/ui-redesign.css")
    read_all_rule = stylesheet[
        stylesheet.index(".notification-read-all {"):
        stylesheet.index(".notification-read-all svg {")
    ]
    icon_rule = stylesheet[
        stylesheet.index(".notification-read-all svg {"):
        stylesheet.index(".notification-read-all > span {")
    ]
    disabled_rule = stylesheet[
        stylesheet.index(".notification-read-all:disabled {"):
        stylesheet.index(".notification-panel-scroll {")
    ]
    list_rule = stylesheet[
        stylesheet.index(".notification-list {"):
        stylesheet.index(".notification-list::before {")
    ]
    item_rule = stylesheet[
        stylesheet.index(".notification-item {"):
        stylesheet.index(".notification-item:hover {")
    ]

    assert 'data-lucide="check"' in template
    assert 'data-lucide="check-check"' not in template
    assert '<span>Đánh dấu tất cả đã đọc</span>' in template
    assert '/css/ui-redesign.css?v=2.0' in index
    assert "border: 0;" in read_all_rule
    assert "background: transparent;" in read_all_rule
    assert "display: block;" in icon_rule
    assert "flex: 0 0 16px;" in icon_rule
    assert "background: transparent;" in disabled_rule
    assert "gap: 6px;" in list_rule
    assert "border-radius: 10px;" in item_rule
    assert "border: 1px solid transparent;" in item_rule


def test_dashboard_recent_packages_fit_without_horizontal_scrolling():
    template = _source("views/tabs/tab_dashboard.html")
    script = _source("frontend/app/DashboardView.js")
    stylesheet = _source("views/css/ui-redesign.css")

    assert 'class="data-table dashboard-recent-table"' in template
    assert 'class="dashboard-recent-code-column"' in template
    assert 'class="dashboard-recent-name-column"' in template
    assert 'class="dashboard-recent-price-column"' in template
    assert 'class="dashboard-recent-status-column"' in template
    assert 'class="dashboard-recent-link dashboard-recent-code"' in script
    assert 'class="dashboard-recent-link dashboard-recent-name"' in script
    assert "grid-template-columns: repeat(2, minmax(0, 1fr));" in stylesheet
    assert ".dashboard-work-grid .recent-activity .dashboard-table-body" in stylesheet
    assert "overflow-x: hidden;" in stylesheet
    assert "#recent-packages-table" in stylesheet
    assert "table-layout: fixed;" in stylesheet
    assert "-webkit-line-clamp: 2;" in stylesheet
    recent_link_hover = stylesheet[
        stylesheet.index("#recent-packages-table .dashboard-recent-link:hover"):
        stylesheet.index("#recent-packages-table .dashboard-recent-code {")
    ]
    assert "text-decoration: none;" in recent_link_hover


def test_focus_indicators_share_one_compact_width_token():
    variables = _source("views/css/variables.css")
    assert "--focus-ring-width: 1px;" in variables

    for path in (
        "views/css/base.css",
        "views/css/components.css",
        "views/css/ui-redesign.css",
        "views/css/views.css",
    ):
        stylesheet = _source(path)
        focus_rules = re.findall(
            r"[^{}]*:focus(?:-visible|-within)?[^{}]*\{[^{}]*\}",
            stylesheet,
        )
        assert focus_rules, f"Expected focus rules in {path}"
        for rule in focus_rules:
            assert not re.search(r"outline:\s*[2-9]px\s+solid", rule), rule
            assert not re.search(r"box-shadow:\s*0 0 0 [2-9]px", rule), rule


def test_plan_breakdown_modal_shares_wide_width_without_fixed_height():
    template = _source("views/modals/modal_plan_breakdown.html")
    stylesheet = _source("views/css/ui-redesign.css")
    card_markup = template[template.index('<div class="modal-card'):]
    card_markup = card_markup[:card_markup.index(">")]
    width_rule = stylesheet[
        stylesheet.index(".modal-card.modal-wide-width {"):
        stylesheet.index("}", stylesheet.index(".modal-card.modal-wide-width {"))
    ]
    content_height_rule = stylesheet[
        stylesheet.index("#modal-plan-breakdown .modal-card.modal-wide-width {"):
        stylesheet.index("}", stylesheet.index("#modal-plan-breakdown .modal-card.modal-wide-width {"))
    ]

    assert "modal-wide-width" in card_markup
    assert "modal-wide-form" not in card_markup
    assert "width: min(1120px, 100%);" in width_rule
    assert "height:" not in width_rule
    assert "max-height:" not in width_rule
    assert "height: auto;" in content_height_rule


def test_sidebar_focus_ring_does_not_stack_a_second_thick_border():
    stylesheet = _source("views/css/ui-redesign.css")
    focus_rule = stylesheet[
        stylesheet.index(".nav-btn:focus-visible {"):
        stylesheet.index(".nav-btn.active {")
    ]

    assert "outline: var(--focus-ring-width) solid var(--brand) !important;" in focus_rule
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
