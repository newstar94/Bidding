const STAGES = Object.freeze([
  { key: "read", label: "Đọc file" },
  { key: "validate", label: "Kiểm tra dữ liệu" },
  { key: "preview", label: "Chuẩn bị xem trước" },
]);

const STAGE_MESSAGES = Object.freeze({
  read: "Hệ thống đang đọc file và nhận diện các trang tính.",
  validate: "Hệ thống đang kiểm tra cấu trúc và tính hợp lệ của dữ liệu.",
  preview: "Dữ liệu đã được đọc. Hệ thống đang chuẩn bị bản xem trước.",
});

const MINIMUM_VISIBLE_MS = 360;
const EXIT_TRANSITION_MS = 180;
let activeToken = null;
let previousBodyBusy = null;
let shownAt = 0;

function makeElement(documentRef, tagName, className = "", text = "") {
  const element = documentRef.createElement(tagName);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function ensureOverlay(documentRef) {
  const existing = documentRef.getElementById("excel-import-loading");
  if (existing?._excelImportLoadingRefs) return existing._excelImportLoadingRefs;

  const overlay = makeElement(documentRef, "div", "excel-import-loading");
  overlay.id = "excel-import-loading";
  overlay.hidden = true;
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");
  overlay.setAttribute("aria-atomic", "true");
  overlay.setAttribute("aria-busy", "false");

  const card = makeElement(documentRef, "section", "excel-import-loading-card");
  const header = makeElement(documentRef, "div", "excel-import-loading-header");
  const visual = makeElement(documentRef, "div", "excel-import-loading-visual");
  visual.setAttribute("aria-hidden", "true");
  visual.appendChild(makeElement(documentRef, "span", "excel-import-loading-file-mark", "XLSX"));
  const grid = makeElement(documentRef, "span", "excel-import-loading-grid");
  for (let index = 0; index < 12; index += 1) {
    grid.appendChild(makeElement(documentRef, "span", "excel-import-loading-cell"));
  }
  visual.appendChild(grid);

  const copy = makeElement(documentRef, "div", "excel-import-loading-copy");
  const title = makeElement(documentRef, "h2", "excel-import-loading-title", "Đang xử lý file Excel");
  title.id = "excel-import-loading-title";
  const message = makeElement(
    documentRef,
    "p",
    "excel-import-loading-message",
    STAGE_MESSAGES.read,
  );
  const filename = makeElement(documentRef, "p", "excel-import-loading-filename");
  filename.hidden = true;
  copy.append(title, message, filename);
  header.append(visual, copy);

  const progressTrack = makeElement(documentRef, "div", "excel-import-loading-progress");
  progressTrack.setAttribute("role", "progressbar");
  progressTrack.setAttribute("aria-label", "Đang đọc file Excel");
  progressTrack.appendChild(makeElement(documentRef, "span", "excel-import-loading-progress-value"));

  const steps = makeElement(documentRef, "ol", "excel-import-loading-steps");
  const stepRefs = new Map();
  STAGES.forEach((stage, index) => {
    const item = makeElement(documentRef, "li", "excel-import-loading-step");
    item.dataset.stage = stage.key;
    item.dataset.state = index === 0 ? "active" : "pending";
    item.append(
      makeElement(documentRef, "span", "excel-import-loading-step-index", String(index + 1)),
      makeElement(documentRef, "span", "excel-import-loading-step-label", stage.label),
    );
    steps.appendChild(item);
    stepRefs.set(stage.key, item);
  });

  card.setAttribute("aria-labelledby", title.id);
  card.append(header, progressTrack, steps);
  overlay.appendChild(card);
  documentRef.body.appendChild(overlay);

  const refs = { overlay, message, filename, progressTrack, steps: stepRefs };
  overlay._excelImportLoadingRefs = refs;
  return refs;
}

function now(documentRef) {
  return documentRef.defaultView?.performance?.now?.() ?? Date.now();
}

function delay(documentRef, milliseconds) {
  const setTimer = documentRef.defaultView?.setTimeout?.bind(documentRef.defaultView)
    || globalThis.setTimeout;
  return new Promise((resolve) => setTimer(resolve, milliseconds));
}

function waitForVisiblePaint(documentRef) {
  const requestFrame = documentRef.defaultView?.requestAnimationFrame?.bind(documentRef.defaultView);
  if (!requestFrame) return delay(documentRef, 0);
  return new Promise((resolve) => {
    requestFrame(() => requestFrame(resolve));
  });
}

function applyStage(refs, stageKey, message) {
  const stageIndex = Math.max(0, STAGES.findIndex((stage) => stage.key === stageKey));
  refs.steps.forEach((element, key) => {
    const index = STAGES.findIndex((stage) => stage.key === key);
    element.dataset.state = index < stageIndex
      ? "complete"
      : index === stageIndex ? "active" : "pending";
  });
  refs.message.textContent = message || STAGE_MESSAGES[stageKey] || STAGE_MESSAGES.read;
  refs.progressTrack.setAttribute(
    "aria-label",
    `${STAGES[stageIndex]?.label || STAGES[0].label}: ${refs.message.textContent}`,
  );
}

const NOOP_HANDLE = Object.freeze({
  update: async () => {},
  close: async () => {},
});

export async function beginExcelImportLoading({ fileName = "", message = "" } = {}) {
  const documentRef = globalThis.document;
  if (!documentRef?.body) return NOOP_HANDLE;

  const refs = ensureOverlay(documentRef);
  const replacingActiveImport = Boolean(activeToken);
  const token = Symbol("excel-import-loading");
  if (!replacingActiveImport) previousBodyBusy = documentRef.body.getAttribute("aria-busy");
  activeToken = token;
  shownAt = now(documentRef);

  refs.filename.textContent = fileName ? `File: ${fileName}` : "";
  refs.filename.title = fileName;
  refs.filename.hidden = !fileName;
  applyStage(refs, "read", message);
  refs.overlay.hidden = false;
  refs.overlay.setAttribute("aria-busy", "true");
  documentRef.body.setAttribute("aria-busy", "true");
  documentRef.body.classList.add("excel-import-is-busy");
  refs.overlay.classList.add("is-active");
  await waitForVisiblePaint(documentRef);

  return Object.freeze({
    update: async (stageKey, nextMessage = "") => {
      if (activeToken !== token) return;
      applyStage(refs, stageKey, nextMessage);
      await waitForVisiblePaint(documentRef);
    },
    close: async () => {
      if (activeToken !== token) return;
      const remaining = MINIMUM_VISIBLE_MS - (now(documentRef) - shownAt);
      if (remaining > 0) await delay(documentRef, remaining);
      if (activeToken !== token) return;

      activeToken = null;
      refs.overlay.classList.remove("is-active");
      refs.overlay.setAttribute("aria-busy", "false");
      documentRef.body.classList.remove("excel-import-is-busy");
      if (previousBodyBusy === null) documentRef.body.removeAttribute("aria-busy");
      else documentRef.body.setAttribute("aria-busy", previousBodyBusy);
      previousBodyBusy = null;

      await delay(documentRef, EXIT_TRANSITION_MS);
      if (!activeToken) refs.overlay.hidden = true;
    },
  });
}
