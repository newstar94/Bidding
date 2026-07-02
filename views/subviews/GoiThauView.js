import { checkBidQualified, showPackageDetails } from './goithau/GoiThauDetail.js';
import { renderGoiThauTable } from './goithau/GoiThauTable.js';
import { renderExcelPreview, populatePhathanhHsmtForm, getPhathanhHsmtFormData, isGoiThauDetailTabActive, getGoiThauFormInputValues } from './goithau/GoiThauModals.js';

// Bind to window for HTML inline event handlers compatibility
window.checkBidQualified = checkBidQualified;
window.showPackageDetails = showPackageDetails;
window.renderGoiThauTable = renderGoiThauTable;
window.renderExcelPreview = renderExcelPreview;
window.populatePhathanhHsmtForm = populatePhathanhHsmtForm;
window.getPhathanhHsmtFormData = getPhathanhHsmtFormData;
window.isGoiThauDetailTabActive = isGoiThauDetailTabActive;
window.getGoiThauFormInputValues = getGoiThauFormInputValues;

export {
    checkBidQualified,
    showPackageDetails,
    renderGoiThauTable,
    renderExcelPreview,
    populatePhathanhHsmtForm,
    getPhathanhHsmtFormData,
    isGoiThauDetailTabActive,
    getGoiThauFormInputValues
};



