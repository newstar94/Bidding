const OFFICIAL_ORIGIN = "https://muasamcong.mpi.gov.vn";
const DETAIL_PATH = "/vi/web/guest/contractor-selection";
const IDENTIFIER_PATTERN = /^(PL|IB)\d{10}(?:-\d{2})?$/i;
const ROUTING_FIELDS = [
  "type",
  "step",
  "stepCode",
  "id",
  "notifyId",
  "inputResultId",
  "bidOpenId",
  "techReqId",
  "bidPreNotifyResultId",
  "bidPreOpenId",
  "processApply",
  "bidMode",
  "notifyNo",
  "planNo",
  "pno",
  "isInternet",
  "caseKHKQ",
  "bidForm",
];


function canonicalIdentifier(value, kind) {
  const text = String(value || "").trim().toUpperCase();
  const match = IDENTIFIER_PATTERN.exec(text);
  const expectedPrefix = kind === "PLAN" ? "PL" : "IB";
  if (!match || match[1].toUpperCase() !== expectedPrefix) return null;
  return text.slice(0, 12);
}


export function isSameExactIdentifier(actual, expected, kind) {
  const actualCanonical = canonicalIdentifier(actual, kind);
  const expectedCanonical = canonicalIdentifier(expected, kind);
  return Boolean(
    actualCanonical
    && expectedCanonical
    && actualCanonical === expectedCanonical
  );
}


export async function detectCapabilities(page) {
  return page.evaluate(() => {
    const searchRoot = document.getElementById("search-home");
    const runtime = searchRoot?.__vue__;
    const vueInstances = new WeakSet();
    let vueInstanceCount = 0;
    let vue3 = false;
    let react = false;
    for (const element of Array.from(document.querySelectorAll?.("*") || []).slice(0, 1000)) {
      if (element?.__vue__ && !vueInstances.has(element.__vue__)) {
        vueInstances.add(element.__vue__);
        vueInstanceCount += 1;
      }
      if (element?.__vue_app__) vue3 = true;
      if (Object.keys(element || {}).some(
        (key) => key.startsWith("__reactFiber$") || key.startsWith("__reactProps$"),
      )) react = true;
    }
    if (runtime && !vueInstances.has(runtime)) vueInstanceCount += 1;
    const genericSearchUi = Boolean(document.querySelector?.(
      "input[placeholder*='Tìm'], input[aria-label*='Tìm'], "
      + "input[placeholder*='Mã KHLCNT'], "
      + "input[placeholder*='số TBMT'], "
      + "input[aria-label*='KHLCNT'], input[aria-label*='Lựa chọn nhà thầu'], "
      + "input[type='search'], button[aria-label*='Tìm']",
    ));
    return {
      vue2: Boolean(runtime),
      vue3,
      react,
      vueInstanceCount,
      knownSearchRoot: Boolean(searchRoot),
      knownRuntimeShape: Boolean(
        runtime
        && (
          typeof runtime.axiosSearch === "function"
          || typeof runtime.elasticSearch === "string"
          || runtime.$data
        )
      ),
      genericSearchUi,
      semanticDom: genericSearchUi,
    };
  });
}


