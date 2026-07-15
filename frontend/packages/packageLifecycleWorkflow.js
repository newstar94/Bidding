import { deleteAllPackageVersions, deleteLatestPackageVersion, getPackageDeleteContext } from "./packageDeleteHelpers.js";
import { persistAndSync } from "../shared/MutationService.js";

export function openPackageWizardStep() {
  if (!this.packageWizard.active) return;
  if (!document.getElementById("modal-goithau")) {
    this.ensureLazyModal?.("modal-goithau").then(() => this.openPackageWizardStep());
    return;
  }
  this.editGoiThau(null);
  const titleEl = document.getElementById("modal-goithau-title");
  if (titleEl) {
    titleEl.innerHTML = `Thêm Gói thầu <span style="font-size: 0.85rem; color: var(--primary); font-weight: normal; margin-left: 8px;">(Gói thầu số ${this.packageWizard.currentCount} trên tổng số ${this.packageWizard.totalCount})</span>`;
  }
  const planSelect = document.getElementById("gt-kehoachid");
  if (planSelect) {
    planSelect.value = this.packageWizard.planId;
    planSelect.disabled = true;
    planSelect.dispatchEvent(new Event("change"));
  }
}
export async function deleteGoiThau(id) {
  const deleteContext = getPackageDeleteContext(this.model.state.goithau, id);
  if (!deleteContext) return;
  let deleteConfirmed = false;
  let deleteChoice = null;
  if (deleteContext.versionCount >= 2) {
    deleteChoice = await this.view.customVersionDeleteChoice(
      "Xác nhận xóa",
      `Gói thầu "${deleteContext.targetPackage.tenGoiThau}" có ${deleteContext.versionCount} phiên bản. Vui lòng chọn cách thức xóa:`,
      "Xóa phiên bản gần nhất",
      "Xóa toàn bộ"
    );
    if (deleteChoice === null) return;
  } else {
    const confirmed = await this.view.customConfirm(
      "Xác nhận xóa",
      "Bạn có chắc muốn xóa gói thầu này? Mọi phiên bản lịch sử liên quan sẽ bị xóa bỏ.",
      "trash-2"
    );
    if (!confirmed) return;
    deleteConfirmed = true;
  }
  if (deleteChoice === 1) {
    deleteLatestPackageVersion(this.model, deleteContext);
    deleteContext.planIds.forEach((pId) => {
      if (pId) {
        this.recalculatePlanTotal(pId);
      }
    });
    const breakdownPlanId = document.getElementById("breakdown-plan-id")?.value;
    const modalBreakdown = document.getElementById("modal-plan-breakdown");
    if (modalBreakdown && modalBreakdown.classList.contains("active") && breakdownPlanId) {
      this.renderBreakdownPackagesList(breakdownPlanId);
      this.updateBreakdownTotal(breakdownPlanId);
    }
    try {
      const syncResult = await persistAndSync(this, ["goithau", "thongtinmothau", "kehoach"], {
        afterPersist: () => {
          this.view.renderGoiThauTable();
          this.view.renderKeHoachTable();
        }
      });
      if (!syncResult?.ok) {
        await this.view.customAlert("Chưa đồng bộ", "Thao tác xóa đang được giữ trong hàng chờ đồng bộ. Vui lòng kiểm tra kết nối và đồng bộ lại dữ liệu.", "alert-triangle");
        return;
      }
    } catch (e) {
      await this.view.customAlert("Lỗi đồng bộ", "Gói thầu đã xóa khỏi giao diện nhưng có lỗi khi đồng bộ với cơ sở dữ liệu. Thao tác xóa vẫn được giữ trong hàng chờ đồng bộ.", "x-circle");
      return;
    }
    await this.view.customAlert("Thành công", "Đã xóa phiên bản gói thầu gần nhất!", "check-circle");
  } else if (deleteChoice === 2 || deleteConfirmed) {
    deleteAllPackageVersions(this.model, deleteContext);
    deleteContext.planIds.forEach((pId) => {
      if (pId) {
        this.recalculatePlanTotal(pId);
      }
    });
    const breakdownPlanId = document.getElementById("breakdown-plan-id")?.value;
    const modalBreakdown = document.getElementById("modal-plan-breakdown");
    if (modalBreakdown && modalBreakdown.classList.contains("active") && breakdownPlanId) {
      this.renderBreakdownPackagesList(breakdownPlanId);
      this.updateBreakdownTotal(breakdownPlanId);
    }
    try {
      const syncResult = await persistAndSync(this, ["goithau", "thongtinmothau", "kehoach"], {
        afterPersist: () => {
          this.view.renderGoiThauTable();
          this.view.renderKeHoachTable();
        }
      });
      if (!syncResult?.ok) {
        await this.view.customAlert("Chưa đồng bộ", "Thao tác xóa đang được giữ trong hàng chờ đồng bộ. Vui lòng kiểm tra kết nối và đồng bộ lại dữ liệu.", "alert-triangle");
        return;
      }
    } catch (e) {
      await this.view.customAlert("Lỗi đồng bộ", "Gói thầu đã xóa khỏi giao diện nhưng có lỗi khi đồng bộ với cơ sở dữ liệu. Thao tác xóa vẫn được giữ trong hàng chờ đồng bộ.", "x-circle");
      return;
    }
    await this.view.customAlert("Thành công", "Đã xóa toàn bộ các phiên bản của gói thầu!", "check-circle");
  }
}

