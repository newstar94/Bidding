const BRAND_ICON_URL = "/assets/app-brand-icon.webp?v=d308bf4310b5dbba1d17fa6bbd0c1d51eedbcefcc6c3f7034ee223447b9a06f6";
const DEFAULT_STAGES = Object.freeze([
  Object.freeze({
    key: "working",
    label: "Đang xử lý",
    message: "Hệ thống đang xử lý yêu cầu của bạn.",
  }),
]);
const MINIMUM_VISIBLE_MS = 360;
const EXIT_TRANSITION_MS = 180;

const taskStack = [];
let previousBodyBusy = null;
let previousFocus = null;
let backgroundInertState = [];

function makeElement(documentRef, tagName, className = "", text = "") {
  const element = documentRef.createElement(tagName);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function ensureOverlay(documentRef) {
  const existing = documentRef.getElementById("app-long-task-loading");
  if (existing?._appLongTaskLoadingRefs) return existing._appLongTaskLoadingRefs;

  const overlay = makeElement(documentRef, "div", "app-long-task-loading");
  overlay.id = "app-long-task-loading";
  overlay.hidden = true;
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");
  overlay.setAttribute("aria-atomic", "true");
  overlay.setAttribute("aria-busy", "false");

  const card = makeElement(documentRef, "section", "app-long-task-loading-card");
  card.tabIndex = -1;
  const header = makeElement(documentRef, "div", "app-long-task-loading-header");
  const visual = makeElement(documentRef, "div", "app-long-task-loading-visual");
  visual.setAttribute("aria-hidden", "true");
  const visualIcon = makeElement(
    documentRef,
    "img",
    "app-brand-image app-long-task-loading-icon",
  );
  visualIcon.src = BRAND_ICON_URL;
  visualIcon.alt = "";
  visualIcon.width = 96;
  visualIcon.height = 96;
  visual.appendChild(visualIcon);

  const copy = makeElement(documentRef, "div", "app-long-task-loading-copy");
  const title = makeElement(documentRef, "h2", "app-long-task-loading-title");
  title.id = "app-long-task-loading-title";
  const message = makeElement(documentRef, "p", "app-long-task-loading-message");
  const detail = makeElement(documentRef, "p", "app-long-task-loading-detail");
  detail.hidden = true;
  copy.append(title, message, detail);
  header.append(visual, copy);

  const progressTrack = makeElement(documentRef, "div", "app-long-task-loading-progress");
  progressTrack.setAttribute("role", "progressbar");
  progressTrack.appendChild(makeElement(
    documentRef,
    "span",
    "app-long-task-loading-progress-value",
  ));

  const steps = makeElement(documentRef, "ol", "app-long-task-loading-steps");
  card.setAttribute("aria-labelledby", title.id);
  card.append(header, progressTrack, steps);
  overlay.appendChild(card);
  documentRef.body.appendChild(overlay);

  const refs = {
    overlay,
    card,
    title,
    message,
    detail,
    progressTrack,
    steps,
    stepRefs: new Map(),
  };
  overlay._appLongTaskLoadingRefs = refs;
  return refs;
}

function normalizeStages(stages) {
  if (!Array.isArray(stages) || stages.length === 0) return DEFAULT_STAGES;
  const normalized = stages.map((stage, index) => Object.freeze({
    key: String(stage?.key || `stage-${index + 1}`),
    label: String(stage?.label || `Bước ${index + 1}`),
    message: String(stage?.message || ""),
  }));
  return Object.freeze(normalized);
}

function configureSteps(documentRef, refs, stages) {
  refs.stepRefs = new Map();
  const items = stages.map((stage, index) => {
    const item = makeElement(documentRef, "li", "app-long-task-loading-step");
    item.dataset.stage = stage.key;
    item.dataset.state = index === 0 ? "active" : "pending";
    item.append(
      makeElement(
        documentRef,
        "span",
        "app-long-task-loading-step-index",
        String(index + 1),
      ),
      makeElement(documentRef, "span", "app-long-task-loading-step-label", stage.label),
    );
    refs.stepRefs.set(stage.key, item);
    return item;
  });
  refs.steps.replaceChildren(...items);
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

function applyStage(refs, stages, stageKey, message) {
  const requestedIndex = stages.findIndex((stage) => stage.key === stageKey);
  const stageIndex = requestedIndex >= 0 ? requestedIndex : 0;
  refs.stepRefs.forEach((element, key) => {
    const index = stages.findIndex((stage) => stage.key === key);
    element.dataset.state = index < stageIndex
      ? "complete"
      : index === stageIndex ? "active" : "pending";
  });
  const stage = stages[stageIndex] || DEFAULT_STAGES[0];
  refs.message.textContent = String(message || stage.message || DEFAULT_STAGES[0].message);
  refs.progressTrack.setAttribute(
    "aria-label",
    `${stage.label}: ${refs.message.textContent}`,
  );
}

function renderTask(documentRef, refs, task) {
  refs.overlay.dataset.task = task.task;
  refs.title.textContent = task.title;
  refs.detail.textContent = task.detail;
  refs.detail.title = task.detail;
  refs.detail.hidden = !task.detail;
  configureSteps(documentRef, refs, task.stages);
  applyStage(refs, task.stages, task.stageKey, task.message);
}

function isolateBackground(documentRef, refs) {
  previousFocus = documentRef.activeElement;
  backgroundInertState = [...documentRef.body.children]
    .filter((element) => element !== refs.overlay)
    .map((element) => ({
      element,
      inert: Boolean(element.inert),
      hadAttribute: element.hasAttribute("inert"),
    }));
  backgroundInertState.forEach(({ element }) => {
    element.inert = true;
  });
  refs.card.focus({ preventScroll: true });
}

function restoreBackground() {
  backgroundInertState.forEach(({ element, inert, hadAttribute }) => {
    if (!element?.isConnected) return;
    element.inert = inert;
    if (!hadAttribute && !inert) element.removeAttribute("inert");
  });
  backgroundInertState = [];
  if (previousFocus?.isConnected && typeof previousFocus.focus === "function") {
    previousFocus.focus({ preventScroll: true });
  }
  previousFocus = null;
}

const NOOP_HANDLE = Object.freeze({
  update: async () => {},
  close: async () => {},
});

/**
 * Show the application-wide feedback surface for a long-running task.
 * Nested tasks form a stack; closing one cannot hide another active task.
 */
export async function beginLongTaskLoading({
  task = "long-task",
  title = "Đang xử lý",
  stages: requestedStages = DEFAULT_STAGES,
  initialStage = "",
  message = "",
  detail = "",
} = {}) {
  const documentRef = globalThis.document;
  if (!documentRef?.body) return NOOP_HANDLE;

  const refs = ensureOverlay(documentRef);
  const stages = normalizeStages(requestedStages);
  const token = Symbol(String(task || "long-task"));
  const taskState = {
    token,
    task: String(task || "long-task"),
    title: String(title || "Đang xử lý"),
    detail: String(detail || ""),
    stages,
    stageKey: initialStage || stages[0].key,
    message,
    shownAt: now(documentRef),
    closed: false,
  };
  if (taskStack.length === 0) {
    previousBodyBusy = documentRef.body.getAttribute("aria-busy");
  }
  taskStack.push(taskState);
  renderTask(documentRef, refs, taskState);
  refs.overlay.hidden = false;
  refs.overlay.setAttribute("aria-busy", "true");
  documentRef.body.setAttribute("aria-busy", "true");
  documentRef.body.classList.add("app-long-task-is-busy");
  refs.overlay.classList.add("is-active");
  if (taskStack.length === 1) isolateBackground(documentRef, refs);
  await waitForVisiblePaint(documentRef);

  return Object.freeze({
    update: async (stageKey, nextMessage = "") => {
      if (taskState.closed) return;
      taskState.stageKey = stageKey;
      taskState.message = nextMessage;
      if (taskStack.at(-1)?.token !== token) return;
      renderTask(documentRef, refs, taskState);
      await waitForVisiblePaint(documentRef);
    },
    close: async () => {
      if (taskState.closed) return;
      taskState.closed = true;
      let taskIndex = taskStack.findIndex((entry) => entry.token === token);
      if (taskIndex < 0) return;
      const wasTop = taskIndex === taskStack.length - 1;
      if (!wasTop) {
        taskStack.splice(taskIndex, 1);
        return;
      }
      const remaining = MINIMUM_VISIBLE_MS - (now(documentRef) - taskState.shownAt);
      if (remaining > 0) await delay(documentRef, remaining);
      taskIndex = taskStack.findIndex((entry) => entry.token === token);
      if (taskIndex < 0) return;
      const stillTop = taskIndex === taskStack.length - 1;
      taskStack.splice(taskIndex, 1);
      if (!stillTop) return;
      const nextTask = taskStack.at(-1);
      if (nextTask) {
        renderTask(documentRef, refs, nextTask);
        await waitForVisiblePaint(documentRef);
        return;
      }
      refs.overlay.classList.remove("is-active");
      refs.overlay.setAttribute("aria-busy", "false");
      documentRef.body.classList.remove("app-long-task-is-busy");
      if (previousBodyBusy === null) documentRef.body.removeAttribute("aria-busy");
      else documentRef.body.setAttribute("aria-busy", previousBodyBusy);
      previousBodyBusy = null;
      restoreBackground();

      await delay(documentRef, EXIT_TRANSITION_MS);
      if (taskStack.length === 0) refs.overlay.hidden = true;
    },
  });
}
