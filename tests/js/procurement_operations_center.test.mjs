import assert from "node:assert/strict";
import test from "node:test";

import {
  availableCaseActions,
  normalizeCalendarConnections,
  normalizeCalendarDeliveries,
  normalizeCaseFilters,
} from "../../frontend/procurement-cases/ProcurementOperationsCenter.js";


test("case center only renders server-declared known actions", () => {
  assert.deepEqual(availableCaseActions({
    availableActions: ["APPROVE", "SET_STATE", "ISSUE"],
  }), ["APPROVE", "ISSUE"]);
  assert.deepEqual(availableCaseActions({}), []);
});


test("case center normalizes filters without role inference", () => {
  assert.deepEqual(normalizeCaseFilters({
    caseType: "PETITION", state: " APPROVED ", role: "super_admin",
  }), { caseType: "PETITION", state: "APPROVED" });
  assert.deepEqual(normalizeCaseFilters({ caseType: "UNKNOWN" }), {
    caseType: "", state: "",
  });
});


test("calendar connection UI keeps only the approved public status contract", () => {
  assert.deepEqual(normalizeCalendarConnections({ connections: [{
    id: "connection-1", provider: "GOOGLE", calendarId: "primary",
    accountLabel: "primary", status: "ACTIVE",
    scopes: ["https://www.googleapis.com/auth/calendar.events"],
    outboundProfileVersion: "WORK_CALENDAR_OUTBOUND_V1",
    tokenExpiresAt: 1800003600, consentedAt: 1800000000,
    token_ciphertext: "must-not-reach-ui",
  }, { id: "connection-2", provider: "UNKNOWN", status: "ACTIVE" }] }), [{
    id: "connection-1", provider: "GOOGLE", calendarId: "primary",
    accountLabel: "primary", status: "ACTIVE",
    scopes: ["https://www.googleapis.com/auth/calendar.events"],
    outboundProfileVersion: "WORK_CALENDAR_OUTBOUND_V1",
    tokenExpiresAt: 1800003600, consentedAt: 1800000000,
  }]);
});


test("calendar delivery status exposes retry-safe operational fields only", () => {
  assert.deepEqual(normalizeCalendarDeliveries({ deliveries: [{
    id: "delivery-1", connectionId: "connection-1", provider: "GOOGLE",
    action: "UPSERT", status: "FAILED", attemptCount: 5,
    lastErrorCode: "CALENDAR_PROVIDER_EVENT_UPSERT_FAILED", eventSequence: 2,
    createdAt: 1800000000, updatedAt: 1800000010,
    payload_json: "must-not-reach-ui",
  }] }), [{
    id: "delivery-1", connectionId: "connection-1", provider: "GOOGLE",
    action: "UPSERT", status: "FAILED", attemptCount: 5,
    lastErrorCode: "CALENDAR_PROVIDER_EVENT_UPSERT_FAILED", eventSequence: 2,
    createdAt: 1800000000, updatedAt: 1800000010,
  }]);
});
