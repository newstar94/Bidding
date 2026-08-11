import { selectDriver } from "./drivers.mjs";
import { ExtractorRegistry } from "./extractors.mjs";
import {
  DetailUrlBuilder,
  NetworkCollector,
  detectCapabilities,
  extractSemanticDomCandidates,
  findExactRoutingCandidate,
  inspectVueState,
  isInteractionRequired,
} from "./runtime_support.mjs";


const OFFICIAL_HOST = "muasamcong.mpi.gov.vn";
export const SEARCH_URL = `https://${OFFICIAL_HOST}/vi/web/guest/contractor-selection?render=search`;


async function isKnownUpstreamFailure(page, response) {
  const status = typeof response?.status === "function" ? response.status() : 0;
  if (status >= 400) return true;
  if (typeof page?.title !== "function") return false;
  try {
    return String(await page.title()).trim().toLowerCase() === "error";
  } catch {
    return false;
  }
}


function isTransientNavigationError(error) {
  const code = String(error?.message || error || "");
  return code === "PROCUREMENT_UPSTREAM_UNAVAILABLE" || /timeout/i.test(code);
}


export class BrowserLookupRuntime {
  constructor({
    chromium,
    capabilityDetector = detectCapabilities,
    driverSelector = selectDriver,
    collectorFactory = (options) => new NetworkCollector(options),
    vueInspector = inspectVueState,
    domExtractor = extractSemanticDomCandidates,
    interactionDetector = isInteractionRequired,
    upstreamFailureDetector = isKnownUpstreamFailure,
    extractorRegistry = null,
    clock = () => performance.now(),
  }) {
    this.chromium = chromium;
    this.capabilityDetector = capabilityDetector;
    this.driverSelector = driverSelector;
    this.collectorFactory = collectorFactory;
    this.vueInspector = vueInspector;
    this.domExtractor = domExtractor;
    this.interactionDetector = interactionDetector;
    this.upstreamFailureDetector = upstreamFailureDetector;
    this.extractorRegistry = extractorRegistry || new ExtractorRegistry({
      vueInspector,
      domExtractor,
    });
    this.clock = clock;
    this.browser = null;
    this.context = null;
    this.configuration = null;
    this.vue2FailureCount = 0;
    this.vue2DisabledUntil = 0;
    this.pendingBrowserStartupMs = 0;
  }

  async initialize(configuration) {
    const startupStarted = this.clock();
    const safe = {
      headless: configuration?.headless === true,
      browserMode: String(configuration?.browserMode || "standard"),
      targetHost: String(configuration?.targetHost || ""),
      chromiumArgs: Array.isArray(configuration?.chromiumArgs)
        ? configuration.chromiumArgs
        : [],
      drivers: {
        vue2: configuration?.drivers?.vue2 !== false,
        generic: configuration?.drivers?.generic !== false,
      },
      extractors: {
        network: configuration?.extractors?.network !== false,
        vue: configuration?.extractors?.vue !== false,
        dom: configuration?.extractors?.dom !== false,
      },
      maxResponseBytes: Math.max(
        65_536,
        Math.min(Number(configuration?.maxResponseBytes) || 1_048_576, 4_194_304),
      ),
      navigationTimeoutMs: Math.max(
        5_000,
        Math.min(Number(configuration?.navigationTimeoutMs) || 20_000, 60_000),
      ),
      actionTimeoutMs: Math.max(
        5_000,
        Math.min(Number(configuration?.actionTimeoutMs) || 15_000, 60_000),
      ),
    };
    if (!safe.headless
      || !["standard", "research-stealth"].includes(safe.browserMode)
      || safe.targetHost !== OFFICIAL_HOST
      || safe.chromiumArgs.length !== 0
      || !Object.values(safe.drivers).some(Boolean)
      || !Object.values(safe.extractors).some(Boolean)) {
      throw new Error("PROCUREMENT_ADAPTER_UNSUPPORTED");
    }
    this.configuration = safe;
    this.browser = await this.chromium.launch({ headless: true, args: [] });
    this.context = await this.browser.newContext({
      locale: "vi-VN",
      serviceWorkers: "block",
    });
    this.pendingBrowserStartupMs = Math.max(0, this.clock() - startupStarted);
    return { ready: true, browserStartupMs: this.pendingBrowserStartupMs };
  }

