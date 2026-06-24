/* ==========================================================================
   BiddingFlow - Bootstrap entry point
   ========================================================================== */

import { BiddingModel } from '/models/BiddingModel.js?v=6.10';
import { BiddingView } from '/views/BiddingView.js?v=6.10';
import { BiddingController } from '/controllers/BiddingController.js?v=6.10';

window.addEventListener('DOMContentLoaded', () => {
    const model = new BiddingModel();
    const view = new BiddingView(model);
    const controller = new BiddingController(model, view);

    controller.init();
});
