import assert from "node:assert/strict";
import test from "node:test";
import DOMPurify from "../../node_modules/dompurify/dist/purify.es.mjs";

import { directoryQuery, directoryResultsMarkup, readDirectoryState } from "../../frontend/admin-platform/AdminDirectory.js";
import {
  adminValueDialogMarkup,
  formatMinorMoney,
  executePaymentAction,
  invoiceRequestDetailMarkup,
  invoiceRequestSummaryMarkup,
  invoiceUnavailableMarkup,
  INVOICE_DIRECTORY,
  paymentDetailMarkup,
  PAYMENT_DIRECTORY,
  requestAdminValue,
  subscriptionDetailMarkup,
  SUBSCRIPTION_DIRECTORY,
} from "../../frontend/admin-platform/AdminBilling.js";

test("admin value dialog supports input and confirmation-only modes", () => {
  const inputMarkup = adminValueDialogMarkup({
    title: "Lý do", message: "Nhập lý do", label: "Lý do",
  });
  assert.match(inputMarkup, /<input[^>]+name="value"/u);
  assert.match(inputMarkup, /id="admin-prompt-title"/u);

  const confirmMarkup = adminValueDialogMarkup({
    title: "Nhân bản", message: "Tạo bản nháp?", label: null, confirmLabel: "Nhân bản",
  });
  assert.doesNotMatch(confirmMarkup, /<input/u);
  assert.match(confirmMarkup, />Nhân bản<\/button>/u);
});

test("admin value dialog closes on Escape and restores opener focus", async () => {
  const previousDocument = globalThis.document;
  const previousIsSupported = DOMPurify.isSupported;
  const previousSanitize = DOMPurify.sanitize;
  const opener = { focused: false, focus() { this.focused = true; } };
  const listeners = new Map();
  const form = {
    addEventListener(type, listener) { listeners.set(`form:${type}`, listener); },
    reportValidity() { return true; },
  };
  const input = { value: "", focus() {} };
  const cancel = { addEventListener(type, listener) { listeners.set(`cancel:${type}`, listener); } };
  const submit = { focus() {} };
  const modal = {
    style: {},
    removed: false,
    setAttribute() {},
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    querySelector(selector) {
      if (selector === "form") return form;
      if (selector === "input[name='value']") return input;
      if (selector === "[data-admin-prompt-cancel]") return cancel;
      if (selector === "button[type='submit']") return submit;
      return null;
    },
    querySelectorAll() { return [cancel, submit]; },
    contains() { return false; },
    remove() { this.removed = true; },
  };
  globalThis.document = {
    activeElement: opener,
    body: { append(node) { assert.equal(node, modal); } },
    createElement() { return modal; },
  };
  DOMPurify.isSupported = true;
  DOMPurify.sanitize = (value) => String(value);
  try {
    const pending = requestAdminValue({ title: "Xác nhận", message: "Tiếp tục?", label: null });
    let prevented = false;
    listeners.get("keydown")({ key: "Escape", preventDefault() { prevented = true; } });
    assert.equal(await pending, null);
    assert.equal(prevented, true);
    assert.equal(modal.removed, true);
    assert.equal(opener.focused, true);
    assert.equal(listeners.has("keydown"), false);
  } finally {
    globalThis.document = previousDocument;
    DOMPurify.isSupported = previousIsSupported;
    DOMPurify.sanitize = previousSanitize;
  }
});

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
  const invoices = readDirectoryState(INVOICE_DIRECTORY, "?status=issued&ownerKind=account&pageSize=100&unknown=x");
  assert.deepEqual(directoryQuery(invoices, INVOICE_DIRECTORY), {
    page: 1, pageSize: 100, sortBy: "created_at", sortDir: "desc",
    ownerKind: "account", status: "issued",
  });
});

