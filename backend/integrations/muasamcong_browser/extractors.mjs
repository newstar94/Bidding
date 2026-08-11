export class NetworkExtractor {
  constructor() { this.name = "network-json"; this.version = "2026.08"; }
  extract({ networkPayload }) { return networkPayload ? [networkPayload] : []; }
}


class StateExtractor {
  constructor(name, inspector) {
    this.name = name;
    this.version = "2026.08";
    this.inspector = inspector || (async () => []);
  }

  async extract({ page, code, kind }) {
    try {
      const rows = await this.inspector(page, code, kind);
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }
}


export class Vue2Extractor extends StateExtractor {
  constructor(inspector) { super("vue-state", inspector); }
}


export class Vue3Extractor extends StateExtractor {
  constructor(inspector) { super("vue3-state", inspector); }
}


export class ReactExtractor extends StateExtractor {
  constructor(inspector) { super("react-state", inspector); }
}


export class SemanticDomExtractor extends StateExtractor {
  constructor(inspector) { super("semantic-dom", inspector); }
}


export class ExtractorRegistry {
  constructor({ vueInspector, vue3Inspector, reactInspector, domExtractor }) {
    this.extractors = [
      new NetworkExtractor(),
      new Vue2Extractor(vueInspector),
      new Vue3Extractor(vue3Inspector),
      new ReactExtractor(reactInspector),
      new SemanticDomExtractor(domExtractor),
    ];
  }

  async extract({ page, code, kind, networkPayload, flags = {} }) {
    const empty = {
      networkPayload: null,
      vueStateCandidates: [],
      domCandidates: [],
    };
    const network = this.extractors[0];
    const networkCandidates = flags.network !== false
      ? network.extract({ networkPayload })
      : [];
    if (networkCandidates.length) {
      return {
        ...empty,
        strategy: network.name,
        networkPayload: networkCandidates[0],
      };
    }
    for (const extractor of this.extractors.slice(1)) {
      const enabled = extractor.name === "semantic-dom"
        ? flags.dom !== false
        : extractor.name === "react-state"
          ? flags.react !== false
          : extractor.name === "vue3-state"
            ? flags.vue !== false && flags.vue3 !== false
            : flags.vue !== false;
      if (!enabled) continue;
      const candidates = await extractor.extract({ page, code, kind });
      if (!candidates.length) continue;
      return {
        ...empty,
        strategy: extractor.name,
        ...(extractor.name === "semantic-dom"
          ? { domCandidates: candidates }
          : { vueStateCandidates: candidates }),
      };
    }
    return { ...empty, strategy: null };
  }
}
