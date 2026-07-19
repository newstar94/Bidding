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


def test_timeline_controls_do_not_install_custom_select_observers():
    template = _source("views/tabs/tab_goithau_timeline.html")
    timeline = _source("frontend/packages/PackageTimelineView.js")

    for control_id in (
        "timeline-plan-select",
        "timeline-package-select",
        "timeline-version-select",
        "timeline-status-filter",
    ):
        control_markup = template[template.index(f'id="{control_id}"'):]
        assert 'data-no-custom="true"' in control_markup.split(">", 1)[0]
    assert 'import { makeSearchableSelect }' not in timeline


def test_runtime_style_assignment_is_idempotent():
    source = _source("frontend/shared/runtimeStyles.js")

    assert "if (previous === className) return value;" in source
