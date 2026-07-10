/* ==========================================================================
   BiddingFlow - Bootstrap entry point
   ========================================================================== */

window.__BF_APP_DEBUG__ = document.querySelector('meta[name="bf-app-debug"]')?.content === 'true';
window.lucide = window.lucide || { createIcons: () => { } };

import { BiddingModel } from '/models/BiddingModel.js';
import { BiddingView } from '/views/core/BiddingView.js';
import { BiddingController } from '/controllers/core/BiddingController.js';

import * as Auth from '/controllers/auth/AuthController.js';
import * as Admin from '/controllers/admin/AdminUserController.js';
import * as MainUI from '/controllers/main_controller/BiddingControllerUI.js';
import * as MainForms from '/controllers/main_controller/BiddingControllerForms.js';
import * as MainSync from '/controllers/main_controller/BiddingControllerSync.js';

const syncSessionBetweenTabs = () => {
    return Promise.resolve();
};

const loadLucideIcons = () => new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-bf-lucide]');
    if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
    }

    const script = document.createElement('script');
    script.src = '/vendor/lucide/lucide.min.js?v=1.21.0';
    script.async = true;
    script.dataset.bfLucide = 'true';
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', reject, { once: true });
    document.head.appendChild(script);
});

window.addEventListener('DOMContentLoaded', async () => {
    if ('serviceWorker' in navigator && window.__BF_APP_DEBUG__ === false) {
        navigator.serviceWorker.register('/service-worker.js').catch(() => { });
    }

    // Sync session from other tabs first if possible
    await syncSessionBetweenTabs();

    // Extend prototype ONCE before any instance is created
    Object.assign(BiddingController.prototype, {
        ...Auth, ...Admin,
        ...MainUI, ...MainForms, ...MainSync
    });

    const model = new BiddingModel();
    const view = new BiddingView(model);
    const controller = new BiddingController(model, view);

    await controller.init();

    requestAnimationFrame(() => {
        loadLucideIcons()
            .then(() => window.lucide?.createIcons?.())
            .catch(err => console.warn('Lucide icons could not be loaded:', err));
    });
});

