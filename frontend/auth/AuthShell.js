import * as Auth from "./AuthController.js";
const STORAGE_KEYS = {
  CHUDAUTU: "bf_chudautu",
  NHATHAU: "bf_nhathau",
  CHUYENGIA: "bf_chuyengia",
  KEHOACH: "bf_kehoach",
  GOITHAU: "bf_goithau",
  HOPDONG: "bf_hopdong",
  THEME: "bf_dark_mode",
  ACTIVEROLE: "bf_active_role",
  ACTIVEUSER: "bf_active_user",
  ORGANIZATIONS: "bf_organizations",
  EMPLOYEES: "bf_employees",
  PERMISSIONMATRIX: "bf_permission_matrix",
  CUSTOMCONTRACTSTATUSES: "bf_custom_contract_statuses",
  ASSIGNMENTS: "bf_assignments",
  SYSTEMPACKAGES: "bf_system_packages",
  THONGTINMOTHAU: "bf_thong_tin_mo_thau"
};
function createAuthModel() {
  return {
    STORAGE_KEYS,
    state: {
      chudautu: [],
      nhathau: [],
      chuyengia: [],
      kehoach: [],
      goithau: [],
      hopdong: [],
      thongtinmothau: []
    },
    clearSessionData() {
      Object.entries(STORAGE_KEYS).forEach(([key, storageKey]) => {
        if (key !== "THEME") {
          localStorage.removeItem(storageKey);
          sessionStorage.removeItem(storageKey);
        }
      });
      ["bf_username", "bf_user_id"].forEach((key) => {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      });
      localStorage.removeItem("bf_remember_me");
    }
  };
}
export async function bootstrapAuthShell(initialSession = { valid: false }) {
  const model = createAuthModel();
  const view = {
    updateActiveUserProfileDisplay() {
    },
    showToast(title, message) {
      console.warn(title, message);
    },
    async customAlert(title, message) {
      window.alert(`${title}

${message}`);
    },
    async customPrompt(...args) {
      const { BiddingView } = await import("../app/BiddingView.js");
      const dialogView = new BiddingView(model);
      return dialogView.customPrompt(...args);
    }
  };
  const controller = {
    model,
    view,
    routeMap: {
      "goithau-detail": "goi-thau-chi-tiet",
      "kehoach-detail": "ke-hoach-chi-tiet",
      "hopdong-detail": "hop-dong-chi-tiet",
      "chudautu-detail": "chu-dau-tu-chi-tiet",
      "nhathau-detail": "nha-thau-chi-tiet"
    },
    _initialSessionData: initialSession,
    _workspaceDeferredUntilReload: true
  };
  Object.assign(controller, Auth);
  setAppController(controller);
  controller.setupAuth();
}
import { setAppController } from "../app/controllerRef.js";
