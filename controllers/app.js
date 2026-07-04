/* ==========================================================================
   BiddingFlow - Bootstrap entry point
   ========================================================================== */

window.__BF_APP_DEBUG__ = document.querySelector('meta[name="bf-app-debug"]')?.content === 'true';

import { BiddingModel } from '/models/BiddingModel.js';
import { BiddingView } from '/views/core/BiddingView.js';
import { BiddingController } from '/controllers/core/BiddingController.js';

import * as Auth from '/controllers/auth/AuthController.js';
import * as Admin from '/controllers/admin/AdminUserController.js';
import * as Bidding from '/controllers/workflows/BiddingWorkflows.js';
import * as Partner from '/controllers/workflows/PartnerWorkflows.js';
import * as MainUI from '/controllers/main_controller/BiddingControllerUI.js';
import * as MainForms from '/controllers/main_controller/BiddingControllerForms.js';
import * as MainSync from '/controllers/main_controller/BiddingControllerSync.js';

const syncSessionBetweenTabs = () => {
    return Promise.resolve();
};

window.addEventListener('DOMContentLoaded', async () => {
    if ('serviceWorker' in navigator && window.__BF_APP_DEBUG__ === false) {
        navigator.serviceWorker.register('/service-worker.js').catch(() => { });
    }

    // Sync session from other tabs first if possible
    await syncSessionBetweenTabs();

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