export async function inspectVueState(page, code, kind, limits = {}) {
  return page.evaluate(({ exactCode, lookupKind, requestedLimits }) => {
    const maxDepth = Math.max(1, Math.min(requestedLimits.maxDepth || 7, 12));
    const maxObjects = Math.max(10, Math.min(requestedLimits.maxObjects || 2000, 5000));
    const maxArrayItems = Math.max(1, Math.min(requestedLimits.maxArrayItems || 200, 500));
    const maxPayloadBytes = Math.max(
      1024,
      Math.min(requestedLimits.maxPayloadBytes || 524288, 1048576),
    );
    const identifier = lookupKind === "PLAN" ? "planNo" : "notifyNo";
    const exactFamily = (value) => {
      const prefix = lookupKind === "PLAN" ? "PL" : "IB";
      const actual = String(value || "").trim().toUpperCase();
      const expected = String(exactCode || "").trim().toUpperCase();
      const pattern = new RegExp(`^${prefix}\\d{10}(?:-\\d{2})?$`);
      return pattern.test(actual)
        && pattern.test(expected)
        && actual.slice(0, 12) === expected.slice(0, 12);
    };
    const roots = [];
    const known = document.getElementById("search-home")?.__vue__;
    if (known) roots.push(known);
    const elements = document.querySelectorAll?.("*") || [];
    for (const element of Array.from(elements).slice(0, 1000)) {
      if (element?.__vue__ && !roots.includes(element.__vue__)) {
        roots.push(element.__vue__);
      }
    }

    const vueSeen = new WeakSet();
    const dataRoots = [];
    const vuePending = roots.map((value) => ({ value, depth: 0 }));
    while (vuePending.length && dataRoots.length < maxObjects) {
      const { value, depth } = vuePending.pop();
      if (!value || typeof value !== "object" || depth > maxDepth || vueSeen.has(value)) continue;
      vueSeen.add(value);
      if (value.$data && typeof value.$data === "object") dataRoots.push(value.$data);
      for (const child of Array.isArray(value.$children) ? value.$children.slice(0, maxArrayItems) : []) {
        vuePending.push({ value: child, depth: depth + 1 });
      }
    }

    const dataSeen = new WeakSet();
    const pending = dataRoots.map((value) => ({ value, depth: 0 }));
    const candidates = [];
    const signatures = new Set();
    let visited = 0;
    let outputBytes = 0;

    const clean = (root) => {
      const cleanSeen = new WeakSet();
      const copy = (value, depth) => {
        if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
        if (typeof value !== "object" || depth > maxDepth || cleanSeen.has(value)) return null;
        cleanSeen.add(value);
        if (Array.isArray(value)) {
          return value.slice(0, maxArrayItems).map((item) => copy(item, depth + 1));
        }
        const result = {};
        for (const [key, item] of Object.entries(value)) {
          if (key.startsWith("$") || key.startsWith("_") || typeof item === "function") continue;
          result[key] = copy(item, depth + 1);
        }
        return result;
      };
      return copy(root, 0);
    };

    while (pending.length && visited < maxObjects && outputBytes < maxPayloadBytes) {
      const { value, depth } = pending.pop();
      if (!value || typeof value !== "object" || depth > maxDepth || dataSeen.has(value)) continue;
      dataSeen.add(value);
      visited += 1;
      if (!Array.isArray(value) && exactFamily(value[identifier])) {
        const candidate = clean(value);
        const encoded = JSON.stringify(candidate);
        if (!signatures.has(encoded) && outputBytes + encoded.length <= maxPayloadBytes) {
          signatures.add(encoded);
          outputBytes += encoded.length;
          candidates.push(candidate);
        }
      }
      const children = Array.isArray(value)
        ? value.slice(0, maxArrayItems)
        : Object.entries(value)
          .filter(([key, item]) => !key.startsWith("$") && !key.startsWith("_") && typeof item !== "function")
          .map(([, item]) => item);
      for (const child of children) pending.push({ value: child, depth: depth + 1 });
    }
    return candidates;
  }, { exactCode: code, lookupKind: kind, requestedLimits: limits });
}


