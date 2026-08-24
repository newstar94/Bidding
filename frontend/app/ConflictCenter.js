function node(tag, attributes = {}, text = "") {
  const element = document.createElement(tag);
  Object.entries(attributes).forEach(([key, value]) => {
    if (key === "className") element.className = value;
    else if (key === "type") element.type = value;
    else element.setAttribute(key, value);
  });
  if (text !== "") element.textContent = text;
  return element;
}

function displayValue(value) {
  if (value && typeof value === "object" && value.missing === true) return "<không có trường>";
  if (value === null) return "null";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value ?? "");
}

function statusLabel(status) {
  return {
    UNCHANGED: "Không đổi",
    LOCAL_ONLY: "Chỉ bản của tôi thay đổi",
    SERVER_ONLY: "Chỉ máy chủ thay đổi",
    BOTH_SAME: "Hai phía cùng thay đổi giống nhau",
    CONFLICT: "Cần quyết định",
    UNSUPPORTED_FIELD: "Không hỗ trợ hợp nhất",
    UNSUPPORTED_DELETE: "Không hỗ trợ xóa trường",
    UNSUPPORTED_NESTED: "Không hỗ trợ cấu trúc lồng nhau",
  }[status] || status;
}

function renderField(field, decisions) {
  const row = node("section", { className: "conflict-center-field" });
  const heading = node("div", { className: "conflict-center-field-heading" });
  heading.append(
    node("strong", {}, field.field),
    node("span", { className: `conflict-center-status is-${String(field.status || "").toLowerCase()}` }, statusLabel(field.status)),
  );
  row.append(heading);
  const values = node("div", { className: "conflict-center-values" });
  for (const [label, key] of [["Base", "base"], ["Của tôi", "local"], ["Máy chủ", "server"]]) {
    const column = node("div", { className: "conflict-center-value" });
    column.append(node("span", { className: "conflict-center-value-label" }, label));
    column.append(node("pre", {}, displayValue(field[key])));
    values.append(column);
  }
  row.append(values);
  if (!String(field.status || "").startsWith("UNSUPPORTED") && field.status !== "UNCHANGED") {
    const label = node("label", { className: "conflict-center-choice" });
    label.append(node("span", {}, `Quyết định cho ${field.field}`));
    const select = node("select", { "data-conflict-field": field.field });
    select.append(node("option", { value: "" }, "Dùng phân loại đề xuất"));
    select.append(node("option", { value: "LOCAL" }, "Dùng của tôi"));
    select.append(node("option", { value: "SERVER" }, "Dùng máy chủ"));
    if (field.requiresChoice) select.value = "";
    select.addEventListener("change", () => {
      if (select.value) decisions[field.field] = select.value;
      else delete decisions[field.field];
    });
    label.append(select);
    row.append(label);
  }
  return row;
}

export async function openConflictCenter(controller) {
  const previousFocus = document.activeElement;
  const dialog = node("dialog", {
    className: "conflict-center-dialog",
    "aria-labelledby": "conflict-center-title",
  });
  const header = node("header", { className: "conflict-center-header" });
  header.append(node("h2", { id: "conflict-center-title" }, "Trung tâm xử lý xung đột"));
  const close = node("button", { type: "button", className: "btn btn-outline", "aria-label": "Đóng" }, "Đóng");
  header.append(close);
  const content = node("div", { className: "conflict-center-content" });
  const footer = node("footer", { className: "conflict-center-footer" });
  dialog.append(header, content, footer);
  document.body.append(dialog);

  const cleanup = () => {
    dialog.close();
    dialog.remove();
    previousFocus?.focus?.();
  };
  close.addEventListener("click", cleanup);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    cleanup();
  });
  dialog.showModal();
  content.append(node("p", { role: "status" }, "Đang tải bản nháp…"));

  try {
    const drafts = await controller.model.refreshConflictRecoveryDrafts();
    content.replaceChildren();
    footer.replaceChildren();
    if (drafts.length === 0) {
      content.append(node("p", {}, "Không có bản nháp xung đột đang hoạt động."));
      return;
    }
    const draft = drafts[0];
    const preview = await controller.model.previewConflictRecoveryDraft(draft.id);
    content.append(
      node("p", { className: "conflict-center-note" }, "Bản nháp được giữ trên máy chủ nhưng sẽ không tự áp lại. Mỗi lần xác nhận đều kiểm tra lại quyền và rowVersion."),
    );
    const decisions = {};
    preview.fields.forEach((field) => content.append(renderField(field, decisions)));

    const discard = node("button", { type: "button", className: "btn btn-outline" }, "Bỏ bản nháp");
    const resolve = node("button", { type: "button", className: "btn btn-primary" }, "Xác nhận hợp nhất");
    footer.append(discard, resolve);
    discard.addEventListener("click", async () => {
      if (!globalThis.confirm?.("Bỏ vĩnh viễn bản nháp xung đột này?")) return;
      discard.disabled = true;
      await controller.model.discardConflictRecoveryDraft(draft.id);
      controller.updateSyncState?.({ phase: "idle" });
      cleanup();
    });
    resolve.addEventListener("click", async () => {
      resolve.disabled = true;
      try {
        await controller.model.resolveConflictRecoveryDraft(draft.id, preview, decisions);
        controller.updateSyncState?.({ phase: "serverSaved", lastSyncedAt: Date.now() });
        controller.view?.showToast?.("Đã xử lý xung đột", "Quyết định đã được lưu qua kiểm tra quyền và rowVersion mới nhất.", "success");
        cleanup();
      } catch (error) {
        resolve.disabled = false;
        const message = error?.status === 409
          ? "Dữ liệu máy chủ đã đổi lần nữa. Đóng và mở lại để xem snapshot mới."
          : error?.message || "Không thể xử lý xung đột.";
        controller.view?.showToast?.("Chưa thể xử lý xung đột", message, "warning");
      }
    });
  } catch (error) {
    content.replaceChildren(node("p", { role: "alert" }, error?.message || "Không thể tải Trung tâm xung đột."));
  }
}
