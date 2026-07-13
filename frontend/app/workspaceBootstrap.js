import { BiddingModel } from "./BiddingModel.js";
import { BiddingView } from "./BiddingView.js";
import { BiddingController } from "./BiddingController.js";
import * as Auth from "../auth/AuthController.js";
import * as MainUI from "./BiddingControllerUI.js";
import * as MainForms from "./BiddingControllerForms.js";
import * as MainSync from "./BiddingControllerSync.js";
import * as IntegrationBridges from "./IntegrationWorkflowBridges.js";
import { installPrototypeModules } from "./moduleRegistry.js";
import { installAdminModule } from "./adminModuleLoader.js";
export async function bootstrapWorkspace(initialSession) {
  const effectiveRoles = initialSession?.user?.effective_roles || [];
  const needsAdmin = effectiveRoles.some((role) => ["manager", "super_admin"].includes(role));
  const Admin = needsAdmin ? await installAdminModule(BiddingController) : {
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
