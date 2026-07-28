import { trustedHTML } from "../shared/trustedTypes.js";
import { escapeHtml } from "../shared/view_helpers.js";
import { getAppController } from "../app/controllerRef.js";
import { generateRecordId } from "../shared/idUtils.js";
import { downloadPackageGoodsWorkbook, buildPackageGoodsPreview, readPackageGoodsExcel } from "./PackageGoodsExcel.js";
import { isPackageGoodsEditable, validatePackageGoodsItem } from "./packageGoodsValidation.js";

function packageGoods(model, packageId) {
  return (model?.state?.goithauhanghoa || [])
    .filter((item) => String(item.goiThauId) === String(packageId))
    .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0) || String(left.id).localeCompare(String(right.id)));
}

function lotLabel(lot) {
  return [lot?.maPhanLo, lot?.tenPhanLo].filter(Boolean).join(" — ") || "Phần lô";
}

function money(value) {
  if (value === "" || value == null) return "";
  return new Intl.NumberFormat("vi-VN").format(Number(value) || 0);
}

function operationLabel(value) {
  return { create: "Thêm mới", update: "Cập nhật", unchanged: "Không thay đổi", invalid: "Không hợp lệ" }[value] || value;
}

export function packageGoodsPaginationPages(currentPage, totalPages, maxVisiblePages = 5) {
  const safeTotal = Math.max(1, Number(totalPages) || 1);
  const safeCurrent = Math.min(safeTotal, Math.max(1, Number(currentPage) || 1));
  const visibleCount = Math.max(1, Number(maxVisiblePages) || 1);
  let startPage = Math.max(1, safeCurrent - Math.floor(visibleCount / 2));
  const endPage = Math.min(safeTotal, startPage + visibleCount - 1);
  startPage = Math.max(1, endPage - visibleCount + 1);
  return Array.from({ length: endPage - startPage + 1 }, (_, index) => startPage + index);
}

async function persistImport(model, pkg, preview, { mode, selectedLotId }) {
  if (preview.some((item) => !item._valid)) throw new Error("Không thể lưu khi còn dòng không hợp lệ.");
  const current = packageGoods(model, pkg.id);
  const importedKeys = new Set(preview.map((item) => `${item.phanLoId || ""}::${String(item.maHangHoa || "").trim().toLocaleLowerCase("vi")}`));
  const replaceScope = mode === "replace";
  const deleted = replaceScope ? current.filter((item) => {
    if (selectedLotId && String(item.phanLoId) !== String(selectedLotId)) return false;
    const key = `${item.phanLoId || ""}::${String(item.maHangHoa || "").trim().toLocaleLowerCase("vi")}`;
    return !importedKeys.has(key);
  }) : [];
  const upserts = preview.filter((item) => item._operation !== "unchanged").map((item) => {
    const record = { ...item };
    ["_operation", "_valid", "_comment", "_rowNumber", "_lotCode"].forEach((key) => delete record[key]);
    return record;
  });
  const deletedIds = new Set(deleted.map((item) => String(item.id)));
  const upsertById = new Map(upserts.map((item) => [String(item.id), item]));
  model.state.goithauhanghoa = (model.state.goithauhanghoa || [])
    .filter((item) => !deletedIds.has(String(item.id)))
    .map((item) => upsertById.get(String(item.id)) || item);
  upserts.forEach((item) => {
    if (!model.state.goithauhanghoa.some((currentItem) => String(currentItem.id) === String(item.id))) model.state.goithauhanghoa.push(item);
  });
  await model.db.applySyncChanges({ upserts: { goithauhanghoa: upserts }, deletions: { goithauhanghoa: [...deletedIds] } });
  if (upserts.length) model.markRecordDirty("goithauhanghoa", upserts);
  if (deleted.length) model.markDeleted("goithauhanghoa", deleted);
  return { upserts, deleted };
}

function renderPreview(container, rows, lots) {
  const lotById = new Map(lots.map((lot) => [String(lot.id), lot]));
  container.innerHTML = trustedHTML(`
    <div class="table-responsive"><table class="data-table" data-no-sort="true">
      <thead><tr><th>Dòng</th><th>Phần lô</th><th>Mã hàng hóa</th><th>Tên hàng hóa</th><th>Đơn vị tính</th><th>Số lượng</th><th>Thao tác dự kiến</th><th>Trạng thái</th><th>Chi tiết lỗi</th></tr></thead>
      <tbody>${rows.map((row) => `<tr>
        <td>${row._rowNumber || ""}</td><td>${escapeHtml(lotLabel(lotById.get(String(row.phanLoId || ""))))}</td>
        <td>${escapeHtml(row.maHangHoa)}</td><td>${escapeHtml(row.tenHangHoa)}</td><td>${escapeHtml(row.donViTinh)}</td><td>${escapeHtml(String(row.soLuong ?? ""))}</td>
        <td>${escapeHtml(operationLabel(row._operation))}</td><td>${row._valid ? "Hợp lệ" : "Lỗi"}</td><td>${escapeHtml(row._comment || "")}</td>
      </tr>`).join("")}</tbody>
    </table></div>`);
}

