export const POST_STARTUP_INTERACTION_GRACE_MS = 6000;

export const POST_STARTUP_TIMING = Object.freeze({
  // These tasks are released only after the authoritative route pull.  Adding
  // another multi-second grace here made authenticated data remain cold long
  // after the shell was already interactive.
  primaryTabWarm: 0,
  referenceData: 750,
  // The model dispatches the actual IndexedDB work through requestIdleCallback.
  // BiddingController additionally waits for reconciliation before invoking
  // that dispatcher, avoiding concurrent startup reads and snapshot writes.
  remainingStorageHydration: 0,
  holidayData: POST_STARTUP_INTERACTION_GRACE_MS + 1000,
  notificationCenter: POST_STARTUP_INTERACTION_GRACE_MS + 10000,
  primaryModalPreload: POST_STARTUP_INTERACTION_GRACE_MS + 12000,
  // The assistant trigger is part of the shell's visible affordances. Load
  // its small config/module as soon as the first frame is interactive; the
  // panel and conversation data remain lazy until the user opens it.
  assistant: 0,
});

export const FIRST_TAB_WARM_SETTLE_MS = POST_STARTUP_TIMING.primaryTabWarm + 5000;
