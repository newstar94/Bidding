/* ==========================================================================
   BiddingFlow - Bootstrap entry point
   ========================================================================== */

import { BiddingModel } from '/models/BiddingModel.js';
import { BiddingView } from '/views/core/BiddingView.js';
import { BiddingController } from '/controllers/core/BiddingController.js';

// Kick off all chunk downloads immediately at module-evaluation time
// (parallel network requests start before DOM is even ready)
const _modulesPromise = Promise.all([
    import('/controllers/auth/AuthController.js'),
    import('/controllers/admin/AdminUserController.js'),
    import('/controllers/workflows/BiddingWorkflows.js'),
    import('/controllers/workflows/PartnerWorkflows.js'),
    import('/controllers/main_controller/BiddingControllerUI.js'),
    import('/controllers/main_controller/BiddingControllerForms.js'),
    import('/controllers/main_controller/BiddingControllerSync.js'),
]);

window.addEventListener('DOMContentLoaded', async () => {
    // Await modules (likely already resolved by the time DOM fires)
    const [Auth, Admin, Bidding, Partner, MainUI, MainForms, MainSync] = await _modulesPromise;

    // Extend prototype ONCE before any instance is created
    Object.assign(BiddingController.prototype, {
        ...Auth, ...Admin, ...Bidding, ...Partner,
        ...MainUI, ...MainForms, ...MainSync
    });

    const model = new BiddingModel();
    const view = new BiddingView(model);
    const controller = new BiddingController(model, view);

    controller.init();
});