  async navigate(page, url) {
    const attemptTimeoutMs = Math.max(
      2_500,
      Math.floor(this.configuration.navigationTimeoutMs / 2),
    );
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: attemptTimeoutMs,
        });
        if (await this.interactionDetector(page)) {
          throw new Error("PROCUREMENT_INTERACTION_REQUIRED");
        }
        if (await this.upstreamFailureDetector(page, response)) {
          throw new Error("PROCUREMENT_UPSTREAM_UNAVAILABLE");
        }
        return response;
      } catch (error) {
        lastError = error;
        if (
          attempt > 0
          || String(error?.message) === "PROCUREMENT_INTERACTION_REQUIRED"
          || !isTransientNavigationError(error)
        ) {
          throw error;
        }
      }
    }
    throw lastError;
  }

  async lookup(code, kind) {
    if (!this.context) throw new Error("PROCUREMENT_BROWSER_FAILED");
    const started = this.clock();
    const page = await this.context.newPage();
    let searchCollector;
    let detailCollector;
    try {
      const navigationStarted = this.clock();
      await this.navigate(page, SEARCH_URL);
      const navigationMs = this.clock() - navigationStarted;
      const capabilities = await this.capabilityDetector(page);
      const vue2CircuitOpen = this.vue2DisabledUntil > this.clock();
      const driverFlags = {
        vue2: this.configuration.drivers.vue2 && !vue2CircuitOpen,
        generic: this.configuration.drivers.generic,
      };
      let driver = this.driverSelector(capabilities, driverFlags);

      searchCollector = this.collectorFactory({
        code,
        kind,
        maxResponseBytes: this.configuration.maxResponseBytes,
      });
      searchCollector.start(page);
      const actionStarted = this.clock();
      const searchWait = searchCollector.waitForExact(
        this.configuration.actionTimeoutMs,
      );
      try {
        await driver.performLookup(page, code, kind);
        if (driver.name === "vue2") this.vue2FailureCount = 0;
      } catch (error) {
        const canFallback = driver.name === "vue2"
          && this.configuration.drivers.generic
          && capabilities.genericSearchUi;
        if (!canFallback) throw error;
        this.vue2FailureCount += 1;
        if (this.vue2FailureCount >= 3) {
          this.vue2DisabledUntil = this.clock() + 60_000;
        }
        driver = this.driverSelector(capabilities, { vue2: false, generic: true });
        await driver.performLookup(page, code, kind);
      }
      let searchPayload;
      try {
        searchPayload = await searchWait;
      } catch (error) {
        if (await this.interactionDetector(page)) {
          throw new Error("PROCUREMENT_INTERACTION_REQUIRED");
        }
        throw error;
      }
      const lookupActionMs = this.clock() - actionStarted;
      searchCollector.stop();
      const routing = findExactRoutingCandidate(searchPayload, code, kind);

      detailCollector = this.collectorFactory({
        code,
        kind,
        maxResponseBytes: this.configuration.maxResponseBytes,
      });
      detailCollector.start(page);
      const detailWait = detailCollector.waitForExact(
        this.configuration.actionTimeoutMs,
      );
      await this.navigate(page, DetailUrlBuilder.build(routing));
      let detailPayload = null;
      try {
        detailPayload = await detailWait;
      } catch (error) {
        if (await this.interactionDetector(page)) {
          throw new Error("PROCUREMENT_INTERACTION_REQUIRED");
        }
        if (String(error?.message) !== "PROCUREMENT_TIMEOUT") throw error;
      } finally {
        detailCollector.stop();
      }

      const extractStarted = this.clock();
      const extraction = await this.extractorRegistry.extract({
        page,
        code,
        kind,
        networkPayload: detailPayload,
        flags: this.configuration.extractors,
      });
      const selectedDetailPayload = extraction.networkPayload;
      const { vueStateCandidates, domCandidates } = extraction;
      if (!selectedDetailPayload && !vueStateCandidates.length && !domCandidates.length) {
        throw new Error("PROCUREMENT_SCHEMA_CHANGED");
      }
      const extractMs = this.clock() - extractStarted;
      const artifact = {
        schemaVersion: "muasamcong-browser-artifact-v1",
        browserMode: this.configuration.browserMode,
        framework: capabilities.vue2 ? "vue2" : "unknown",
        capabilities,
        driver: driver.name,
        driverVersion: driver.version,
        networkResponses: [
          ...(this.configuration.extractors.network
            ? [...(detailCollector.responses || []), ...(searchCollector.responses || [])]
            : []),
        ],
        vueStateCandidates,
        domCandidates,
        metrics: {
          browserStartupMs: this.pendingBrowserStartupMs,
          navigationMs,
          lookupActionMs,
          networkWaitMs: lookupActionMs,
          extractMs,
          totalMs: this.clock() - started,
        },
        diagnostics: {
          networkResponseCount: (detailCollector.responses?.length || 0)
            + (searchCollector.responses?.length || 0),
          vueInstanceCount: vueStateCandidates.length,
          matchingCandidates: selectedDetailPayload
            ? 1
            : vueStateCandidates.length + domCandidates.length,
          extractorSelected: extraction.strategy,
        },
      };
      this.pendingBrowserStartupMs = 0;
      return artifact;
    } finally {
      searchCollector?.stop();
      detailCollector?.stop();
      await page.close();
    }
  }

  async probe() {
    if (!this.context) throw new Error("PROCUREMENT_BROWSER_FAILED");
    const page = await this.context.newPage();
    try {
      const navigationStarted = this.clock();
      await this.navigate(page, SEARCH_URL);
      const capabilities = await this.capabilityDetector(page);
      const interactionRequired = await this.interactionDetector(page);
      const driverCandidate = (
        this.configuration.drivers.vue2
        && capabilities.vue2
        && capabilities.knownRuntimeShape
      )
        ? "vue2"
        : this.configuration.drivers.generic && capabilities.genericSearchUi
          ? "generic"
          : null;
      return {
        schemaVersion: "muasamcong-browser-probe-v1",
        browserMode: this.configuration.browserMode,
        framework: capabilities.vue2 ? "vue2" : "unknown",
        capabilities,
        interactionRequired,
        driverCandidate,
        metrics: {
          browserStartupMs: this.pendingBrowserStartupMs,
          navigationMs: Math.max(0, this.clock() - navigationStarted),
        },
        diagnostics: {
          networkResponseCount: 0,
          vueInstanceCount: Number(capabilities.vueInstanceCount || 0),
          matchingCandidates: 0,
          extractorSelected: "unknown",
        },
      };
    } finally {
      await page.close();
    }
  }

  async close() {
    await this.context?.close();
    await this.browser?.close();
    this.context = null;
    this.browser = null;
  }
}