test("payment action confirms and retries exactly once after privileged reauthentication", async () => {
  const requests = [];
  const prompts = ["Đã kiểm tra đối soát", "correct-password"];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === "/api/auth/csrf-token") {
      return new Response(JSON.stringify({ csrf_token: "csrf-test-token" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/reconcile") && requests.filter((item) => item.url.endsWith?.("/reconcile")).length === 1) {
      return new Response(JSON.stringify({ error: "Cần xác thực lại mật khẩu để thực hiện thao tác quản trị nhạy cảm.", code: "FORBIDDEN" }), {
        status: 403, headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  };
  let confirmations = 0;
  const result = await executePaymentAction("reconcile", { publicId: "order-public-1" }, {
    fetchImpl,
    confirmImpl: async () => { confirmations += 1; return true; },
    requestValue: async () => prompts.shift(),
  });
  assert.equal(confirmations, 1);
  assert.match(result.message, /đối soát/u);
  assert.deepEqual(requests.filter((item) => item.url.endsWith?.("/reconcile")).map((item) => JSON.parse(item.options.body)), [
    { reason: "Đã kiểm tra đối soát" },
    { reason: "Đã kiểm tra đối soát" },
  ]);
  assert.deepEqual(JSON.parse(requests.find((item) => item.url === "/api/auth/privileged-reauth").options.body), { password: "correct-password" });
});

test("refund action preserves minor-unit input and one idempotency key across privileged retry", async () => {
  const requests = [];
  const prompts = ["12500", "Hoàn thủ công đã xác minh", "correct-password"];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === "/api/auth/csrf-token") {
      return new Response(JSON.stringify({ csrf_token: "csrf-test-token" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/refund") && requests.filter((item) => item.url.endsWith?.("/refund")).length === 1) {
      return new Response(JSON.stringify({ error: "Cần xác thực lại mật khẩu để thực hiện thao tác quản trị nhạy cảm.", code: "FORBIDDEN" }), {
        status: 403, headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ replayed: false }), {
      status: 201, headers: { "Content-Type": "application/json" },
    });
  };
  await executePaymentAction("refund", {
    publicId: "order-public-1", amounts: { currency: "VND" }, paymentState: "verified_paid",
  }, {
    fetchImpl,
    confirmImpl: async () => true,
    requestValue: async () => prompts.shift(),
    idempotencyKey: "admin-refund:stable-test",
  });
  const refunds = requests.filter((item) => item.url.endsWith?.("/refund"));
  assert.deepEqual(refunds.map((item) => JSON.parse(item.options.body)), [
    { amount: 12500, reason: "Hoàn thủ công đã xác minh" },
    { amount: 12500, reason: "Hoàn thủ công đã xác minh" },
  ]);
  assert.deepEqual(refunds.map((item) => new Headers(item.options.headers).get("Idempotency-Key")), [
    "admin-refund:stable-test", "admin-refund:stable-test",
  ]);
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
  assert.match(markup, /data-admin-billing-detail="organization:org-a"/u);
  const detail = subscriptionDetailMarkup({
    owner: { kind: "organization", id: "org-a", name: "Alpha Org" },
    packageId: "business", planVersionId: "plan-v1", status: "active",
    source: "order", sourceOrderPublicId: "order-public-1",
    startsAt: 100, expiresAt: 4102444800, memberQuota: 20, revision: 3,
    createdAt: "2026-01-01", updatedAt: "2026-01-02",
  });
  assert.match(detail, /Dòng thời gian đăng ký/u);
  assert.match(detail, /order-public-1/u);
  assert.match(detail, /Revision/u);
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
      transactions: [{ id: "tx-1", type: "payment", status: "settled", verifiedPaidAmountMinor: 110000, currency: "VND", createdAt: "2026-01-02", invoiceRequest: { id: "invoice-1", status: "issued" } }],
    }],
    pagination: { page: 1, totalPages: 1, totalRows: 1 },
  });
  assert.match(markup, /order-public-1/u);
  assert.match(markup, /110[.]000/u);
  assert.match(markup, /verified_paid/u);
  assert.match(markup, /settled/u);
  assert.match(markup, /Mã thanh toán:[\s\S]*tx-1/u);
  assert.match(markup, /Hóa đơn:[\s\S]*invoice-1/u);
  assert.match(markup, /data-admin-billing-detail="order-public-1"/u);
  const detail = paymentDetailMarkup({
    publicId: "order-public-1", owner: { kind: "account", id: "user-a", name: "Alpha" },
    operation: "purchase", amounts: { subtotalMinor: 100000, taxMinor: 10000, totalMinor: 110000, currency: "VND" },
    paymentState: "verified_paid", activationState: "applied", checkoutState: "open",
    provider: { name: "payos", environment: "live", reference: "provider-ref" },
    createdAt: "2026-01-01", updatedAt: "2026-01-02", checkoutExpiresAt: 4102444800,
    transactions: [{ id: "tx-1", providerTransactionId: "provider-tx", type: "payment", status: "settled", verifiedPaidAmountMinor: 110000, currency: "VND", providerOccurredAt: 1500, createdAt: "2026-01-02", invoiceRequest: { id: "invoice-1", status: "issued" } }],
  });
  assert.match(detail, /Dòng thời gian đơn hàng/u);
  assert.match(detail, /Giao dịch thanh toán/u);
  assert.match(detail, /provider-tx/u);
  assert.match(detail, /Mã đơn hàng[\s\S]*order-public-1/u);
  assert.match(detail, /Hóa đơn[\s\S]*invoice-1/u);
  assert.match(detail, /110[.]000/u);
});

test("invoice directory and detail render authoritative request facts without invented document", () => {
  const request = {
    id: "invoice-request-1", status: "issued",
    owner: { kind: "organization", id: "org-a", name: "Alpha Org" },
    orderPublicId: "order-public-1",
    amounts: { orderTotalMinor: 110000, verifiedPaidMinor: 110000, currency: "VND" },
    paymentTransaction: { id: "tx-1", providerTransactionId: "provider-tx", status: "settled", providerOccurredAt: 1500, createdAt: "2026-01-02" },
    provider: { name: "payos", environment: "live", invoiceReference: "provider-invoice-ref" },
    attemptCount: 1, createdAt: "2026-01-02", updatedAt: "2026-01-04", documentAvailable: false,
  };
  const state = readDirectoryState(INVOICE_DIRECTORY, "");
  const markup = directoryResultsMarkup(INVOICE_DIRECTORY, state, {
    items: [request],
    summary: {
      requestCount: 1, totalRequestedMinor: 110000, currency: "VND",
      requestedCount: 0, issuedCount: 1, failedCount: 0,
    },
    pagination: { page: 1, totalPages: 1, totalRows: 1 },
  });
  assert.match(markup, /invoice-request-1/u);
  assert.match(markup, /provider-invoice-ref/u);
  assert.match(markup, /110[.]000/u);
  assert.match(markup, /data-admin-billing-detail="invoice-request-1"/u);
  assert.match(markup, /Tổng hợp yêu cầu hóa đơn/u);
  assert.match(markup, /Tổng yêu cầu[\s\S]*>1</u);
  assert.match(markup, /Đã phát hành[\s\S]*>1</u);
  assert.match(markup, /không suy diễn công nợ, quá hạn hoặc hoàn tiền/u);
  const detail = invoiceRequestDetailMarkup({
    invoiceRequest: request,
    notice: "Đây là dữ liệu yêu cầu phát hành hóa đơn; chưa có tài liệu tải xuống.",
  });
  assert.match(detail, /Yêu cầu phát hành hóa đơn/u);
  assert.match(detail, /provider-tx/u);
  assert.match(detail, /provider-invoice-ref/u);
  assert.match(detail, /Chưa có mô hình tài liệu hóa đơn/u);
  assert.doesNotMatch(detail, /PDF|Số hóa đơn/u);
  const noticeMarkup = invoiceUnavailableMarkup();
  assert.match(noticeMarkup, /không phải tài liệu hóa đơn được tạo giả/u);
  const unavailable = invoiceRequestSummaryMarkup();
  assert.equal((unavailable.match(/>N\/A</gu) || []).length, 5);
});
