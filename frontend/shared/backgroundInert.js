// Overlapping modal/loading surfaces may close in either order.
const locks = new WeakMap();

export function acquireBackgroundInert(element, owner) {
  let state = locks.get(element);
  if (!state) {
    state = { original: element.hasAttribute?.("inert") || Boolean(element.inert), owners: new Set() };
    locks.set(element, state);
  }
  state.owners.add(owner);
  element.setAttribute?.("inert", "");
}

export function releaseBackgroundInert(element, owner) {
  const state = locks.get(element);
  if (!state || !state.owners.delete(owner)) return;
  if (state.owners.size) {
    element.setAttribute?.("inert", "");
    return;
  }
  if (state.original) element.setAttribute?.("inert", "");
  else element.removeAttribute?.("inert");
  locks.delete(element);
}
