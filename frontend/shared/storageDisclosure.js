// Informational cookie notice for public pages (ADR 0095). BiddingFlow sets
// only strictly necessary cookies and no third-party trackers, so there is
// nothing to block before consent; the notice discloses that and links the
// cookie policy. Acknowledgement is per policy version and per browser.

export const COOKIE_NOTICE_STORAGE_KEY = "bf_cookie_notice_ack";
export const COOKIE_NOTICE_VERSION = "2026-10-24";

function readAcknowledged(storage) {
  try {
    return storage?.getItem(COOKIE_NOTICE_STORAGE_KEY) === COOKIE_NOTICE_VERSION;
  } catch (_) {
    return false;
  }
}

function writeAcknowledged(storage) {
  try {
    storage?.setItem(COOKIE_NOTICE_STORAGE_KEY, COOKIE_NOTICE_VERSION);
  } catch (_) {
    // Private mode or blocked storage: the notice simply shows again next visit.
  }
}

function defaultStorage() {
  try {
    return globalThis.localStorage || null;
  } catch (_) {
    return null;
  }
}

export function installCookieNotice(doc = globalThis.document, { storage = defaultStorage() } = {}) {
  if (!doc?.body || readAcknowledged(storage)) return null;
  if (doc.querySelector("[data-storage-disclosure]")) return doc.querySelector("[data-storage-disclosure]");

  const notice = doc.createElement("section");
  notice.className = "bf-storage-disclosure";
  notice.dataset.storageDisclosure = "";
  notice.setAttribute("aria-label", "Thông báo cookie");

  const message = doc.createElement("p");
  message.className = "bf-storage-disclosure-text";
  message.append(
    "BiddingFlow chỉ dùng cookie cần thiết để đăng nhập và bảo vệ tài khoản; không dùng cookie quảng cáo hay công cụ phân tích của bên thứ ba. ",
  );
  const link = doc.createElement("a");
  link.href = "/legal#cookies";
  link.textContent = "Xem Chính sách cookie";
  message.append(link);

  const button = doc.createElement("button");
  button.type = "button";
  button.className = "bf-storage-disclosure-accept";
  button.textContent = "Đã hiểu";
  button.addEventListener("click", () => {
    writeAcknowledged(storage);
    notice.remove();
  });

  notice.append(message, button);
  doc.body.append(notice);
  return notice;
}
