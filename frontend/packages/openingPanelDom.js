// Both the standalone opening route and package detail remain mounted.
// Opening controls must belong to the active route, including async callers.
export function getOpeningElement(id) {
  const activePane = document.querySelector?.(".tab-pane.active");
  return activePane
    ? activePane.querySelector(`#${id}`)
    : document.getElementById(id);
}