function bindEditor(view, root, pkg, lots, editable, rerender) {
  const form = root.querySelector("#package-goods-form");
  const editor = root.querySelector("#package-goods-editor");
  const openEditor = (record = null) => {
    if (!editable) return;
    editor.hidden = false;
    form.reset();
    form.elements.namedItem("recordId").value = record?.id || "";
    form.elements.namedItem("phanLoId").value = record?.phanLoId || "";
    Object.keys(record || {}).forEach((key) => { if (form.elements[key]) form.elements[key].value = record[key] ?? ""; });
    form.elements.maHangHoa.focus();
  };
  root.querySelector("#btn-package-goods-add")?.addEventListener("click", () => openEditor());
  root.querySelector("#btn-package-goods-cancel")?.addEventListener("click", () => { editor.hidden = true; });
  root.querySelectorAll("[data-edit-goods]").forEach((button) => button.addEventListener("click", () => {
    openEditor((view.model.state.goithauhanghoa || []).find((item) => String(item.id) === button.dataset.editGoods));
  }));
  root.querySelectorAll("[data-delete-goods]").forEach((button) => button.addEventListener("click", async () => {
    if (!editable || !await view.customConfirm("Xóa hàng hóa", "Bạn có chắc muốn xóa hàng hóa này?", "trash-2")) return;
    await view.model.deleteRecord("goithauhanghoa", button.dataset.deleteGoods);
    const result = await getAppController()?.autoSync?.();
    if (!result?.ok) await view.customAlert("Lỗi đồng bộ", "Hàng hóa đang chờ đồng bộ; máy chủ chưa xác nhận thao tác xóa.", "alert-triangle");
    await rerender();
  }));
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const current = (view.model.state.goithauhanghoa || []).find((item) => String(item.id) === String(data.recordId));
    const record = {
      ...current,
      id: data.recordId || generateRecordId("goithauhanghoa"), goiThauId: pkg.id,
      phanLoId: pkg.phanLo === "Có" ? data.phanLoId : null,
      maHangHoa: data.maHangHoa.trim(), tenHangHoa: data.tenHangHoa.trim(), nhomHangHoa: data.nhomHangHoa.trim(), donViTinh: data.donViTinh.trim(),
      soLuong: Number(data.soLuong), yeuCauKyThuat: data.yeuCauKyThuat.trim(), kyMaHieuThamChieu: data.kyMaHieuThamChieu.trim(),
      xuatXuYeuCau: data.xuatXuYeuCau.trim(), diaDiemGiaoHang: data.diaDiemGiaoHang.trim(), thoiGianGiaoHang: data.thoiGianGiaoHang.trim(),
      donGiaDuToan: data.donGiaDuToan === "" ? null : Number(data.donGiaDuToan), thanhTienDuToan: data.thanhTienDuToan === "" ? null : Number(data.thanhTienDuToan),
      ghiChu: data.ghiChu.trim(), sortOrder: current?.sortOrder ?? packageGoods(view.model, pkg.id).length,
    };
    const errors = validatePackageGoodsItem(record, { pkg, lots });
    const duplicate = packageGoods(view.model, pkg.id).find((item) => item.id !== record.id && item.phanLoId === record.phanLoId && String(item.maHangHoa).trim().toLocaleLowerCase("vi") === record.maHangHoa.toLocaleLowerCase("vi"));
    if (duplicate) errors.push("Mã hàng hóa đã tồn tại trong cùng phạm vi.");
    if (errors.length) return view.customAlert("Dữ liệu không hợp lệ", errors.join(" "), "alert-triangle");
    if (current) await view.model.updateRecord("goithauhanghoa", record); else await view.model.addRecord("goithauhanghoa", record);
    const result = await getAppController()?.autoSync?.();
    if (!result?.ok) return view.customAlert("Lỗi đồng bộ", "Dữ liệu đã lưu cục bộ nhưng máy chủ chưa xác nhận. Hãy xử lý lỗi đồng bộ trước khi tiếp tục.", "alert-triangle");
    editor.hidden = true;
    await rerender();
  });
}

