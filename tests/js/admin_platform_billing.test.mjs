import assert from "node:assert/strict";
import test from "node:test";

import { directoryQuery, directoryResultsMarkup, readDirectoryState } from "../../frontend/admin-platform/AdminDirectory.js";
import {
  formatMinorMoney,
  invoiceUnavailableMarkup,
  PAYMENT_DIRECTORY,
  SUBSCRIPTION_DIRECTORY,
} from "../../frontend/admin-platform/AdminBilling.js";

test("billing directories emit only supported bounded server controls", () => {
  const subscriptions = readDirectoryState(
    SUBSCRIPTION_DIRECTORY,
    "?page=2&pageSize=50&ownerKind=organization&status=active&source=order&sortBy=expires_at&sortDir=asc&fake=x",
  );
  assert.deepEqual(directoryQuery(subscriptions, SUBSCRIPTION_DIRECTORY), {
    page: 2, pageSize: 50, sortBy: "expires_at", sortDir: "asc",
    ownerKind: "organization", status: "active", source: "order",
  });
  const payments = readDirectoryState(PAYMENT_DIRECTORY, "?paymentState=verified_paid&transactionStatus=settled");
  assert.deepEqual(directoryQuery(payments, PAYMENT_DIRECTORY), {
    page: 1, pageSize: 25, sortBy: "created_at", sortDir: "desc",
    paymentState: "verified_paid", transactionStatus: "settled",
  });
});

test("subscription rows render real ownership and subscription values", () => {
  const state = readDirectoryState(SUBSCRIPTION_DIRECTORY, "");
  const markup = directoryResultsMarkup(SUBSCRIPTION_DIRECTORY, state, {
    items: [{
      owner: { kind: "organization", id: "org-a", name: "Alpha Org" },
      packageId: "business", planVersionId: "plan-v1", status: "active",
      source: "order", sourceOrderPublicId: "order-public-1",
      startsAt: 100, expiresAt: 4102444800, memberQuota: 20, updatedAt: "2026-01-02",
    }],
    pagination: { page: 1, totalPages: 1, totalRows: 1 },
  });
  assert.match(markup, /Alpha Org/u);
  assert.match(markup, /business/u);
  assert.match(markup, /order-public-1/u);
  assert.match(markup, />20</u);
});

test("payment rows preserve minor-unit currency semantics and real transaction states", () => {
  assert.match(formatMinorMoney(110000, "VND"), /110[.]000/u);
  assert.equal(formatMinorMoney(1234, "USD"), "12,34 US$");
  assert.equal(formatMinorMoney(1.5, "VND"), "N/A");
  const state = readDirectoryState(PAYMENT_DIRECTORY, "");
  const markup = directoryResultsMarkup(PAYMENT_DIRECTORY, state, {
    items: [{
      publicId: "order-public-1", owner: { kind: "account", id: "user-a", name: "Alpha" },
      operation: "purchase", amounts: { totalMinor: 110000, currency: "VND" },
      paymentState: "verified_paid", activationState: "applied", checkoutState: "open",
      provider: { name: "payos", reference: "provider-ref" }, createdAt: "2026-01-02",
      transactions: [{ type: "payment", status: "settled", verifiedPaidAmountMinor: 110000, currency: "VND", createdAt: "2026-01-02" }],
    }],
    pagination: { page: 1, totalPages: 1, totalRows: 1 },
  });
  assert.match(markup, /order-public-1/u);
  assert.match(markup, /110[.]000/u);
  assert.match(markup, /verified_paid/u);
  assert.match(markup, /settled/u);
});

test("invoice route explicitly renders unavailable state without invented records", () => {
  const markup = invoiceUnavailableMarkup();
  assert.match(markup, /Chưa có nguồn dữ liệu hóa đơn/u);
  assert.match(markup, /Không có số liệu giả/u);
  assert.doesNotMatch(markup, /data-admin-retry/u);
});
