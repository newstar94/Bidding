import { trustedHTML } from "../shared/trustedTypes.js";
import { formatCommercialMoney } from "./PublicCommercialCatalog.js";

// A native dialog keeps focus inside the checkout and stays in the browser's
// top layer without depending on the application's other modal stacks.
export function createCheckoutPaymentDialog({ title, onCancel, onDismiss }) {
  const dialog = document.createElement("dialog");
  dialog.className = "commercial-checkout-dialog";
  dialog.setAttribute("aria-labelledby", "commercial-checkout-title");
  dialog.setAttribute("aria-describedby", "commercial-checkout-status");
  dialog.innerHTML = trustedHTML(`<header class="commercial-checkout-dialog__header"><div><span class="commercial-checkout-dialog__eyebrow">Thanh toán qua payOS</span><h2 id="commercial-checkout-title">Thanh toán gói dịch vụ</h2></div><button type="button" class="commercial-checkout-dialog__close" aria-label="Đóng và hủy giao dịch">×</button></header><div class="commercial-checkout-dialog__content"><p class="commercial-checkout-dialog__package"></p><strong class="commercial-checkout-dialog__amount"></strong><div class="commercial-checkout-dialog__payment" hidden></div><p id="commercial-checkout-status" class="commercial-checkout-dialog__status" role="status" aria-live="polite"></p><p class="commercial-checkout-dialog__notice">Bấm Hủy thanh toán, đóng cửa sổ hoặc nhấn Esc để hủy giao dịch chưa thanh toán.</p></div><footer><button type="button" class="btn btn-outline commercial-checkout-dialog__cancel">Hủy thanh toán</button></footer>`);
  document.body.appendChild(dialog);
  const payment = dialog.querySelector(".commercial-checkout-dialog__payment");
  const closeButton = dialog.querySelector(".commercial-checkout-dialog__close");
  const cancelButton = dialog.querySelector(".commercial-checkout-dialog__cancel");
  const statusNode = dialog.querySelector(".commercial-checkout-dialog__status");
  const notice = dialog.querySelector(".commercial-checkout-dialog__notice");
  const originalFocus = document.activeElement;
  let dismissed = false;
  let canDismiss = false;
  let busy = false;
  const close = () => {
    if (dismissed) return;
    dismissed = true;
    dialog.close();
    dialog.remove();
    onDismiss?.();
    if (originalFocus?.isConnected) originalFocus.focus({ preventScroll: true });
  };
  const requestClose = () => {
    if (busy || dismissed) return;
    if (canDismiss) close();
    else void onCancel();
  };
  closeButton.addEventListener("click", requestClose);
  cancelButton.addEventListener("click", requestClose);
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); requestClose(); });
  dialog.addEventListener("close", () => {
    if (dismissed) return;
    dialog.showModal();
    requestClose();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) requestClose();
  });
  dialog.querySelector(".commercial-checkout-dialog__package").textContent = title || "Gói dịch vụ";
  const showState = (message, tone = "neutral", options = {}) => {
    busy = options.busy === true;
    canDismiss = options.canDismiss === true;
    statusNode.textContent = message;
    statusNode.dataset.tone = tone;
    closeButton.disabled = busy;
    cancelButton.disabled = busy;
    cancelButton.textContent = options.cancelLabel || (canDismiss ? "Đóng" : "Hủy thanh toán");
    cancelButton.toggleAttribute("aria-busy", busy);
    closeButton.setAttribute("aria-label", canDismiss ? "Đóng cửa sổ thanh toán" : "Đóng và hủy giao dịch");
    if (options.hidePayment) { payment.hidden = true; payment.replaceChildren(); }
    if (canDismiss) notice.hidden = true;
  };
  const showPayment = (order, checkoutUrl) => {
    const details = order.paymentDetails || {};
    payment.replaceChildren();
    payment.hidden = false;
    dialog.querySelector(".commercial-checkout-dialog__amount").textContent = formatCommercialMoney(order.totalAmount, order.currency || "VND");
    const imageSource = String(details.qrCodeImage || "");
    if (/^data:image\/(?:svg\+xml|png|jpeg);(?:base64,|charset=utf-8,|utf8,)/i.test(imageSource)) {
      const image = document.createElement("img");
      image.src = imageSource;
      image.alt = "Mã QR thanh toán";
      image.width = 256;
      image.height = 256;
      payment.appendChild(image);
      const help = document.createElement("p");
      help.textContent = "Mở ứng dụng ngân hàng và quét mã QR để thanh toán.";
      payment.appendChild(help);
    } else if (checkoutUrl) {
      const help = document.createElement("p");
      help.textContent = "Đơn này chưa có mã QR trong ứng dụng. Mở trang payOS để xem mã thanh toán.";
      const link = document.createElement("a");
      link.className = "btn btn-primary";
      link.textContent = "Mở trang thanh toán payOS";
      link.href = checkoutUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      payment.append(help, link);
    }
    const facts = document.createElement("dl");
    facts.className = "commercial-checkout-dialog__details";
    const rows = [["Chủ tài khoản", details.accountName], ["Số tài khoản", details.accountNumber], ["Nội dung", details.description], ["Mã giao dịch", order.publicId]];
    if (Number(order.checkoutExpiresAt) > 0) rows.push(["Có hiệu lực đến", new Date(Number(order.checkoutExpiresAt) * 1000).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })]);
    rows.forEach(([label, value]) => {
      if (!value) return;
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = label;
      description.textContent = value;
      facts.append(term, description);
    });
    payment.appendChild(facts);
    showState(imageSource ? "Đang chờ thanh toán…" : "Đang chờ thanh toán trên payOS…");
  };
  showState("Đang tạo mã QR thanh toán…");
  dialog.showModal();
  return { close, showState, showPayment, show: () => { if (!dismissed && !dialog.open) dialog.showModal(); }, get isOpen() { return !dismissed && dialog.open; } };
}
