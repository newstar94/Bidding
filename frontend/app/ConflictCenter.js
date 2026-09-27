import { activityFieldLabel } from "../shared/ActivityTimeline.js";

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

const CONFLICT_FIELD_LABELS = Object.freeze({
  tenKeHoach: "Tên kế hoạch",
  tenDuAnDuToan: "Tên dự án / dự toán",
  loaiHinhMuaSam: "Loại hình mua sắm",
  donViTrinhCdt: "Đơn vị trình chủ đầu tư",
  tenVietTatDonViTrinh: "Tên viết tắt đơn vị trình",
  tongMucDauTu: "Tổng mức đầu tư",
  isTongMucTuDong: "Tổng mức đầu tư tự động",
  ngayPheDuyet: "Ngày phê duyệt",
  quyetDinhPheDuyet: "Quyết định phê duyệt",
  thoiGianDangMa: "Thời gian đăng mã",
  nguonVon: "Nguồn vốn",
  thoiGianDuAn: "Thời gian thực hiện dự án",
  diaDiemQuyMo: "Địa điểm và quy mô",
  thongTinKhac: "Thông tin khác",
  soQdPheDuyetDuAn: "Số quyết định phê duyệt dự án",
  ngayQdPheDuyetDuAn: "Ngày quyết định phê duyệt dự án",
  coQuanPheDuyetDuAn: "Cơ quan phê duyệt dự án",
  pheDuyet: "Phạm vi phê duyệt",
  soToTrinhDuToan: "Số tờ trình dự toán",
  ngayTrinhDuToan: "Ngày trình dự toán",
  ngayPheDuyetDuToan: "Ngày phê duyệt dự toán",
  soQdPheDuyetDuToan: "Số quyết định phê duyệt dự toán",
  soToTrinhKeHoach: "Số tờ trình kế hoạch",
  soToTrinhDuToanKeHoach: "Số tờ trình dự toán kế hoạch",
  ngayTrinhKeHoach: "Ngày trình kế hoạch",
  maGoiThau: "Mã gói thầu",
  tenGoiThau: "Tên gói thầu",
  giaGoiThau: "Giá gói thầu",
  trangThai: "Trạng thái",
  ngayDongThau: "Ngày đóng thầu",
  ngayMoThau: "Ngày mở thầu",
  loaiHopDong: "Loại hợp đồng",
  hinhThucLuaChon: "Hình thức lựa chọn nhà thầu",
  phuongThucLuaChon: "Phương thức lựa chọn nhà thầu",
  quaMang: "Hình thức thực hiện qua mạng",
  trongNuocQuocTe: "Phạm vi trong nước / quốc tế",
  thoiGianThucHien: "Thời gian thực hiện gói thầu",
  giaTrungThau: "Giá trúng thầu",
  linhVuc: "Lĩnh vực gói thầu",
  tuyChonMuaThem: "Tùy chọn mua thêm",
  thoiGianToChuc: "Thời gian tổ chức lựa chọn nhà thầu",
  thoiGianBatDauToChuc: "Thời gian bắt đầu tổ chức",
  phanLo: "Phạm vi chia phần lô",
  thoiGianDangTai: "Thời gian đăng tải thông báo mời thầu",
  thoiGianMoEhsdxtc: "Thời gian mở E-HSĐXTC",
  soQuyetDinh: "Số quyết định phê duyệt HSMT / hồ sơ yêu cầu",
  ngayQuyetDinh: "Ngày quyết định phê duyệt HSMT / hồ sơ yêu cầu",
  soQuyetDinhKetQua: "Số quyết định phê duyệt kết quả",
  ngayQuyetDinhKetQua: "Ngày quyết định phê duyệt kết quả",
  thoiGianGoiThau: "Thời gian thực hiện của nhà thầu trúng thầu",
  thoiGianHopDong: "Thời gian thực hiện hợp đồng",
  giaTriDamBaoDuThau: "Giá trị bảo đảm dự thầu",
  hieuLucHsdt: "Hiệu lực E-HSDT",
  hieuLucDamBaoDuThau: "Hiệu lực bảo đảm dự thầu",
  phuongPhapDanhGia: "Phương pháp đánh giá E-HSDT",
  trongSoKyThuat: "Trọng số kỹ thuật",
  tyLeBaoDamHopDong: "Tỷ lệ bảo đảm thực hiện hợp đồng",
  isThuoc: "Phân loại gói thầu thuốc",
  yeuCauThamDinhHsmt: "Yêu cầu thẩm định HSMT",
  yeuCauThamDinhHsmtCode: "Mã yêu cầu thẩm định HSMT",
  soBaoCaoThamDinhHsmt: "Số báo cáo thẩm định HSMT",
  ngayBaoCaoThamDinhHsmt: "Ngày báo cáo thẩm định HSMT",
  soToTrinhHsmt: "Số tờ trình phê duyệt HSMT",
  ngayTrinhHsmt: "Ngày trình phê duyệt HSMT",
});

