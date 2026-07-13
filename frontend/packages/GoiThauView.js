import { renderGoiThauTable } from "./GoiThauTable.js";
import { renderExcelPreview, populatePhathanhHsmtForm, getPhathanhHsmtFormData, isGoiThauDetailTabActive, getGoiThauFormInputValues } from "./GoiThauModals.js";
const loadGoiThauDetail = () => import("./GoiThauDetail.js");
export async function checkBidQualified(...args) {
  const mod = await loadGoiThauDetail();
  return mod.checkBidQualified(...args);
}
export async function showPackageDetails(...args) {
  const mod = await loadGoiThauDetail();
  return mod.showPackageDetails.apply(this, args);
}
export {
  renderGoiThauTable,
  renderExcelPreview,
  populatePhathanhHsmtForm,
  getPhathanhHsmtFormData,
  isGoiThauDetailTabActive,
  getGoiThauFormInputValues
};
