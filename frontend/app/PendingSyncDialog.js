import { CLIENT_TABLE_MAP } from "../documents/schemaRuntime.js";

const TABLE_LABELS = {
  chudautu: "Chủ đầu tư",
  kehoach: "Kế hoạch LCNT",
  goithau: "Gói thầu",
  chuyengia: "Chuyên gia",
  nhathau: "Nhà thầu",
  hopdong: "Hợp đồng",
  thongtinmothau: "Thông tin mở thầu",
  assignments: "Phân công",
  permissionmatrix: "Phân quyền",
  custompaperstatuses: "Trạng thái hồ sơ giấy"
};

const DISPLAY_FIELDS = {
  chudautu: ["maChuDauTu", "tenChuDauTu"],
  kehoach: ["maKeHoach", "tenKeHoach"],
  goithau: ["maGoiThau", "tenGoiThau"],
  chuyengia: ["hoTen", "soChungChi"],
  nhathau: ["maNhaThau", "tenNhaThau"],
  hopdong: ["soHopDong", "tenHopDong"],
  thongtinmothau: ["maNhaThau", "tenNhaThau"],
  assignments: ["targetId", "empId"],
  permissionmatrix: ["empId"],
  custompaperstatuses: ["name", "tenTrangThai"]
};

const STATE_KEY_BY_SERVER_TABLE = Object.fromEntries(
  Object.entries(CLIENT_TABLE_MAP).map(([stateKey, tableName]) => [tableName, stateKey])
);

function conflictRecordKeys(conflictData = {}) {
  return new Set((conflictData?.errors || []).map((error) => {
    const type = STATE_KEY_BY_SERVER_TABLE[error?.table] || error?.table;
    return `${type}:${String(error?.id || "")}`;
  }));
}

export function listPendingSyncItems(queue = {}, conflictData = null) {
  const conflicts = conflictRecordKeys(conflictData);
  const items = [];
  Object.entries(queue.upserts || {}).forEach(([type, records]) => {
    Object.entries(records || {}).forEach(([id, record]) => {
      items.push({
        type,
        id: String(id),
        operation: "upsert",
        record,
        conflict: conflicts.has(`${type}:${String(id)}`)
      });
    });
  });
  (queue.deletes || []).forEach((entry) => {
    if (!entry?.table || !entry?.id) return;
    items.push({
      type: entry.table,
      id: String(entry.id),
      operation: "delete",
      record: null,
      conflict: conflicts.has(`${entry.table}:${String(entry.id)}`)
    });
  });
  return items;
}

export function pendingSyncItemDisplay(item = {}) {
  const record = item.record || {};
  const values = (DISPLAY_FIELDS[item.type] || [])
    .map((field) => String(record[field] || "").trim())
    .filter(Boolean);
  return {
    table: TABLE_LABELS[item.type] || item.type || "Dữ liệu",
    title: values[0] || item.id || "Không xác định",
    description: values.slice(1).join(" · ") || item.id || "",
    operation: item.operation === "delete" ? "Xóa" : "Thêm/Cập nhật"
  };
}

function createElement(tag, className = "", text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function ensureDialog(controller) {
  let modal = document.getElementById("modal-pending-sync");
  if (modal) return modal;
  modal = createElement("div", "modal-overlay pending-sync-modal");
  modal.id = "modal-pending-sync";

  const card = createElement("div", "modal-card pending-sync-card");
  const header = createElement("div", "modal-header");
  const heading = createElement("div");
  heading.append(
    createElement("h3", "", "Danh sách chờ đồng bộ"),
    createElement("p", "pending-sync-subtitle", "Chỉ giữ dữ liệu hợp lệ đang chờ kết nối hoặc xử lý xung đột.")
  );
  const closeButton = createElement("button", "modal-close", "×");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Đóng danh sách chờ đồng bộ");
  closeButton.addEventListener("click", () => modal.classList.remove("active"));
  header.append(heading, closeButton);

  const body = createElement("div", "modal-body pending-sync-body");
  body.id = "pending-sync-list";
  const footer = createElement("div", "modal-footer pending-sync-footer");
  const closeFooter = createElement("button", "btn btn-outline", "Đóng");
  closeFooter.type = "button";
  closeFooter.addEventListener("click", () => modal.classList.remove("active"));
  const continueButton = createElement("button", "btn btn-primary", "Tiếp tục đồng bộ");
  continueButton.type = "button";
  continueButton.id = "btn-continue-pending-sync";
  continueButton.addEventListener("click", async () => {
    modal.classList.remove("active");
    await controller.continuePendingSync?.();
  });
  footer.append(closeFooter, continueButton);
  card.append(header, body, footer);
  modal.appendChild(card);
  document.body.appendChild(modal);
  return modal;
}

function statusText(item, controller) {
  if (item.conflict || controller?._syncConflict) return "Đang chờ xử lý xung đột";
  if (globalThis.navigator?.onLine === false) return "Đang chờ kết nối mạng";
  return "Sẵn sàng đồng bộ";
}

export function openPendingSyncDialog(controller) {
  const modal = ensureDialog(controller);
  const body = modal.querySelector("#pending-sync-list");
  const continueButton = modal.querySelector("#btn-continue-pending-sync");
  const items = listPendingSyncItems(
    controller?.model?.getMutationQueue?.() || {},
    controller?._syncConflict?.data
  );
  body.replaceChildren();

  const summary = createElement(
    "div",
    "pending-sync-summary",
    items.length > 0 ? `${items.length} bản ghi đang chờ` : "Không còn bản ghi chờ đồng bộ"
  );
  body.appendChild(summary);
  if (items.length === 0) {
    body.appendChild(createElement("div", "pending-sync-empty", "Mọi thay đổi hợp lệ đã được xử lý."));
  }

  items.forEach((item) => {
    const display = pendingSyncItemDisplay(item);
    const row = createElement("article", "pending-sync-item");
    row.dataset.type = item.type;
    row.dataset.id = item.id;
    row.dataset.operation = item.operation;

    const content = createElement("div", "pending-sync-item-content");
    const meta = createElement("div", "pending-sync-item-meta");
    meta.append(
      createElement("span", `pending-sync-operation pending-sync-operation-${item.operation}`, display.operation),
      createElement("span", "pending-sync-table", display.table)
    );
    content.append(
      meta,
      createElement("strong", "pending-sync-title", display.title),
      createElement("span", "pending-sync-description", display.description),
      createElement("span", `pending-sync-state${item.conflict ? " is-conflict" : ""}`, statusText(item, controller))
    );

    const removeButton = createElement("button", "btn btn-outline btn-sm pending-sync-remove", "Xóa khỏi hàng chờ");
    removeButton.type = "button";
    removeButton.addEventListener("click", async () => {
      const confirmed = await controller.view.customConfirm(
        "Xóa thay đổi đang chờ",
        `Bỏ thao tác ${display.operation.toLowerCase()} đối với ${display.table} “${display.title}”?`,
        "trash-2"
      );
      if (!confirmed) return;
      removeButton.disabled = true;
      await controller.removePendingSyncItem?.(item);
      openPendingSyncDialog(controller);
    });
    row.append(content, removeButton);
    body.appendChild(row);
  });

  continueButton.disabled = items.length === 0 || globalThis.navigator?.onLine === false;
  continueButton.title = globalThis.navigator?.onLine === false
    ? "Cần kết nối mạng để tiếp tục đồng bộ"
    : "Đồng bộ các bản ghi hợp lệ đang chờ";
  modal.classList.add("active");
  controller?.view?.createIconsScoped?.(modal);
  return modal;
}
