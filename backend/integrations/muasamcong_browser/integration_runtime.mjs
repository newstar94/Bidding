import { MscApiClient } from "./api_client.mjs";
import { MscCollectors } from "./collectors.mjs";
import { MscSessionProvider } from "./session_provider.mjs";
import { ENDPOINT_PROFILES, MSC_PROFILE_ID } from "./endpoint_catalog.mjs";


export class MscIntegrationRuntime {
  constructor({ puppeteer, fetchImpl = globalThis.fetch }) {
    this.puppeteer = puppeteer;
    this.fetchImpl = fetchImpl;
    this.sessionProvider = null;
    this.client = null;
    this.collectors = null;
    this.profileId = MSC_PROFILE_ID;
  }

  initialize(configuration = {}) {
    this.profileId = String(configuration.endpointProfile || MSC_PROFILE_ID);
    if (!ENDPOINT_PROFILES[this.profileId]) {
      throw new Error("PROCUREMENT_ENDPOINT_CHANGED");
    }
    this.sessionProvider = new MscSessionProvider({
      puppeteer: this.puppeteer,
      executablePath: String(configuration.browserExecutablePath || ""),
      fallbackExecutablePath: String(
        configuration.fallbackBrowserExecutablePath || "",
      ),
      ttlMs: Number(configuration.sessionTtlMs) || 1_800_000,
      navigationTimeoutMs: Number(configuration.navigationTimeoutMs) || 20_000,
      sessionTimeoutMs: Number(configuration.sessionTimeoutMs) || 60_000,
      headless: configuration.headless !== false,
      fetchImpl: this.fetchImpl,
    });
    this.client = new MscApiClient({
      sessionProvider: this.sessionProvider,
      fetchImpl: this.fetchImpl,
      timeoutMs: Number(configuration.apiTimeoutMs) || 15_000,
      maxResponseBytes: Number(configuration.maxResponseBytes) || 4_194_304,
      retries: Number(configuration.apiRetries) || 1,
      profileId: this.profileId,
      circuitMs: Number(configuration.apiCircuitMs) || 30_000,
      maxConcurrency: Number(configuration.apiMaxConcurrency) || 6,
      queueTimeoutMs: Number(configuration.apiQueueTimeoutMs) || 5_000,
    });
    this.collectors = new MscCollectors({
      client: this.client,
      collectionConcurrency: Number(configuration.collectionConcurrency) || 4,
    });
    return { ready: true, profile: this.profileId, sessionProvider: "BrowserSessionV1" };
  }

  _ready() {
    if (!this.collectors) throw new Error("PROCUREMENT_BROWSER_FAILED");
  }

  async listPlanRevisions(planNo) {
    this._ready();
    return this.collectors.listPlanRevisions(planNo);
  }

  async getPlanRevision(planNo, revisionId) {
    this._ready();
    return this.collectors.getPlanRevision(planNo, revisionId);
  }

  async listNoticeRevisions(noticeNo) {
    this._ready();
    return this.collectors.listNoticeRevisions(noticeNo);
  }

  async getNoticeRevision(noticeNo, revisionId) {
    this._ready();
    return this.collectors.getNoticeRevision(noticeNo, revisionId);
  }

  async getOpeningBundle(noticeNo, revisionId) {
    this._ready();
    return this.collectors.getOpeningBundle(noticeNo, revisionId);
  }

  async getResultBundle(noticeNo, revisionId) {
    this._ready();
    return this.collectors.getResultBundle(noticeNo, revisionId);
  }

  async collectCompleteBundle(record, options = {}) {
    this._ready();
    return this.collectors.collectCompleteBundle(record, options);
  }

  async search(code, kind) {
    this._ready();
    return this.collectors.search(code, kind);
  }

  async refreshSession() {
    this._ready();
    await this.sessionProvider.refresh();
    return { refreshed: true, health: this.sessionProvider.health() };
  }

  health() {
    this._ready();
    const session = this.sessionProvider.health();
    const api = this.client.health();
    return {
      profile: this.profileId,
      session,
      api,
      status: api.status !== "UP" ? api.status : session.status,
    };
  }

  close() {
    this.sessionProvider?.invalidate();
    this.sessionProvider = null;
    this.client = null;
    this.collectors = null;
    this.profileId = MSC_PROFILE_ID;
  }
}

