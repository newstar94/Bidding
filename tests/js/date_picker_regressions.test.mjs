import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// Exercise the production callbacks with a small DOM double. Sanitization and
// CSSOM have separate browser tests; neither is the subject of these tests.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/frontend/shared/flatpickrTheme.js")) {
      const source = specifier === "./trustedTypes.js"
        ? "export const trustedHTML = String;"
        : specifier === "./runtimeStyles.js"
          ? "export const setRuntimeStyle=(el,k,v)=>{el.styles[k]=v;}; export const getRuntimeStyle=(el,k)=>el.styles[k]||'';"
          : null;
      if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { enhanceFlatpickrMonthYear, parseDateRangeText, bindDateRangePicker } = await import("../../frontend/shared/flatpickrTheme.js");
hooks.deregister();

for (const [text, expected] of [
  ["", ["", ""]],
  ["01/10/2026 – 15/10/2026", ["2026-10-01", "2026-10-15"]],
  ["2026-10-15 - 2026-10-01", ["2026-10-01", "2026-10-15"]],
  ["1/2/2024", ["2024-02-01", ""]],
  ["29/02/2024 – …", ["2024-02-29", ""]],
  ["… – 01/10/2026", ["", "2026-10-01"]],
  ["— 01/10/2026", ["", "2026-10-01"]],
  ["01/10/2026 – 15/", null],
  ["31/02/2026", null],
  ["29/02/2025", null],
  ["2026-13-01", null],
  ["00/10/2026", null],
  ["01/10/20260", null],
  ["01/10/2026 15/10/2026", null],
  ["invalid", null],
  ["01/10/2026 – 15/10/2026 – 20/10/2026", null],
]) {
  test(`date range preserves valid bounds and rejects invalid input: ${JSON.stringify(text)}`, () => {
    assert.deepEqual(parseDateRangeText(text), expected);
  });
}

class Node {
  constructor(tagName = "div", className = "") {
    this.tagName = tagName.toUpperCase();
    this.className = className;
    this.children = [];
    this.styles = {};
    this.listeners = new Map();
    this.attributes = {};
    this.value = "";
    this.classList = {
      contains: (name) => this.className.split(" ").includes(name),
      add: (name) => { if (!this.classList.contains(name)) this.className += ` ${name}`; },
      remove: (name) => { this.className = this.className.split(" ").filter((item) => item !== name).join(" "); },
    };
  }
  appendChild(node) { this.children.push(node); node.parentElement = this; return node; }
  insertBefore(node) { return this.appendChild(node); }
  set innerHTML(_value) { this.children = []; }
  setAttribute(name, value) { this.attributes[name] = value; }
  querySelector(selector) {
    for (const child of this.children) {
      if (child.classList.contains(selector.slice(1))) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  dispatchEvent() { return true; }
}

function calendar() {
  const root = new Node();
  const header = root.appendChild(new Node("div", "flatpickr-current-month"));
  header.appendChild(new Node("span", "cur-month"));
  header.appendChild(new Node("div", "numInputWrapper")).appendChild(new Node("input", "cur-year"));
  root.appendChild(new Node("div", "flatpickr-innerContainer"));
  return root;
}

function withDocument(run) {
  const previous = globalThis.document;
  globalThis.document = { createElement: (tag) => new Node(tag) };
  try { return run(); } finally { globalThis.document = previous; }
}

test("browsing year pages does not change the calendar until a year is selected", () => withDocument(() => {
  const instance = {
    currentYear: 2026, currentMonth: 9, renderedYear: 2026,
    calendarContainer: calendar(),
    config: { onMonthChange: [], onOpen: [], onYearChange: [], onChange: [], onClose: [] },
    changeYear(year) {
      // Flatpickr redraws only when the new year differs from its current year.
      if (year === this.currentYear) return;
      this.currentYear = year;
      this.renderedYear = year;
    },
  };
  enhanceFlatpickrMonthYear(instance);
  const click = { stopPropagation() {} };
  const root = instance.calendarContainer;
  root.querySelector(".numInputWrapper").onclick(click);
  let overlay = root.querySelector(".flatpickr-grid-overlay");
  overlay.children[0].children[2].onclick(click);
  assert.equal(instance.currentYear, 2026, "previewing another decade must not mutate the selected calendar year");
  instance.config.onClose.forEach((callback) => callback());
  assert.equal(instance.renderedYear, instance.currentYear, "cancelling leaves header and days consistent");
  root.querySelector(".numInputWrapper").onclick(click);
  overlay = root.querySelector(".flatpickr-grid-overlay");
  overlay.children[0].children[2].onclick(click);
  const year = overlay.children[1].children.find((node) => node.textContent === 2036);
  assert.equal(year.tagName, "BUTTON");
  year.onclick(click);
  assert.equal(instance.currentYear, 2036);
  assert.equal(instance.renderedYear, 2036, "choosing the page's central year must redraw days");
}));

test("destroying a range picker removes host listeners and cancels queued close work", async () => {
  let instance;
  let input;
  let host;
  let setDateCalls = 0;
  let destroyHookCalls = 0;
  withDocument(() => {
    host = new Node();
    input = host.appendChild(new Node("input"));
    const flatpickr = (_input, config) => {
      instance = {
        calendarContainer: calendar(), currentYear: 2026, currentMonth: 9, selectedDates: [],
        config: { ...config, onMonthChange: [], onYearChange: [], onOpen: [], onChange: [config.onChange], onClose: [config.onClose] },
        setDate() { setDateCalls += 1; },
      };
      config.onReady([], "", instance);
      return instance;
    };
    flatpickr.l10ns = { vn: {} };
    bindDateRangePicker(flatpickr, input, {
      from: new Node("input"), to: new Node("input"),
      onDestroy: () => { destroyHookCalls += 1; },
    });
    instance.config.onClose.forEach((callback) => callback());
    instance.config.onDestroy.forEach((callback) => callback());
    assert.equal(host.listeners.get("blur").size, 0);
    assert.equal(host.listeners.get("keydown").size, 0);
    assert.equal(input._bfDateRange, undefined);
    assert.equal(destroyHookCalls, 1, "cleanup preserves the caller's existing destroy hook");
  });
  await Promise.resolve();
  assert.equal(setDateCalls, 1, "a queued close must not call setDate on a destroyed instance");
});
