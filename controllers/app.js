/* ==========================================================================
   BiddingFlow - Bootstrap entry point
   ========================================================================== */

import { BiddingModel } from '/models/BiddingModel.js?v=6.12';
import { BiddingView } from '/views/core/BiddingView.js?v=6.12';
import { BiddingController } from '/controllers/core/BiddingController.js?v=6.12';

window.addEventListener('DOMContentLoaded', () => {
    const model = new BiddingModel();
    const view = new BiddingView(model);
    const controller = new BiddingController(model, view);

    controller.init();
});
