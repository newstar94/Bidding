import { generateRecordId } from "./idUtils.js";

export function normalizeAssigneeIds(values) {
  const source = Array.isArray(values) ? values : [values];
  return [...new Set(source.map((value) => String(value || "").trim()).filter(Boolean))];
}

export function selectedAssigneeIds(select) {
  if (!select) return [];
  return normalizeAssigneeIds(
    Array.from(select.selectedOptions || []).map((option) => option.value),
  );
}

export function assignmentRowsFor(assignments, targetId, type) {
  return (assignments || []).filter((assignment) => (
    String(assignment?.targetId || "") === String(targetId || "")
    && String(assignment?.type || "") === String(type || "")
  ));
}

export function assigneeLabelsForTarget(model, targetId, type) {
  const employees = [
    ...(model?.state?.employees || []),
    ...(model?.state?.activeuser ? [model.state.activeuser] : []),
  ];
  const byId = new Map(employees.map((employee) => [
    String(employee?.id || ""),
    String(
      employee?.name
      || employee?.tenNhanSu
      || employee?.organizationProfile?.name
      || employee?.email
      || employee?.id
      || "Không xác định",
    ).trim(),
  ]));
  return assignmentRowsFor(model?.state?.assignments, targetId, type)
    .map((assignment) => byId.get(String(assignment.empId)) || String(assignment.empId))
    .filter(Boolean);
}

export function computeAssignmentDelta(existingAssignments, selectedIds) {
  const selected = new Set(normalizeAssigneeIds(selectedIds));
  const existingByEmployee = new Map();
  for (const assignment of existingAssignments || []) {
    const employeeId = String(assignment?.empId || "").trim();
    if (employeeId && !existingByEmployee.has(employeeId)) {
      existingByEmployee.set(employeeId, assignment);
    }
  }
  return {
    addedIds: [...selected].filter((employeeId) => !existingByEmployee.has(employeeId)),
    removedAssignments: [...existingByEmployee]
      .filter(([employeeId]) => !selected.has(employeeId))
      .map(([, assignment]) => assignment),
    unchangedAssignments: [...existingByEmployee]
      .filter(([employeeId]) => selected.has(employeeId))
      .map(([, assignment]) => assignment),
  };
}

export async function applyAssignmentDelta(model, { targetId, type, selectedIds }) {
  const existing = assignmentRowsFor(model?.state?.assignments, targetId, type);
  const delta = computeAssignmentDelta(existing, selectedIds);
  for (const assignment of delta.removedAssignments) {
    await model.deleteRecord("assignments", assignment.id);
  }
  for (const employeeId of delta.addedIds) {
    await model.addRecord("assignments", {
      id: generateRecordId("assignments"),
      empId: employeeId,
      targetId,
      type,
    });
  }
  return delta;
}

function renderChips(select, chips) {
  chips.replaceChildren();
  for (const option of Array.from(select.selectedOptions || [])) {
    const chip = document.createElement("span");
    chip.className = "multi-assignee-chip";
    chip.textContent = option.textContent || option.value;
    if (!select.disabled) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.setAttribute("aria-label", `Bỏ ${option.textContent || option.value}`);
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        option.selected = false;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        select.focus();
      });
      chip.appendChild(remove);
    }
    chips.appendChild(chip);
  }
}

export function initializeMultiAssigneeSelect(select, {
  selectedIds = [],
  disabled = false,
  searchPlaceholder = "Tìm theo tên hoặc email...",
} = {}) {
  if (!select) return;
  select.multiple = true;
  select.size = 5;
  select.dataset.noCustom = "true";
  select.disabled = Boolean(disabled);
  const selected = new Set(normalizeAssigneeIds(selectedIds));
  Array.from(select.options).forEach((option) => {
    option.selected = selected.has(String(option.value || "").trim());
  });

  select.parentElement?.querySelector(".multi-assignee-tools")?.remove();
  const tools = document.createElement("div");
  tools.className = "multi-assignee-tools";
  const search = document.createElement("input");
  search.type = "search";
  search.className = "multi-assignee-search";
  search.placeholder = searchPlaceholder;
  search.setAttribute("aria-label", searchPlaceholder);
  search.disabled = select.disabled;
  const chips = document.createElement("div");
  chips.className = "multi-assignee-chips";
  chips.setAttribute("aria-live", "polite");
  tools.append(search, chips);
  select.insertAdjacentElement("beforebegin", tools);

  search.addEventListener("input", () => {
    const query = search.value.trim().toLocaleLowerCase("vi-VN");
    Array.from(select.options).forEach((option) => {
      const haystack = `${option.textContent || ""} ${option.dataset.search || ""}`
        .toLocaleLowerCase("vi-VN");
      option.hidden = Boolean(query) && !haystack.includes(query);
    });
  });
  select.addEventListener("change", () => renderChips(select, chips));
  renderChips(select, chips);
}
