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
  returnState = { tab: null, action: null };
  return state;
}
