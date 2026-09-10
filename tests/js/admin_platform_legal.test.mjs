import assert from "node:assert/strict";
import test from "node:test";
import DOMPurify from "../../node_modules/dompurify/dist/purify.es.mjs";

import {
  legalCatalogFailureMarkup,
  legalCatalogShellMarkup,
  renderAdminLegalCatalog,
} from "../../frontend/admin-platform/AdminLegalCatalog.js";
import { getAdminRoute } from "../../frontend/admin-platform/AdminRouter.js";

DOMPurify.isSupported = true;
DOMPurify.sanitize = (value) => String(value);

function container() {
  const root = {};
  return {
    attributes: {},
    innerHTML: "",
    root,
    setAttribute(name, value) { this.attributes[name] = value; },
    querySelector(selector) {
      if (selector === "#admin-legal-catalog-root") return root;
      return null;
    },
  };
}

test("admin router exposes the legal catalog as a direct platform route", () => {
  assert.deepEqual(getAdminRoute("/admin/legal"), {
    path: "/admin/legal",
    title: "Danh mục pháp lý",
  });
});

test("legal catalog shell describes immutable approved data without inventing facts", () => {
  const markup = legalCatalogShellMarkup();
  assert.match(markup, /Danh mục phiên bản pháp lý/u);
  assert.match(markup, /dữ liệu đã được phê duyệt/u);
  assert.doesNotMatch(markup, /27\/2026|đã sẵn sàng phát hành|legal-placeholder/u);
});

test("legal catalog keeps disabled, permission and retryable failures distinct", () => {
  assert.match(legalCatalogFailureMarkup({ status: 404 }), /data-admin-state="empty"/u);
  assert.match(legalCatalogFailureMarkup({ status: 403 }), /data-admin-state="permission"/u);
  assert.doesNotMatch(legalCatalogFailureMarkup({ status: 403 }), /data-admin-retry/u);
  assert.match(legalCatalogFailureMarkup({ status: 503 }), /data-admin-state="error"/u);
  assert.match(legalCatalogFailureMarkup({ status: 503 }), /data-admin-retry/u);
});

test("legal catalog preloads the existing API and mounts the parity workflow", async () => {
  const target = container();
  const calls = [];
  const profiles = [{ id: "profile-version-1", displayName: "Hồ sơ đã duyệt" }];
  let mountOptions;
  const controller = { refresh() {} };
  const result = await renderAdminLegalCatalog(target, {
    read: async (url, options) => {
      calls.push({ url, options });
      return profiles;
    },
    write: async () => { throw new Error("not used"); },
    mount: async (root, options) => {
      assert.equal(root, target.root);
      mountOptions = options;
      assert.equal(await options.read("/api/legal-versioning/profiles"), profiles);
      return controller;
    },
  });

  assert.equal(result, controller);
  assert.equal(mountOptions.enabled, true);
  assert.deepEqual(calls, [{
    url: "/api/legal-versioning/profiles",
    options: { retries: 0 },
  }]);
  assert.equal(target.attributes["aria-busy"], "false");
});