export async function inspectFrameworkState(
  page,
  code,
  kind,
  framework,
  limits = {},
) {
  return page.evaluate(({
    exactCode,
    lookupKind,
    requestedFramework,
    requestedLimits,
  }) => {
    const maxDepth = Math.max(1, Math.min(requestedLimits.maxDepth || 7, 12));
    const maxObjects = Math.max(10, Math.min(requestedLimits.maxObjects || 2000, 5000));
    const maxArrayItems = Math.max(1, Math.min(requestedLimits.maxArrayItems || 200, 500));
    const maxPayloadBytes = Math.max(
      1024,
      Math.min(requestedLimits.maxPayloadBytes || 524288, 1048576),
    );
    const identifier = lookupKind === "PLAN" ? "planNo" : "notifyNo";
    const exactFamily = (value) => {
      const prefix = lookupKind === "PLAN" ? "PL" : "IB";
      const actual = String(value || "").trim().toUpperCase();
      const expected = String(exactCode || "").trim().toUpperCase();
      const pattern = new RegExp(`^${prefix}\\d{10}(?:-\\d{2})?$`);
      return pattern.test(actual)
        && pattern.test(expected)
        && actual.slice(0, 12) === expected.slice(0, 12);
    };
    const roots = [];
    for (const element of Array.from(document.querySelectorAll?.("*") || []).slice(0, 1000)) {
      if (requestedFramework === "vue3") {
        const component = element?.__vueParentComponent;
        const instance = element?.__vue_app__?._instance;
        for (const candidate of [
          component?.setupState,
          component?.data,
          component?.props,
          instance?.setupState,
          instance?.data,
          instance?.proxy,
        ]) {
          if (candidate && typeof candidate === "object") roots.push(candidate);
        }
      } else if (requestedFramework === "react") {
        const key = Object.keys(element || {}).find(
          (name) => name.startsWith("__reactFiber$") || name.startsWith("__reactProps$"),
        );
        const fiber = key ? element[key] : null;
        for (const candidate of [
          fiber?.memoizedProps,
          fiber?.memoizedState,
          fiber?.stateNode?.state,
        ]) {
          if (candidate && typeof candidate === "object") roots.push(candidate);
        }
      }
    }

    const seen = new WeakSet();
    const pending = roots.map((value) => ({ value, depth: 0 }));
    const candidates = [];
    const signatures = new Set();
    let visited = 0;
    let outputBytes = 0;
    const clean = (root) => {
      const cleanSeen = new WeakSet();
      const copy = (value, depth) => {
        if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
          return value;
        }
        if (typeof value !== "object" || depth > maxDepth || cleanSeen.has(value)) return null;
        cleanSeen.add(value);
        if (Array.isArray(value)) {
          return value.slice(0, maxArrayItems).map((item) => copy(item, depth + 1));
        }
        const result = {};
        for (const [key, item] of Object.entries(value)) {
          if (key.startsWith("$") || typeof item === "function") continue;
          result[key] = copy(item, depth + 1);
        }
        return result;
      };
      return copy(root, 0);
    };

    while (pending.length && visited < maxObjects && outputBytes < maxPayloadBytes) {
      const { value, depth } = pending.pop();
      if (!value || typeof value !== "object" || depth > maxDepth || seen.has(value)) continue;
      seen.add(value);
      visited += 1;
      if (!Array.isArray(value) && exactFamily(value[identifier])) {
        const candidate = clean(value);
        const encoded = JSON.stringify(candidate);
        if (!signatures.has(encoded) && outputBytes + encoded.length <= maxPayloadBytes) {
          signatures.add(encoded);
          outputBytes += encoded.length;
          candidates.push(candidate);
        }
      }
      const children = Array.isArray(value)
        ? value.slice(0, maxArrayItems)
        : Object.values(value).filter((item) => typeof item !== "function");
      for (const child of children) pending.push({ value: child, depth: depth + 1 });
    }
    return candidates;
  }, {
    exactCode: code,
    lookupKind: kind,
    requestedFramework: framework,
    requestedLimits: limits,
  });
}


export function inspectVue3State(page, code, kind, limits = {}) {
  return inspectFrameworkState(page, code, kind, "vue3", limits);
}


export function inspectReactState(page, code, kind, limits = {}) {
  return inspectFrameworkState(page, code, kind, "react", limits);
}


export const DetailUrlBuilder = Object.freeze({
  build(routing) {
    const url = new URL(DETAIL_PATH, OFFICIAL_ORIGIN);
    url.searchParams.set(
      "p_p_id",
      "egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2",
    );
    url.searchParams.set("p_p_lifecycle", "0");
    url.searchParams.set("p_p_state", "normal");
    url.searchParams.set("p_p_mode", "view");
    url.searchParams.set(
      "_egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2_render",
      "detail-v2",
    );
    for (const field of ROUTING_FIELDS) {
      const value = routing?.[field];
      if (value === null || value === undefined || value === "") continue;
      const text = String(value).trim();
      if (!text || ["null", "undefined"].includes(text.toLowerCase())) continue;
      url.searchParams.set(field, text);
    }
    return url.toString();
  },
});


export function redactResponseUrl(value) {
  const parsed = new URL(String(value));
  return `${parsed.origin}${parsed.pathname}`;
}


