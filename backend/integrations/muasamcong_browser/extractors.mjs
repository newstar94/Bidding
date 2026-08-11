export class ExtractorRegistry {
  constructor({ vueInspector, domExtractor }) {
    this.extractors = new Map([
      ["vue-state:2026.1", vueInspector],
      ["semantic-dom:2026.1", domExtractor],
    ]);
  }

  async extract({ page, code, kind, networkPayload, flags = {} }) {
    if (flags.network !== false && networkPayload) {
      return {
        strategy: "network-json",
        networkPayload,
        vueStateCandidates: [],
        domCandidates: [],
      };
    }
    const vueStateCandidates = flags.vue !== false
      ? await this.extractors.get("vue-state:2026.1")(page, code, kind)
      : [];
    if (vueStateCandidates.length) {
      return {
        strategy: "vue-state",
        networkPayload: null,
        vueStateCandidates,
        domCandidates: [],
      };
    }
    const domCandidates = flags.dom !== false
      ? await this.extractors.get("semantic-dom:2026.1")(page, code, kind)
      : [];
    return {
      strategy: domCandidates.length ? "semantic-dom" : null,
      networkPayload: null,
      vueStateCandidates: [],
      domCandidates,
    };
  }
}
