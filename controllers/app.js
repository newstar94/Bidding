/* ==========================================================================
   BiddingFlow - Bootstrap entry point
   ========================================================================== */

import { BiddingModel } from '/models/BiddingModel.js?v=5.8';
import { BiddingView } from '/views/BiddingView.js?v=5.8';
import { BiddingController } from '/controllers/BiddingController.js?v=5.8';

window.addEventListener('DOMContentLoaded', () => {
    const model = new BiddingModel();
    const view = new BiddingView(model);
    const controller = new BiddingController(model, view);
    
    controller.init();
});