function fieldLabel(field, entityType) {
  return activityFieldLabel(entityType, field)
    || CONFLICT_FIELD_LABELS[field]
    || String(field || "Trường chưa đặt nhãn");
}

function formatDraftTime(value) {
  if (value === null || value === undefined || value === "") return "Không rõ";
  const date = new Date(typeof value === "number" ? value * 1000 : value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function renderField(field, decisions, entityType) {
  const row = node("section", { className: "conflict-center-field" });
  const heading = node("div", { className: "conflict-center-field-heading" });
  heading.append(
    node("strong", {}, fieldLabel(field.field, entityType)),
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
    label.append(node("span", {}, `Quyết định cho ${fieldLabel(field.field, entityType)}`));
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
  const workspaceToken = controller.model?.getWorkspaceToken?.()
    || controller.model?.workspaceScope?.key
    || "";
  let closed = false;
  let requestGeneration = 0;
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
    closed = true;
    requestGeneration += 1;
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
    let drafts = await controller.model.refreshConflictRecoveryDrafts();
    if (closed || workspaceToken !== (controller.model?.getWorkspaceToken?.() || controller.model?.workspaceScope?.key || "")) return;
    content.replaceChildren();
    footer.replaceChildren();
    if (drafts.length === 0) {
      content.append(node("p", {}, "Không có bản nháp xung đột đang hoạt động."));
      return;
    }
    const list = node("label", { className: "conflict-center-draft-picker" });
    list.append(node("span", {}, "Bản nháp cần xử lý"));
    const select = node("select", { "aria-label": "Chọn bản nháp xung đột" });
    drafts.forEach((item) => {
      const option = node("option", { value: item.id }, `${item.entityType || "Bản ghi"} · ${item.recordId || "Không rõ"} · ${formatDraftTime(item.updatedAt || item.createdAt)}`);
      select.append(option);
    });
    list.append(select);
    content.append(
      list,
      node("p", { className: "conflict-center-note" }, "Bản nháp được giữ trên máy chủ nhưng sẽ không tự áp lại. Mỗi lần xác nhận đều kiểm tra lại quyền và rowVersion."),
    );
    const fields = node("div", { className: "conflict-center-fields" });
    content.append(fields);
    const discard = node("button", { type: "button", className: "btn btn-outline" }, "Bỏ bản nháp");
    const resolve = node("button", { type: "button", className: "btn btn-primary" }, "Xác nhận hợp nhất");
    footer.append(discard, resolve);
    let selectedId = String(select.value || drafts[0].id);
    let preview = null;
    let decisions = {};

    const isCurrent = (generation) => {
      if (closed || generation !== requestGeneration) return false;
      if (workspaceToken !== (controller.model?.getWorkspaceToken?.() || controller.model?.workspaceScope?.key || "")) {
        cleanup();
        return false;
      }
      return true;
    };
    const setBusy = (busy) => {
      select.disabled = busy;
      discard.disabled = busy || !preview;
      resolve.disabled = busy || !preview;
    };

    const loadDraft = async (draftId) => {
      const generation = ++requestGeneration;
      selectedId = String(draftId);
      preview = null;
      setBusy(true);
      try {
        preview = await controller.model.previewConflictRecoveryDraft(selectedId);
      } catch (error) {
        if (isCurrent(generation)) {
          fields.replaceChildren(node("p", { role: "alert" }, error?.message || "Không thể tải snapshot."));
          setBusy(false);
        }
        throw error;
      }
      if (!isCurrent(generation)) return;
      decisions = {};
      fields.replaceChildren();
      (preview.fields || []).forEach((field) => fields.append(renderField(field, decisions, preview.draft?.entityType)));
      const metadata = drafts.find((item) => String(item.id) === selectedId);
      if (metadata) {
        fields.prepend?.(node("p", { className: "conflict-center-metadata" }, `Bản ghi ${metadata.recordId || "không rõ"} · Tạo ${formatDraftTime(metadata.createdAt)} · Hết hạn ${formatDraftTime(metadata.expiresAt)}`));
      }
      setBusy(false);
    };
    select.addEventListener("change", () => loadDraft(select.value).catch((error) => {
      if (closed || workspaceToken !== (controller.model?.getWorkspaceToken?.() || controller.model?.workspaceScope?.key || "")) return;
      controller.view?.showToast?.("Chưa thể tải bản nháp", error?.message || "Không thể tải snapshot.", "warning");
    }));
    await loadDraft(selectedId);
    discard.addEventListener("click", async () => {
      if (!isCurrent(requestGeneration) || !preview) return;
      if (!globalThis.confirm?.("Bỏ vĩnh viễn bản nháp xung đột này?")) return;
      const generation = ++requestGeneration;
      discard.disabled = true;
      resolve.disabled = true;
      select.disabled = true;
      try {
        await controller.model.discardConflictRecoveryDraft(selectedId);
        if (!isCurrent(generation)) return;
        drafts = drafts.filter((item) => String(item.id) !== selectedId);
        if (!drafts.length) cleanup();
        else {
          select.replaceChildren(...drafts.map((item) => node("option", { value: item.id }, `${item.entityType || "Bản ghi"} · ${item.recordId || "Không rõ"} · ${formatDraftTime(item.updatedAt || item.createdAt)}`)));
          await loadDraft(drafts[0].id);
        }
      } catch (error) {
        if (!isCurrent(generation)) return;
        discard.disabled = false;
        resolve.disabled = false;
        select.disabled = false;
        controller.view?.showToast?.("Chưa thể bỏ bản nháp", error?.message || "Không thể xác nhận thao tác với máy chủ.", "warning");
      }
    });
    resolve.addEventListener("click", async () => {
      if (!isCurrent(requestGeneration) || !preview) return;
      const generation = ++requestGeneration;
      resolve.disabled = true;
      discard.disabled = true;
      select.disabled = true;
      try {
        await controller.model.resolveConflictRecoveryDraft(selectedId, preview, decisions);
        if (!isCurrent(generation)) return;
        controller.view?.showToast?.("Đã xử lý xung đột", "Quyết định đã được lưu qua kiểm tra quyền và rowVersion mới nhất.", "success");
        cleanup();
      } catch (error) {
        if (!isCurrent(generation)) return;
        resolve.disabled = false;
        discard.disabled = false;
        select.disabled = false;
        if (error?.status === 409) {
          preview = null;
          setBusy(false);
          try {
            drafts = await controller.model.refreshConflictRecoveryDrafts();
            if (!isCurrent(generation)) return;
            select.replaceChildren(...drafts.map((item) => node("option", { value: item.id }, `${item.entityType || "Bản ghi"} · ${item.recordId || "Không rõ"} · ${formatDraftTime(item.updatedAt || item.createdAt)}`)));
            const stillPresent = drafts.some((item) => String(item.id) === selectedId);
            if (stillPresent) await loadDraft(selectedId);
            else if (drafts.length) await loadDraft(drafts[0].id);
            else fields.replaceChildren(node("p", { role: "status" }, "Không còn bản nháp xung đột đang hoạt động."));
            controller.view?.showToast?.("Dữ liệu máy chủ đã đổi", "Snapshot mới đã được tải. Hãy xác nhận lại lựa chọn.", "warning");
          } catch (refreshError) {
            if (isCurrent(requestGeneration)) {
              controller.view?.showToast?.("Chưa thể tải snapshot mới", refreshError?.message || "Vui lòng thử lại trong màn hình này.", "warning");
            }
          }
        } else {
          controller.view?.showToast?.("Chưa thể xử lý xung đột", error?.message || "Không thể xử lý xung đột.", "warning");
        }
      }
    });
  } catch (error) {
    content.replaceChildren(node("p", { role: "alert" }, error?.message || "Không thể tải Trung tâm xung đột."));
  }
}
