let returnState = { tab: null, action: null };
export function captureModalReturnState(tab, action) {
  if (returnState.tab) return;
  returnState = { tab: tab || null, action: action || null };
}
export function hasModalReturnState(tab) {
  return tab ? returnState.tab === tab : !!returnState.tab;
}
export function updateModalReturnAction(action) {
  returnState = { ...returnState, action: action || null };
}
export function consumeModalReturnState(defaultTab) {
  const state = {
    tab: returnState.tab || defaultTab || null,
    action: returnState.action || null
  };
  // After reloading a create URL, there is no earlier list action to restore.
  // Returning to that same create action would immediately reopen the editor.
  if (
    state.tab === defaultTab
    && ["kehoach", "goithau", "hopdong"].includes(defaultTab)
    && state.action === "taomoi"
  ) state.action = null;
  returnState = { tab: null, action: null };
  return state;
}
