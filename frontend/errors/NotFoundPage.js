import { APP_DEBUG } from "../app/appConfig.js";
import { loadStyleOnce } from "../shared/externalAssets.js";

const HOME_PATH = "/";
const NOT_FOUND_STYLESHEET_URL = new URL("../../views/css/not-found.css", import.meta.url).pathname;

function element(tagName, className, text = "") {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function icon(name, className = "") {
  const node = element("i", className);
  node.dataset.lucide = name;
  node.setAttribute("aria-hidden", "true");
  return node;
}

function createArt() {
  const art = element("div", "bf-not-found__artwork");
  art.setAttribute("aria-hidden", "true");

  const city = element("div", "bf-not-found__city");
  for (let index = 0; index < 11; index += 1) {
    const building = element("span", "bf-not-found__building");
    building.style.setProperty("--building-index", String(index));
    city.append(building);
  }
  art.append(city);

  const route = element("div", "bf-not-found__route");
  const routeDot = element("span", "bf-not-found__route-dot");
  route.append(routeDot);
  art.append(route);

  const number = element("div", "bf-not-found__ghost-number", "404");
  art.append(number);

  const clipboard = element("div", "bf-not-found__clipboard");
  const clip = element("div", "bf-not-found__clip");
  clip.append(element("span", "bf-not-found__clip-hole"));
  clipboard.append(clip);
  const sheet = element("div", "bf-not-found__sheet");
  sheet.append(element("div", "bf-not-found__sheet-fold"));
  const question = element("div", "bf-not-found__question", "?");
  sheet.append(question);
  const line = element("span", "bf-not-found__sheet-line");
  sheet.append(line);
  for (let index = 0; index < 3; index += 1) {
    const bullet = element("span", "bf-not-found__sheet-bullet");
    const textLine = element("span", "bf-not-found__sheet-text");
    textLine.style.setProperty("--line-index", String(index));
    sheet.append(bullet, textLine);
  }
  clipboard.append(sheet);
  art.append(clipboard);

  const seal = element("div", "bf-not-found__seal");
  seal.append(icon("check", "bf-not-found__seal-icon"));
  art.append(seal);

  const gavel = element("div", "bf-not-found__gavel");
  gavel.append(element("span", "bf-not-found__gavel-head"));
  gavel.append(element("span", "bf-not-found__gavel-handle"));
  gavel.append(element("span", "bf-not-found__gavel-base"));
  art.append(gavel);

  const plane = element("div", "bf-not-found__plane");
  plane.append(icon("send", "bf-not-found__plane-icon"));
  art.append(plane);

  const pin = element("div", "bf-not-found__pin");
  pin.append(icon("map-pin", "bf-not-found__pin-icon"));
  art.append(pin);

  const paper = element("div", "bf-not-found__paper");
  paper.append(icon("file-text", "bf-not-found__paper-icon"));
  art.append(paper);

  return art;
}

export function notFoundNavigationTarget(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return "";
  if (/^PL\d{10}(?:-\d{2})?$/.test(normalized)) return "/ke-hoach";
  if (/^IB\d{10}(?:-\d{2})?$/.test(normalized)) return "/goi-thau";
  return "/tong-quan";
}

function createNavigation(copy) {
  const form = element("form", "bf-not-found__search");
  form.setAttribute("aria-label", "Mở khu vực phù hợp trong BiddingFlow");

  const label = element("label", "bf-not-found__search-label", "Mở khu vực theo mã tham chiếu");
  const input = element("input", "bf-not-found__search-input");
  input.type = "text";
  input.placeholder = "Nhập mã PL hoặc IB...";
  input.autocomplete = "off";
  input.setAttribute("aria-describedby", "bf-not-found-search-help");
  label.htmlFor = "bf-not-found-search-input";
  input.id = label.htmlFor;

  const submit = element("button", "bf-not-found__search-button");
  submit.type = "submit";
  submit.setAttribute("aria-label", "Mở khu vực phù hợp");
  submit.append(icon("arrow-right"));
  const help = element(
    "span",
    "bf-not-found__sr-only",
    "Mã PL mở danh sách kế hoạch, mã IB mở danh sách gói thầu; nội dung khác mở tổng quan.",
  );
  help.id = "bf-not-found-search-help";
  form.append(label, input, submit, help);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const destination = notFoundNavigationTarget(input.value);
    if (!destination) {
      input.focus();
      copy.textContent = "Nhập mã tham chiếu để mở khu vực phù hợp.";
      return;
    }
    window.location.assign(destination);
  });
  return form;
}

function createPage() {
  const page = element("main", "bf-not-found");
  page.id = "bf-not-found-page";
  page.setAttribute("aria-labelledby", "bf-not-found-title");

  const inner = element("div", "bf-not-found__inner");
  const copy = element("section", "bf-not-found__copy");
  const eyebrow = element("p", "bf-not-found__eyebrow", "BIDDINGFLOW · ĐIỀU HƯỚNG");
  const title = element("h1", "bf-not-found__title");
  title.id = "bf-not-found-title";
  title.append(element("span", "bf-not-found__title-code", "404"));
  title.append(element("span", "bf-not-found__title-text", "Không tìm thấy trang"));
  const description = element(
    "p",
    "bf-not-found__description",
    "Trang bạn đang tìm có thể đã được di chuyển, xóa hoặc chưa từng tồn tại. Hãy quay lại hoặc mở khu vực phù hợp theo mã tham chiếu.",
  );
  const actions = element("div", "bf-not-found__actions");
  const home = element("a", "bf-not-found__button bf-not-found__button--primary", "Về trang chủ");
  home.href = HOME_PATH;
  home.prepend(icon("house"));
  const back = element("button", "bf-not-found__button bf-not-found__button--secondary", "Quay lại");
  back.type = "button";
  back.prepend(icon("arrow-left"));
  back.addEventListener("click", () => {
    if (window.history.length > 1) window.history.back();
    else window.location.assign(HOME_PATH);
  });
  actions.append(home, back);
  const navigation = createNavigation(description);
  copy.append(eyebrow, title, description, actions, navigation);
  inner.append(copy, createArt());
  page.append(inner);
  return page;
}

export async function bootstrapNotFoundPage() {
  if (!APP_DEBUG) await loadStyleOnce(NOT_FOUND_STYLESHEET_URL);
  document.title = "404 - Không tìm thấy trang | BiddingFlow";
  document.body.classList.remove("bf-init-loading", "landing-ready", "legal-ready");
  document.body.classList.add("bf-not-found-body");
  document.body.removeAttribute("hidden");
  document.body.replaceChildren(createPage());
}