export async function renderPackageGoodsPanel(view, { contentWrapper, pkg }) {
  const lots = Array.isArray(pkg.phanLoList) ? pkg.phanLoList : [];
  const allGoods = packageGoods(view.model, pkg.id);
  const editable = isPackageGoodsEditable(pkg) && view.model.hasPermission?.(view.model.state.activeuser?.id, "goithau", "edit") !== false;
  const personalWorkspace = String(view.model.workspaceScope?.organizationId || view.model.workspaceScope?.key || "").includes("personal:");
  const canDelete = editable && (personalWorkspace || view.model.state.activerole !== "employee");
  const selected = String(view._packageGoodsLotFilter || "");
  const search = String(view._packageGoodsSearch || "").trim().toLocaleLowerCase("vi");
  const scoped = allGoods.filter((item) => !selected || String(item.phanLoId) === selected);
  const filtered = scoped.filter((item) => !search || [item.maHangHoa, item.tenHangHoa, item.nhomHangHoa, item.donViTinh].some((value) => String(value || "").toLocaleLowerCase("vi").includes(search)));
  const pageSize = 100;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(pageCount, Math.max(1, Number(view._packageGoodsPage || 1)));
  const visibleGoods = filtered.slice((page - 1) * pageSize, page * pageSize);
  const lotById = new Map(lots.map((lot) => [String(lot.id), lot]));
  const hasLotColumn = pkg.phanLo === "Có" && !selected;
  const columnCount = hasLotColumn ? 11 : 10;
  const startIndex = filtered.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIndex = Math.min(page * pageSize, filtered.length);
  const paginationPages = packageGoodsPaginationPages(page, pageCount);
  contentWrapper.innerHTML = trustedHTML(`
    <section class="package-goods-panel" aria-labelledby="package-goods-title">
      <header class="package-goods-toolbar">
        <div class="package-goods-heading">
          <h4 class="package-section-title is-neutral package-goods-title" id="package-goods-title"><i data-lucide="package-open" aria-hidden="true"></i>Danh mục hàng hóa</h4>
          <p class="package-goods-summary"><span>${allGoods.length} mặt hàng</span>${editable ? "" : `<span class="package-goods-readonly"><i data-lucide="lock" aria-hidden="true"></i>Chỉ đọc vì gói thầu đang ở trạng thái ${escapeHtml(pkg.trangThai || "không cho phép sửa")}</span>`}</p>
        </div>
        <div class="package-goods-actions">
          <label class="package-goods-search" for="package-goods-search">
            <span class="visually-hidden">Tìm hàng hóa</span><i data-lucide="search" aria-hidden="true"></i>
            <input class="form-control" id="package-goods-search" type="search" value="${escapeHtml(view._packageGoodsSearch || "")}" placeholder="Tìm mã hoặc tên hàng hóa">
          </label>
          ${pkg.phanLo === "Có" ? `<label class="package-goods-filter" for="package-goods-lot-filter"><span class="visually-hidden">Lọc theo phần lô</span><select class="form-control" id="package-goods-lot-filter"><option value="">Tất cả phần lô</option>${lots.map((lot) => `<option value="${escapeHtml(lot.id)}" ${selected === String(lot.id) ? "selected" : ""}>${escapeHtml(lotLabel(lot))}</option>`).join("")}</select></label>` : ""}
          <button type="button" class="btn btn-outline" id="btn-package-goods-template"><i data-lucide="download" aria-hidden="true"></i>Tải file mẫu</button>
          <button type="button" class="btn btn-outline" id="btn-package-goods-export"><i data-lucide="file-spreadsheet" aria-hidden="true"></i>Xuất Excel</button>
          <input id="package-goods-file" type="file" accept=".xlsx,.xls" hidden ${editable ? "" : "disabled"}>
          <button type="button" class="btn btn-outline" id="btn-package-goods-import-trigger" ${editable ? "" : "disabled"}><i data-lucide="upload" aria-hidden="true"></i>Nhập Excel</button>
          <button type="button" class="btn btn-primary" id="btn-package-goods-add" ${editable ? "" : "disabled"}><i data-lucide="plus" aria-hidden="true"></i>Thêm hàng hóa</button>
        </div>
      </header>
      <div id="package-goods-editor" hidden><form id="package-goods-form" class="package-goods-form"><input type="hidden" name="recordId">
        ${pkg.phanLo === "Có" ? `<label>Phần lô<select name="phanLoId" required><option value="">Chọn phần lô</option>${lots.map((lot) => `<option value="${escapeHtml(lot.id)}">${escapeHtml(lotLabel(lot))}</option>`).join("")}</select></label>` : `<input type="hidden" name="phanLoId">`}
        <label>Mã hàng hóa<input name="maHangHoa" required></label><label>Tên hàng hóa<input name="tenHangHoa" required></label><label>Nhóm hàng hóa<input name="nhomHangHoa"></label><label>Đơn vị tính<input name="donViTinh" required></label><label>Số lượng<input name="soLuong" type="number" min="0.0001" step="any" required></label>
        <label>Yêu cầu kỹ thuật<textarea name="yeuCauKyThuat"></textarea></label><label>Ký mã hiệu tham chiếu<input name="kyMaHieuThamChieu"></label><label>Xuất xứ yêu cầu<input name="xuatXuYeuCau"></label><label>Địa điểm giao hàng<input name="diaDiemGiaoHang"></label><label>Thời gian giao hàng<input name="thoiGianGiaoHang"></label><label>Đơn giá dự toán<input name="donGiaDuToan" type="number" min="0" step="1"></label><label>Thành tiền dự toán<input name="thanhTienDuToan" type="number" min="0" step="1"></label><label>Ghi chú<textarea name="ghiChu"></textarea></label>
        <div><button class="btn btn-outline" type="button" id="btn-package-goods-cancel">Hủy</button><button class="btn btn-primary" type="submit">Lưu</button></div>
      </form></div>
      <div class="table-container package-goods-table"><table class="data-table" data-no-sort="true"><thead><tr>${hasLotColumn ? "<th>Phần lô</th>" : ""}<th>STT</th><th>Mã hàng hóa</th><th>Tên hàng hóa</th><th>Nhóm</th><th>ĐVT</th><th>Số lượng</th><th>Yêu cầu kỹ thuật</th><th>Đơn giá dự toán</th><th>Thành tiền</th><th>Thao tác</th></tr></thead>
      <tbody>${visibleGoods.length ? visibleGoods.map((item, index) => `<tr>${hasLotColumn ? `<td>${escapeHtml(lotLabel(lotById.get(String(item.phanLoId))))}</td>` : ""}<td>${(page - 1) * pageSize + index + 1}</td><td>${escapeHtml(item.maHangHoa)}</td><td>${escapeHtml(item.tenHangHoa)}</td><td>${escapeHtml(item.nhomHangHoa || "")}</td><td>${escapeHtml(item.donViTinh)}</td><td>${escapeHtml(String(item.soLuong))}</td><td>${escapeHtml(item.yeuCauKyThuat || "")}</td><td>${money(item.donGiaDuToan)}</td><td>${money(item.thanhTienDuToan)}</td><td><button class="btn btn-sm btn-outline" data-edit-goods="${escapeHtml(item.id)}" ${editable ? "" : "disabled"}>Sửa</button> <button class="btn btn-sm btn-danger" data-delete-goods="${escapeHtml(item.id)}" ${canDelete ? "" : "disabled"} title="${canDelete ? "Xóa hàng hóa" : "Theo chính sách hiện tại, chỉ Quản lý tổ chức được xóa dữ liệu"}">Xóa</button></td></tr>`).join("") : `<tr class="package-goods-empty-row"><td colspan="${columnCount}"><div class="package-goods-empty"><i data-lucide="package-search" aria-hidden="true"></i><span>Chưa có hàng hóa trong phạm vi này.</span></div></td></tr>`}</tbody></table></div>
      <nav class="pagination-container package-goods-pagination" aria-label="Phân trang danh mục hàng hóa"><span class="pagination-info">Hiển thị <strong>${startIndex}-${endIndex}</strong> trên tổng số <strong>${filtered.length}</strong> bản ghi</span><div class="pagination-buttons">
        <button type="button" class="pagination-btn" data-package-goods-page="1" title="Trang đầu" aria-label="Trang đầu" ${page <= 1 ? "disabled" : ""}><i data-lucide="chevrons-left" aria-hidden="true"></i></button>
        <button type="button" class="pagination-btn" data-package-goods-page="${Math.max(1, page - 1)}" title="Trang trước" aria-label="Trang trước" ${page <= 1 ? "disabled" : ""}><i data-lucide="chevron-left" aria-hidden="true"></i></button>
        ${paginationPages.map((pageNumber) => `<button type="button" class="pagination-btn ${pageNumber === page ? "active" : ""}" data-package-goods-page="${pageNumber}" ${pageNumber === page ? 'aria-current="page"' : ""} aria-label="Trang ${pageNumber}">${pageNumber}</button>`).join("")}
        <button type="button" class="pagination-btn" data-package-goods-page="${Math.min(pageCount, page + 1)}" title="Trang sau" aria-label="Trang sau" ${page >= pageCount ? "disabled" : ""}><i data-lucide="chevron-right" aria-hidden="true"></i></button>
        <button type="button" class="pagination-btn" data-package-goods-page="${pageCount}" title="Trang cuối" aria-label="Trang cuối" ${page >= pageCount ? "disabled" : ""}><i data-lucide="chevrons-right" aria-hidden="true"></i></button>
      </div></nav>
      <section id="package-goods-import" hidden><div class="package-goods-import-controls"><label>Chế độ<select id="package-goods-import-mode"><option value="merge">Gộp dữ liệu</option><option value="replace">Thay thế toàn bộ phạm vi</option></select></label><button class="btn btn-primary" id="btn-package-goods-import-save">Lưu dữ liệu hợp lệ</button></div><div id="package-goods-preview"></div></section>
    </section>`);

  const rerender = () => renderPackageGoodsPanel(view, { contentWrapper, pkg });
  contentWrapper.querySelector("#package-goods-lot-filter")?.addEventListener("change", async (event) => { view._packageGoodsLotFilter = event.target.value; view._packageGoodsPage = 1; await rerender(); });
  contentWrapper.querySelector("#package-goods-search")?.addEventListener("change", async (event) => { view._packageGoodsSearch = event.target.value; view._packageGoodsPage = 1; await rerender(); });
  contentWrapper.querySelectorAll("[data-package-goods-page]").forEach((button) => button.addEventListener("click", async () => {
    const requestedPage = Number(button.dataset.packageGoodsPage);
    if (!Number.isInteger(requestedPage) || requestedPage < 1 || requestedPage > pageCount || requestedPage === page) return;
    view._packageGoodsPage = requestedPage;
    await rerender();
  }));
  contentWrapper.querySelector("#btn-package-goods-template")?.addEventListener("click", () => downloadPackageGoodsWorkbook(pkg, [], { template: true, selectedLotId: selected }));
  contentWrapper.querySelector("#btn-package-goods-export")?.addEventListener("click", () => downloadPackageGoodsWorkbook(pkg, allGoods, { selectedLotId: selected }));
  bindEditor(view, contentWrapper, pkg, lots, editable, rerender);

  const fileInput = contentWrapper.querySelector("#package-goods-file");
  contentWrapper.querySelector("#btn-package-goods-import-trigger")?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0]; if (!file) return;
    try {
      const imported = await readPackageGoodsExcel(file, { pkg, selectedLotId: selected });
      const preview = buildPackageGoodsPreview(imported, allGoods, { pkg });
      view._packageGoodsImportPreview = preview;
      const section = contentWrapper.querySelector("#package-goods-import"); section.hidden = false;
      renderPreview(contentWrapper.querySelector("#package-goods-preview"), preview, lots);
    } catch (error) {
      await view.customAlert("Không thể đọc Excel", error?.message || "Tệp Excel không hợp lệ.", "alert-triangle");
    }
  });
  contentWrapper.querySelector("#btn-package-goods-import-save")?.addEventListener("click", async () => {
    const preview = view._packageGoodsImportPreview || [];
    if (!preview.length || preview.some((item) => !item._valid)) return view.customAlert("Chưa thể lưu", "Hãy sửa toàn bộ dòng lỗi trước khi lưu.", "alert-triangle");
    const mode = contentWrapper.querySelector("#package-goods-import-mode")?.value || "merge";
    if (mode === "replace" && !await view.customConfirm("Thay thế danh mục", "Các hàng hóa không có trong file ở đúng phạm vi đang nhập sẽ bị xóa. Tiếp tục?", "alert-triangle")) return;
    try {
      await persistImport(view.model, pkg, preview, { mode, selectedLotId: selected });
      const result = await getAppController()?.autoSync?.();
      if (!result?.ok) throw new Error("Máy chủ chưa xác nhận batch import; dữ liệu vẫn nằm trong hàng đợi đồng bộ.");
      view._packageGoodsImportPreview = null;
      await rerender();
      await view.customAlert("Thành công", "Danh mục hàng hóa đã được lưu và đồng bộ.", "check-circle");
    } catch (error) {
      await view.customAlert("Import chưa hoàn tất", error?.message || "Không thể lưu danh mục hàng hóa.", "alert-triangle");
    }
  });
}
