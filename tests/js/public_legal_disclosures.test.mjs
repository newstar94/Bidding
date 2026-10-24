import assert from "node:assert/strict";
import test from "node:test";

import {
  BUSINESS_PROFILE_PLACEHOLDER,
  applyBusinessProfile,
  loadBusinessProfile,
} from "../../frontend/shared/businessProfile.js";
import {
  COOKIE_NOTICE_STORAGE_KEY,
  COOKIE_NOTICE_VERSION,
  installCookieNotice,
} from "../../frontend/shared/storageDisclosure.js";
import {
  businessProfileFormMarkup,
  readBusinessProfileForm,
} from "../../frontend/admin-platform/AdminBusinessProfile.js";
import { createRegistrationPayload } from "../../frontend/auth/AuthFlowController.js";

class FakeElement {
  constructor(tagName, dataset = {}) {
    this.tagName = tagName.toUpperCase();
    this.dataset = { ...dataset };
    this.attributes = {};
    this.children = [];
    this.listeners = {};
    this.textContent = "";
    this.parent = null;
  }

  setAttribute(name, value) { this.attributes[name] = String(value); }

  append(...nodes) {
    for (const node of nodes) {
      if (typeof node === "string") this.textContent += node;
      else { node.parent = this; this.children.push(node); }
    }
  }

  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }

  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }

  click() { (this.listeners.click || []).forEach((listener) => listener()); }

  descendants() { return this.children.flatMap((child) => [child, ...child.descendants()]); }

  querySelectorAll(selector) {
    const key = selector.match(/^\[data-([a-z-]+)\]$/u)?.[1]
      ?.replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase());
    return this.descendants().filter((node) => key && key in node.dataset);
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function footerRoot() {
  const root = new FakeElement("div");
  const container = new FakeElement("address", { businessProfile: "" });
  for (const key of ["legalName", "taxCode", "address", "phone"]) {
    container.append(new FakeElement("span", { businessField: key }));
  }
  const email = new FakeElement("a", { businessField: "email" });
  container.append(email);
  root.append(container);
  return { root, container, email };
}

function fieldText(container, key) {
  return container.querySelectorAll("[data-business-field]").find((node) => node.dataset.businessField === key).textContent;
}

test("unconfigured business fields show a neutral placeholder, never invented data", () => {
  const { root, container, email } = footerRoot();
  applyBusinessProfile(root, { legalName: "", taxCode: "  " });
  assert.equal(fieldText(container, "legalName"), "Đơn vị vận hành BiddingFlow");
  assert.equal(fieldText(container, "taxCode"), BUSINESS_PROFILE_PLACEHOLDER);
  assert.equal(fieldText(container, "address"), BUSINESS_PROFILE_PLACEHOLDER);
  assert.equal(email.textContent, "biddingflow@gmail.com");
  assert.equal(email.attributes.href, "mailto:biddingflow@gmail.com");
});

test("configured business fields replace placeholders as text", () => {
  const { root, container, email } = footerRoot();
  applyBusinessProfile(root, {
    legalName: "Công ty <b>ABC</b>",
    taxCode: "0101234567",
    email: "hotro@abc.vn",
  });
  assert.equal(fieldText(container, "legalName"), "Công ty <b>ABC</b>");
  assert.equal(fieldText(container, "taxCode"), "0101234567");
  assert.equal(email.attributes.href, "mailto:hotro@abc.vn");
});

test("a failed profile request keeps the placeholders and never throws", async () => {
  const { root } = footerRoot();
  assert.equal(await loadBusinessProfile(root, { fetchImpl: async () => { throw new Error("offline"); } }), null);
  assert.equal(await loadBusinessProfile(root, { fetchImpl: async () => new Response("{}", { status: 503 }) }), null);
  const profile = await loadBusinessProfile(root, {
    fetchImpl: async (url) => {
      assert.equal(url, "/api/public/business-profile");
      return new Response(JSON.stringify({ profile: { taxCode: "0101234567" }, configured: true }), { status: 200 });
    },
  });
  assert.deepEqual(profile, { taxCode: "0101234567" });
});

function fakeDocument() {
  const body = new FakeElement("body");
  return {
    body,
    createElement: (tag) => new FakeElement(tag),
    querySelector: (selector) => body.querySelector(selector),
  };
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    values,
  };
}

test("cookie notice links the policy and is dismissed per policy version", () => {
  const doc = fakeDocument();
  const storage = memoryStorage();
  const notice = installCookieNotice(doc, { storage });
  assert.ok(notice);
  assert.equal(doc.body.children.length, 1);
  const link = notice.descendants().find((node) => node.tagName === "A");
  assert.equal(link.href, "/legal#cookies");
  assert.equal(installCookieNotice(doc, { storage }), notice, "the notice is installed once");

  notice.descendants().find((node) => node.tagName === "BUTTON").click();
  assert.equal(doc.body.children.length, 0);
  assert.equal(storage.values.get(COOKIE_NOTICE_STORAGE_KEY), COOKIE_NOTICE_VERSION);
  assert.equal(installCookieNotice(fakeDocument(), { storage }), null);

  const outdated = memoryStorage({ [COOKIE_NOTICE_STORAGE_KEY]: "2000-01-01" });
  assert.ok(installCookieNotice(fakeDocument(), { storage: outdated }), "a new policy version shows the notice again");
});

test("cookie notice still renders when browser storage throws", () => {
  const blocked = {
    getItem() { throw new Error("SecurityError"); },
    setItem() { throw new Error("SecurityError"); },
  };
  const doc = fakeDocument();
  const notice = installCookieNotice(doc, { storage: blocked });
  assert.ok(notice);
  notice.descendants().find((node) => node.tagName === "BUTTON").click();
  assert.equal(doc.body.children.length, 0);
});

test("admin business profile form escapes stored values and reads every field", () => {
  const fields = [
    { key: "legalName", label: "Tên doanh nghiệp", maxLength: 200 },
    { key: "address", label: "Địa chỉ", maxLength: 300 },
  ];
  const markup = businessProfileFormMarkup({
    fields,
    profile: { legalName: '"><script>x</script>', address: "Hà Nội" },
    configured: true,
    status: "",
  });
  assert.doesNotMatch(markup, /<script>/u);
  assert.match(markup, /id="business-profile-legalName"/u);
  assert.match(markup, /<textarea[^>]*name="address"[^>]*>Hà Nội<\/textarea>/u);
  assert.match(markup, /Đã cấu hình/u);
  const form = { elements: { legalName: { value: "  Công ty ABC " }, address: { value: "" } } };
  assert.deepEqual(readBusinessProfileForm(form, fields), { legalName: "Công ty ABC", address: "" });
});

test("registration payload carries an explicit boolean legal consent", () => {
  assert.equal(createRegistrationPayload({ username: "a", password: "b", name: "c", email: "d" }).acceptLegal, false);
  assert.equal(createRegistrationPayload({ username: "a", password: "b", name: "c", email: "d", acceptLegal: "yes" }).acceptLegal, false);
  assert.equal(createRegistrationPayload({ username: "a", password: "b", name: "c", email: "d", acceptLegal: true }).acceptLegal, true);
});
