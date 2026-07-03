/* ==========================================================================
   BiddingFlow - Bootstrap entry point
   ========================================================================== */

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
    return new Promise((resolve) => {
        if (sessionStorage.getItem('bf_session_token')) {
            resolve();
            return;
        }
        if (localStorage.getItem('bf_remember_me') === 'true' && localStorage.getItem('bf_session_token')) {
            resolve();
            return;
        }

        const channel = new BroadcastChannel('bf_session_sync');
        let resolved = false;

        const timer = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                channel.close();
                resolve();
            }
        }, 150);

        channel.onmessage = (event) => {
            if (event.data && event.data.type === 'PROVIDE_SESSION') {
                if (event.data.token && event.data.username) {
                    sessionStorage.setItem('bf_session_token', event.data.token);
                    sessionStorage.setItem('bf_username', event.data.username);
                    if (event.data.userId) {
                        sessionStorage.setItem('bf_user_id', event.data.userId);
                    }
                }
                clearTimeout(timer);
                resolved = true;
                channel.close();
                resolve();
            }
        };

        channel.postMessage({ type: 'REQUEST_SESSION' });
    });
};

window.addEventListener('DOMContentLoaded', async () => {
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

