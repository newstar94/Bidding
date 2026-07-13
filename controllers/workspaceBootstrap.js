import { BiddingModel } from "/models/BiddingModel.js";
import { BiddingView } from "/views/core/BiddingView.js";
import { BiddingController } from "/controllers/core/BiddingController.js";
import * as Auth from "/controllers/auth/AuthController.js";
import * as MainUI from "/controllers/main_controller/BiddingControllerUI.js";
import * as MainForms from "/controllers/main_controller/BiddingControllerForms.js";
import * as MainSync from "/controllers/main_controller/BiddingControllerSync.js";
import * as IntegrationBridges from "/controllers/workflows/IntegrationWorkflowBridges.js";
import { installPrototypeModules } from "/controllers/core/moduleRegistry.js";
export async function bootstrapWorkspace(initialSession) {
  const effectiveRoles = initialSession?.user?.effective_roles || [];
  const needsAdmin = effectiveRoles.some((role) => ["manager", "super_admin"].includes(role));
  const Admin = needsAdmin ? await import("/controllers/admin/AdminUserController.js") : {
    setupRBACEvents() {
    }
  };
  installPrototypeModules(BiddingController, [
    { name: "auth", module: Auth },
    { name: "admin", module: Admin },
    { name: "main-ui", module: MainUI },
    { name: "main-forms", module: MainForms },
    { name: "main-sync", module: MainSync },
    { name: "integration-bridges", module: IntegrationBridges },
  ]);
  const model = new BiddingModel();
  const view = new BiddingView(model);
  const controller = new BiddingController(model, view);
  controller._initialSessionData = initialSession;
  await controller.init();
}
