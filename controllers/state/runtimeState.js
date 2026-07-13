let holidays = null;
let contractorViewOnly = false;
let unifiedSelectListenerRegistered = false;
const lotWinners = Object.create(null);

export const getHolidays = () => holidays || {};
export const hasHolidays = () => holidays !== null;
export const setHolidays = (value) => { holidays = value || {}; };

export const getContractorViewOnly = () => contractorViewOnly;
export const setContractorViewOnly = (value) => { contractorViewOnly = !!value; };
export const getLotWinnersStore = () => lotWinners;
export const hasUnifiedSelectListener = () => unifiedSelectListenerRegistered;
export const markUnifiedSelectListenerRegistered = () => { unifiedSelectListenerRegistered = true; };