export async function isInteractionRequired(page) {
  return page.evaluate(() => {
    const text = String(document.body?.innerText || "").toLowerCase();
    const challengeText = [
      "captcha",
      "checking your browser",
      "access denied",
      "truy cập bị từ chối",
      "xác minh bạn không phải là robot",
    ];
    return challengeText.some((value) => text.includes(value))
      || Boolean(document.querySelector?.("iframe[src*='recaptcha'], .g-recaptcha"));
  });
}


export function hasExactIdentifier(value, code, kind, limits = {}) {
  const identifier = kind === "PLAN" ? "planNo" : "notifyNo";
  const maxDepth = Math.max(1, Math.min(limits.maxDepth || 7, 12));
  const maxObjects = Math.max(10, Math.min(limits.maxObjects || 2000, 5000));
  const maxArrayItems = Math.max(1, Math.min(limits.maxArrayItems || 200, 500));
  const pending = [{ value, depth: 0 }];
  const seen = new WeakSet();
  let visited = 0;
  while (pending.length && visited < maxObjects) {
    const item = pending.pop();
    const current = item.value;
    if (!current || typeof current !== "object" || item.depth > maxDepth || seen.has(current)) continue;
    seen.add(current);
    visited += 1;
    if (!Array.isArray(current)
      && isSameExactIdentifier(current[identifier], code, kind)) {
      return true;
    }
    const children = Array.isArray(current)
      ? current.slice(0, maxArrayItems)
      : Object.values(current);
    for (const child of children) pending.push({ value: child, depth: item.depth + 1 });
  }
  return false;
}


export function findExactRoutingCandidate(value, code, kind) {
  const identifier = kind === "PLAN" ? "planNo" : "notifyNo";
  const routingKeys = new Set(ROUTING_FIELDS);
  const pending = [{ value, depth: 0 }];
  const seen = new WeakSet();
  const matches = [];
  let visited = 0;
  while (pending.length && visited < 2000) {
    const item = pending.pop();
    const current = item.value;
    if (!current || typeof current !== "object" || item.depth > 7 || seen.has(current)) continue;
    seen.add(current);
    visited += 1;
    if (!Array.isArray(current)
      && isSameExactIdentifier(current[identifier], code, kind)) {
      const routing = {};
      for (const key of ROUTING_FIELDS) {
        if (current[key] !== null && current[key] !== undefined && current[key] !== "") {
          routing[key] = current[key];
        }
      }
      matches.push({
        routing,
        score: Object.keys(current).filter((key) => routingKeys.has(key)).length,
      });
    }
    const children = Array.isArray(current)
      ? current.slice(0, 200)
      : Object.values(current);
    for (const child of children) pending.push({ value: child, depth: item.depth + 1 });
  }
  if (!matches.length) throw new Error("PROCUREMENT_NOT_FOUND");
  return matches.sort((left, right) => right.score - left.score)[0].routing;
}


