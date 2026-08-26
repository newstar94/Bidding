const money = (value) => `${new Intl.NumberFormat("vi-VN").format(Number(value || 0))} ₫`;

function endpoint() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "thanh-toan-gia-lap") return null;
  return `/api/billing/fake-checkout/${encodeURIComponent(parts[1])}/${encodeURIComponent(parts[2])}`;
}

function setStatus(message, tone = "neutral") {
  const node = document.getElementById("fake-checkout-status");
  if (!node) return;
  node.textContent = message;
  node.dataset.tone = tone;
}

function setBusy(busy) {
  document.querySelectorAll("[data-fake-action]").forEach((button) => {
    button.disabled = busy;
    if (busy) button.setAttribute("aria-busy", "true");
    else button.removeAttribute("aria-busy");
  });
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "Không thể xử lý checkout giả lập.");
    error.code = payload.code || "FAKE_CHECKOUT_FAILED";
    throw error;
  }
  return payload;
}

async function loadOrder(path) {
  const payload = await request(path);
  const order = payload.order || {};
  document.getElementById("fake-order-id").textContent = order.publicId || "—";
  document.getElementById("fake-order-amount").textContent = money(order.totalAmount);
  document.getElementById("fake-order-status").textContent = `${order.paymentState || "unverified"} · ${order.activationState || "not_ready"}`;
  setStatus("Checkout giả lập sẵn sàng. Không sử dụng tiền thật.", "neutral");
}

async function applyAction(path, action) {
  setBusy(true);
  setStatus("Đang đưa sự kiện vào hàng đợi đối soát…", "neutral");
  try {
    const payload = await request(path, {
      method: "POST",
      body: JSON.stringify({ action }),
    });
    const messages = {
      complete: "Đã nhận thanh toán giả lập. Ứng dụng đang xác minh và kích hoạt quyền lợi.",
      cancel: "Checkout giả lập đã hủy.",
      expire: "Checkout giả lập đã chuyển sang hết hạn.",
    };
    setStatus(messages[action] || payload.message, action === "complete" ? "success" : "warning");
    window.setTimeout(() => loadOrder(path).catch(() => {}), 1200);
  } catch (error) {
    setStatus(`${error.code}: ${error.message}`, "danger");
  } finally {
    setBusy(false);
  }
}

const path = endpoint();
if (!path) {
  setStatus("FAKE_CHECKOUT_INVALID: Đường dẫn checkout không hợp lệ.", "danger");
  setBusy(true);
} else {
  document.querySelectorAll("[data-fake-action]").forEach((button) => {
    button.addEventListener("click", () => applyAction(path, button.dataset.fakeAction));
  });
  loadOrder(path).catch((error) => {
    setStatus(`${error.code}: ${error.message}`, "danger");
    setBusy(true);
  });
}
