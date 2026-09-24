import { initAccessibleCombobox } from "../shared/accessibleCombobox.js";

// Keep native controls as the authoritative FormData/change-event seam.
export function bindAdminSelects(root) {
  const controls = new Map();
  let nextId = 0;
  const refresh = () => {
    for (const [select, api] of controls) {
      if (!root.contains(select)) { api.destroy(); controls.delete(select); }
    }
    root.querySelectorAll("select.form-select:not([multiple])").forEach((select) => {
      if (controls.has(select)) return;
      if (!select.id) select.id = `admin-select-${++nextId}`;
      const api = initAccessibleCombobox(select, {
        searchable: false, includeEmptyOption: true, displayEmptyOptionLabel: true,
        portal: true, openOnFocus: false,
      });
      if (api) {
        controls.set(select, api);
        const list = document.getElementById(`${select.id}-listbox`);
        list?.classList.add("bf-admin-select-list");
      }
    });
  };
  refresh();
  const observer = new MutationObserver(refresh);
  observer.observe(root, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    for (const api of controls.values()) api.destroy();
    controls.clear();
  };
}