export async function extractSemanticDomCandidates(page, code, kind) {
  return page.evaluate(({ exactCode, lookupKind }) => {
    const identifier = lookupKind === "PLAN" ? "planNo" : "notifyNo";
    const bodyText = String(document.body?.innerText || "");
    const escapedCode = exactCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const exactPattern = new RegExp(
      `(?:^|[^A-Z0-9])${escapedCode}(?:-\\d{2})?(?![A-Z0-9-])`,
      "i",
    );
    if (!exactPattern.test(bodyText)) return [];
    const result = { [identifier]: exactCode };
    const labelMap = new Map([
      ["mã tbmt", "notifyNo"],
      ["mã khlcnt", "planNo"],
      ["tên kế hoạch", "planName"],
      ["tên gói thầu", "bidName"],
      ["chủ đầu tư", "investorName"],
      ["bên mời thầu", "procuringEntityName"],
      ["chi tiết nguồn vốn", "capitalDetail"],
      ["giá gói thầu", "bidPrice"],
      ["dự toán gói thầu", "bidEstimatePrice"],
      ["nguồn vốn", "capitalDetail"],
      ["lĩnh vực", "bidField"],
      ["hình thức lựa chọn nhà thầu", "bidForm"],
      ["phương thức lựa chọn nhà thầu", "bidMode"],
      ["quy trình áp dụng", "processApply"],
      ["loại hợp đồng", "contractType"],
      ["thời gian thực hiện gói thầu", "implementationPeriod"],
      ["thời gian thực hiện hợp đồng", "implementationPeriod"],
      ["thời điểm đóng thầu", "bidCloseDate"],
      ["thời điểm mở thầu", "bidOpenDate"],
    ]);
    const rows = document.querySelectorAll?.(
      "tr, dt, .form-group, .field-row, .infomation__content",
    ) || [];
    for (const row of Array.from(rows).slice(0, 300)) {
      let values = Array.from(row.children || [])
        .map((cell) => String(cell.textContent || "").trim())
        .filter(Boolean);
      if (values.length < 2) {
        const cells = row.querySelectorAll?.(
          "th, td, dt, dd, label, .label, .value",
        ) || [];
        values = Array.from(cells)
          .map((cell) => String(cell.textContent || "").trim())
          .filter(Boolean);
      }
      if (values.length < 2) continue;
      const normalizedLabel = values[0].toLowerCase().replace(/[:*]/g, "").trim();
      for (const [label, field] of labelMap) {
        if (normalizedLabel.includes(label) && result[field] === undefined) {
          const value = values.slice(1).join(" ").trim();
          if (["bidPrice", "bidEstimatePrice"].includes(field)) {
            const digits = value.replace(/[^0-9]/g, "");
            const amount = digits ? Number(digits) : Number.NaN;
            if (Number.isSafeInteger(amount)) {
              result[field] = amount;
              result.bidPriceUnit = /vnd|₫/i.test(value) ? "VND" : null;
            }
          } else {
            result[field] = value;
          }
        }
      }
    }
    return [result];
  }, { exactCode: code, lookupKind: kind });
}


export class NetworkCollector {
  constructor({ code, kind, maxResponseBytes = 1_048_576, maxResponses = 64 }) {
    this.code = String(code).trim().toUpperCase();
    this.kind = String(kind).trim().toUpperCase();
    this.maxResponseBytes = Math.max(1024, Math.min(maxResponseBytes, 8_388_608));
    this.maxResponses = Math.max(1, Math.min(maxResponses, 256));
    this.responses = [];
    this.page = null;
    this.startedAt = 0;
    this.match = null;
    this.resolveMatch = null;
    this.rejectMatch = null;
    this.timeout = null;
    this.onResponse = (response) => this.handleResponse(response);
  }

  start(page) {
    if (this.page) throw new Error("NetworkCollector already started");
    this.page = page;
    this.startedAt = performance.now();
    page.on("response", this.onResponse);
  }

  stop() {
    if (this.page) this.page.off("response", this.onResponse);
    this.page = null;
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = null;
  }

  async handleResponse(response) {
    if (this.responses.length >= this.maxResponses) return;
    const headers = response.headers();
    const contentType = String(headers["content-type"] || "").toLowerCase();
    if (!contentType.includes("json")) return;
    let raw;
    try {
      raw = await response.body();
    } catch {
      return;
    }
    if (!raw || raw.byteLength > this.maxResponseBytes) return;
    let body;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      return;
    }
    if (!body || typeof body !== "object") return;
    const row = {
      url: redactResponseUrl(response.url()),
      method: response.request().method(),
      status: response.status(),
      contentType: headers["content-type"] || "",
      durationMs: Math.max(0, Math.round((performance.now() - this.startedAt) * 1000) / 1000),
      body,
    };
    this.responses.push(row);
    if (!this.match && hasExactIdentifier(body, this.code, this.kind)) {
      this.match = body;
      if (this.resolveMatch) {
        this.resolveMatch(body);
        this.resolveMatch = null;
        this.rejectMatch = null;
        if (this.timeout) clearTimeout(this.timeout);
        this.timeout = null;
      }
    }
  }

  waitForExact(timeoutMs) {
    if (this.match) return Promise.resolve(this.match);
    if (this.resolveMatch) throw new Error("Exact response wait already active");
    return new Promise((resolve, reject) => {
      this.resolveMatch = resolve;
      this.rejectMatch = reject;
      this.timeout = setTimeout(() => {
        this.resolveMatch = null;
        this.rejectMatch = null;
        this.timeout = null;
        reject(new Error("PROCUREMENT_TIMEOUT"));
      }, Math.max(1, timeoutMs));
    });
  }
}
