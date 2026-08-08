import { persistAndSync, stageLocalRecords } from "../shared/MutationService.js";
import { parseEvaluationMetadataForDisplay } from "./evaluationMetadata.js";

export function trackPackageInheritance(controller, inherit) {
  if (!controller || typeof inherit !== "function") return Promise.resolve();
  const pending = Promise.resolve().then(inherit);
  controller._packageInheritancePromise = pending;
  return pending.finally(() => {
    if (controller._packageInheritancePromise === pending) {
      controller._packageInheritancePromise = null;
    }
  });
}

export async function waitForPackageInheritance(controller) {
  const pending = controller?._packageInheritancePromise;
  if (pending) await pending;
}

export async function restoreCanceledPackage(id) {
  const gt = this.model.state.goithau.find((g) => g.id === id);
  if (!gt) return;
  let previousState = "Đang chấm thầu";
  if (gt.danhGiaHsdtMetadata) {
    const parsed = parseEvaluationMetadataForDisplay(
      gt.danhGiaHsdtMetadata,
    ).metadata;
    if (parsed.cancelDetails && parsed.cancelDetails.trangThaiTruocHuy) {
      previousState = parsed.cancelDetails.trangThaiTruocHuy;
    }
  }
  const confirmed = await this.view.customConfirm(
    "Khôi phục hủy thầu",
    `Bạn có chắc chắn muốn khôi phục gói thầu "${gt.tenGoiThau}"? Trạng thái sẽ được chuyển về "${previousState}".`,
    "rotate-ccw"
  );
  if (!confirmed) return;
  gt.trangThai = previousState;
  stageLocalRecords(this.model, "goithau", gt);
  const syncResult = await persistAndSync(this, "goithau", {
    afterPersist: () => this.view.renderGoiThauTable()
  });
  if (!syncResult?.ok) return;
  await this.view.customAlert("Thành công", "Đã khôi phục trạng thái gói thầu thành công.", "check-circle");
}
export async function checkAndInheritCanceledPackage(planId) {
  if (!planId) return;
  const canceledPackages = this.model.state.goithau.filter(
    (g) => String(g.keHoachId) === String(planId) && g.trangThai === "Hủy thầu" && g.isLatest === 1
  );
  if (canceledPackages.length === 0) return;
  let selectedCanceled = null;
  if (canceledPackages.length === 1) {
    const confirmed = await this.view.customConfirm(
      "Phát hiện gói thầu hủy",
      `Kế hoạch này chứa gói thầu đã bị hủy: "${canceledPackages[0].tenGoiThau}". Bạn có muốn lấy thông tin từ gói thầu này để đấu thầu lại không?`,
      "help-circle"
    );
    if (confirmed) {
      selectedCanceled = canceledPackages[0];
    }
  } else {
    const options = canceledPackages.map((g) => ({
      value: g.id,
      label: `${this.model.getPackageBaseCode(g.maGoiThau) || ""} - ${g.tenGoiThau}`
    }));
    const selectedId = await this.view.customSelectConfirm(
      "Đấu thầu lại",
      "Kế hoạch này có nhiều gói thầu đã bị hủy. Bạn có muốn đấu thầu lại bằng cách kế thừa thông tin từ một trong các gói thầu sau không?",
      options
    );
    if (selectedId) {
      selectedCanceled = canceledPackages.find((g) => g.id === selectedId);
    }
  }
  if (selectedCanceled) {
    const form = document.getElementById("form-goithau");
    if (form) {
      form.setAttribute("data-rebid-from", selectedCanceled.id);
    }
    document.getElementById("gt-ten").value = selectedCanceled.tenGoiThau || "";
    document.getElementById("gt-gia").value = this.model.formatVND(selectedCanceled.giaGoiThau);
    document.getElementById("gt-thoigian").value = selectedCanceled.thoiGianThucHien || "";
    document.getElementById("gt-hinhthuc").value = selectedCanceled.hinhThucLuaChon || "";
    document.getElementById("gt-phuongthuc").value = selectedCanceled.phuongThucLuaChon || "";
    document.getElementById("gt-linhvuc").value = selectedCanceled.linhVuc || "";
    const isThuocVal = selectedCanceled.isThuoc === 1 || selectedCanceled.isThuoc === "1" ? "1" : "0";
    const radioToCheck = document.querySelector(`input[name="gt-goithauthuoc"][value="${isThuocVal}"]`);
    if (radioToCheck) radioToCheck.checked = true;
    document.getElementById("gt-tuychonmuathem").value = selectedCanceled.tuyChonMuaThem || "Không";
    document.getElementById("gt-nguonvon").value = selectedCanceled.nguonVon || "Ngân sách nhà nước";
    document.getElementById("gt-loaihopdong").value = selectedCanceled.loaiHopDong || "Trọn gói";
    document.getElementById("gt-thoigiantochuc").value = selectedCanceled.thoiGianToChuc || "";
    document.getElementById("gt-thoigianbatdautochuc").value = selectedCanceled.thoiGianBatDauToChuc || "";
    document.getElementById("gt-quatmang").value = selectedCanceled.quaMang || "Qua mạng";
    document.getElementById("gt-trongnuocquocte").value = selectedCanceled.trongNuocQuocTe || "Trong nước";
    document.getElementById("gt-phanlo").value = selectedCanceled.phanLo || "Không";
    if (typeof this._loadPhanLoRows === "function") {
      this._loadPhanLoRows(selectedCanceled.phanLoList || []);
    }
    if (typeof this._loadTuyChonMuaThemRows === "function") {
      this._loadTuyChonMuaThemRows(selectedCanceled.tuyChonMuaThemList || []);
    }
    const savedToChuyenGia = selectedCanceled.toChuyenGia || [];
    document.querySelectorAll("#to-chuyengia-tbody tr").forEach((row) => {
      const cb = row.querySelector('input[name="tochuyengia-select"]');
      if (cb) {
        cb.checked = false;
        cb.dispatchEvent(new Event("change"));
      }
    });
    savedToChuyenGia.forEach((item) => {
      const row = document.querySelector(`#to-chuyengia-tbody tr[data-expert-id="${item.chuyenGiaId}"]`);
      if (row) {
        const cb = row.querySelector('input[name="tochuyengia-select"]');
        if (cb) {
          cb.checked = true;
          cb.dispatchEvent(new Event("change"));
        }
        const roleSelect = row.querySelector('select[name="tochuyengia-chucvu"]');
        const jobInput = row.querySelector('input[name="tochuyengia-congviec"]');
        if (roleSelect) roleSelect.value = item.chucVu || "Tổ viên";
        if (jobInput) jobInput.value = item.congViec || "";
      }
    });
    const savedToThamDinh = selectedCanceled.toThamDinh || [];
    document.querySelectorAll("#to-thamdinh-tbody tr").forEach((row) => {
      const cb = row.querySelector('input[name="tothamdinh-select"]');
      if (cb) {
        cb.checked = false;
        cb.dispatchEvent(new Event("change"));
      }
    });
    savedToThamDinh.forEach((item) => {
      const row = document.querySelector(`#to-thamdinh-tbody tr[data-expert-id="${item.chuyenGiaId}"]`);
      if (row) {
        const cb = row.querySelector('input[name="tothamdinh-select"]');
        if (cb) {
          cb.checked = true;
          cb.dispatchEvent(new Event("change"));
        }
        const roleSelect = row.querySelector('select[name="tothamdinh-chucvu"]');
        const jobInput = row.querySelector('input[name="tothamdinh-congviec"]');
        if (roleSelect) roleSelect.value = item.chucVu || "Tổ viên";
        if (jobInput) jobInput.value = item.congViec || "";
      }
    });
    this.enforceSingleLeader("to-chuyengia-tbody", "tochuyengia-chucvu");
    this.enforceSingleLeader("to-thamdinh-tbody", "tothamdinh-chucvu");
    if (this.updatePhuongPhapDanhGiaOptions) {
      this.updatePhuongPhapDanhGiaOptions();
    }
    document.getElementById("gt-phuongphapdanhgia").value = selectedCanceled.phuongPhapDanhGia || "";
    if (this.updateTrongSoKyThuatVisibility) {
      this.updateTrongSoKyThuatVisibility();
    }
    document.getElementById("gt-trongsokythuat").value = selectedCanceled.trongSoKyThuat !== void 0 && selectedCanceled.trongSoKyThuat !== null ? selectedCanceled.trongSoKyThuat : "";
    if (this.handleLinhVucChange) this.handleLinhVucChange();
    if (this.handleHinhThucChange) this.handleHinhThucChange();
    if (this.handleQuaMangChange) this.handleQuaMangChange();
    if (this.handlePhanLoChange) this.handlePhanLoChange();
    if (this.handleTuyChonMuaThemChange) this.handleTuyChonMuaThemChange();
    this.updatePackageFieldsVisibility(false);
  }
}
