const API_BASE = "https://muasamcong.mpi.gov.vn/o/egp-portal-contractor-selection-v2/services";


export const MSC_PROFILE_ID = "2026.08";


export const ENDPOINTS = Object.freeze({
  SEARCH: { path: "/smart/search", protected: true },
  PLAN_VERSION_LIST: {
    path: "/expose/lcnt/bid-po-bidp-plan-project-view/get-version-list",
    protected: false,
  },
  PLAN_DETAIL: {
    path: "/expose/lcnt/bid-po-bidp-plan-project-view/get-by-id",
    protected: true,
  },
  PLAN_PACKAGE_DETAIL: {
    path: "/lcnt/bid-po-bidp-plan-project-view/get-bidp-plan-detail-by-id",
    protected: true,
  },
  PROJECT_VERSION_LIST: {
    path: "/expose/lcnt/bid-po-bidp-project-view/get-version-list",
    protected: false,
  },
  PROJECT_DETAIL: {
    path: "/expose/lcnt/bid-po-bidp-project-view/get-by-id",
    protected: true,
  },
  NOTICE_LDT_VERSION_LIST: {
    path: "/expose/lcnt/bid-po-bido-notify-contractor-view/get-version-list",
    protected: false,
  },
  NOTICE_OTHER_VERSION_LIST: {
    path: "/expose/bid-no-contractor-out/get-version-list",
    protected: false,
  },
  NOTICE_LDT_DETAIL: {
    path: "/expose/lcnt/bid-po-bido-notify-contractor-view/get-by-id",
    protected: true,
  },
  NOTICE_OTHER_DETAIL: {
    path: "/expose/lcnt/bid-notify-contractor-out/get-by-id",
    protected: true,
  },
  NOTICE_ADB_DETAIL: {
    path: "/expose/lcnt/bid-notify-contractor-out-adb-wb/get-by-id",
    protected: true,
  },
  OPENING_NOTIFY: {
    path: "/exposeldtkqmt/bid-notification-p/notify",
    protected: true,
  },
  OPENING_ROUND: {
    path: "/expose/ldtkqmt/bid-notification-p/roundmng",
    protected: true,
  },
  OPENING_SUBMISSION: {
    path: "/expose/ldtkqmt/bid-notification-p/submission",
    protected: true,
  },
  OPENING_BID: {
    path: "/expose/ldtkqmt/bid-notification-p/bid-open",
    protected: true,
  },
  OPENING_LOT: {
    path: "/expose/ldtkqmt/bid-notification-p/lot-open",
    protected: true,
  },
  OPENING_LOT_DETAIL: {
    path: "/expose/ldtkqmt/bid-notification-p/lotOpenDetail",
    protected: true,
  },
  OPENING_FINANCIAL_DETAIL: {
    path: "/expose/ldtkqmt/bid-notification-p/get-by-id-v2",
    protected: true,
  },
  OPENING_FINANCIAL_AVAILABLE: {
    path: "/hsdxtc/is-opened",
    protected: false,
  },
  OPENING_OTHER: {
    path: "/expose/kqmt/bid-notify-contractor-out/get-by-id",
    protected: true,
  },
  OPENING_ADB: {
    path: "/expose/kqmt/bid-notify-contractor-out-adb-wb/get-by-id",
    protected: true,
  },
  SELECTION_RESULT: {
    path: "/expose/contractor-input-result/get",
    protected: true,
  },
  SELECTION_RESULT_OTHER: {
    path: "/expose/kqlcnt/bid-notify-contractor-out/get-by-id",
    protected: true,
  },
  TECHNICAL_RESULT: {
    path: "/ldtdsnt/tech-req-approval/get-by-id",
    protected: true,
  },
  SELECTION_RESULT_BY_BID_ID: {
    path: "/expose/contractor-input-result/get-by-bid-id",
    protected: true,
  },
  SELECTION_RESULT_DECISION: {
    path: "/expose/contractor-input-result/get-decision",
    protected: true,
  },
  SELECTION_RESULT_REPLACEMENT: {
    path: "/input-result-replace/get-result-replace",
    protected: true,
  },
  NOTICE_TENDER_INFO: { path: "/lcnt_tbmt_ttc_ldt", protected: true },
  NOTICE_TENDER_INFO_OTHER: {
    path: "/lcnt_tbmt_ttc_vk_adb",
    protected: true,
  },
  NOTICE_HSMT: { path: "/lcnt_tbmt_hsmt", protected: true },
  NOTICE_PETITION: { path: "/lcnt_tbmt_kn", protected: true },
  NOTICE_CLARIFICATION: { path: "/lcnt_tbmt_yclr", protected: true },
  NOTICE_PREBID_CONFERENCE: { path: "/lcnt_tbmt_hntdt", protected: true },
  NOTICE_PHASE_TWO: { path: "/get-notify-phase-two", protected: false },
  NOTICE_HSMT_PHASE_TWO: { path: "/get-hsmt-phase-two", protected: false },
  NOTICE_CONTRACT_LIST: {
    path: "/econsign/contract-info/list-contract-for-po",
    protected: true,
  },
  CONTRACT_DETAIL: {
    path: "/econsign/contract-info/detail-by-id-for-po",
    protected: true,
  },
  CONTRACT_LINKED: {
    path: "/get-linked-list-contract-po",
    protected: false,
  },
  // Compatibility aliases used by the standalone contract collector.
  CONTRACT_TENDER: { path: "/lcnt_tbmt_ttc_ldt", protected: true },
  CONTRACT_HSMT: { path: "/lcnt_tbmt_hsmt", protected: true },
  PLAN_OVERALL_DETAIL: {
    path: "/expose/lcnt/bid-plan-project-manage-overall/get-by-id",
    protected: true,
  },
  QUOTE_REQUEST_DETAIL: {
    path: "/expose/lcnt/bid-request-quote/get-by-id",
    protected: true,
  },
  PREQUALIFICATION_NOTICE_DETAIL: {
    path: "/expose/lcnt/bid-notify-prequalification/get-by-id",
    protected: true,
  },
  INTEREST_NOTICE_DETAIL: {
    path: "/expose/lcnt/bid-notify-interest/get-by-id",
    protected: true,
  },
  BIDO_INTEREST_NOTICE_DETAIL: {
    path: "/expose/lcnt/bid-bido-interest-notify/get-by-id",
    protected: true,
  },
  PREQUALIFICATION_OPENING_DETAIL: {
    path: "/expose/lcnt/bid-prequalification-open/get-by-id",
    protected: true,
  },
  INTEREST_OPENING_DETAIL: {
    path: "/expose/lcnt/bid-interest-open/get-by-id",
    protected: true,
  },
  PREQUALIFICATION_RESULT_DETAIL: {
    path: "/expose/lcnt/bid-prequalification-result/get-by-id",
    protected: true,
  },
  INTEREST_RESULT_DETAIL: {
    path: "/expose/lcnt/bid-interest-result/get-by-id",
    protected: true,
  },
  INPUT_RESULT_OTHER_DETAIL: {
    path: "/expose/lcnt/bid-bide-contractor-input-result-other/get-by-id",
    protected: true,
  },
  SHOPPING_RESULT_DETAIL: {
    path: "/expose/lcnt/bid-shopping-result/get-by-id",
    protected: true,
  },
  CONTRACT_PUBLISH_FRAME_DETAIL: {
    path: "/expose/lcnt/bid-ct-publish-frame/get-by-id",
    protected: true,
  },
});


export const ENDPOINT_PROFILES = Object.freeze({
  [MSC_PROFILE_ID]: ENDPOINTS,
});


export function resolveEndpoint(operation, profileId = MSC_PROFILE_ID) {
  const catalog = ENDPOINT_PROFILES[String(profileId || "").trim()];
  const endpoint = catalog?.[String(operation || "").trim().toUpperCase()];
  if (!endpoint) throw new Error("PROCUREMENT_ENDPOINT_CHANGED");
  return { ...endpoint, url: `${API_BASE}${endpoint.path}` };
}

