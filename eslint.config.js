const trustedHtmlSinkRule = {
  meta: {
    type: "problem",
    messages: {
      trusted: "HTML sinks must receive trustedHTML(...).",
      forbidden: "This dynamic HTML sink is forbidden."
    },
    schema: []
  },
  create(context) {
    const propertyName = (node) => (
      node?.computed && node.property?.type === "Literal"
        ? node.property.value
        : node?.property?.name
    );
    const isTrustedCall = (node) => (
      node?.type === "CallExpression"
      && node.callee?.type === "Identifier"
      && node.callee.name === "trustedHTML"
    );
    return {
      AssignmentExpression(node) {
        if (
          node.operator === "="
          && node.left?.type === "MemberExpression"
          && ["innerHTML", "outerHTML"].includes(propertyName(node.left))
          && !isTrustedCall(node.right)
        ) {
          context.report({ node, messageId: "trusted" });
        }
        if (
          node.operator === "="
          && node.left?.type === "MemberExpression"
          && propertyName(node.left) === "srcdoc"
        ) {
          context.report({ node, messageId: "forbidden" });
        }
      },
      CallExpression(node) {
        if (node.callee?.type !== "MemberExpression") return;
        const name = propertyName(node.callee);
        if (
          name === "insertAdjacentHTML"
          && !isTrustedCall(node.arguments[1])
        ) {
          context.report({ node, messageId: "trusted" });
        }
        if (["write", "writeln", "createContextualFragment"].includes(name)) {
          context.report({ node, messageId: "forbidden" });
        }
      }
    };
  }
};

const biddingflowSecurityPlugin = {
  rules: {
    "trusted-html-sinks": trustedHtmlSinkRule
  }
};

export default [
  {
    ignores: ["dist/**", "node_modules/**", "views/vendor/**"]
  },
  {
    files: ["frontend/**/*.js"],
    plugins: { biddingflow: biddingflowSecurityPlugin },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        globalThis: "readonly",
        window: "readonly",
        document: "readonly",
        sessionStorage: "readonly",
        localStorage: "readonly",
        fetch: "readonly",
        URL: "readonly",
        Blob: "readonly",
        FileReader: "readonly",
        Image: "readonly",
        MutationObserver: "readonly",
        ResizeObserver: "readonly",
        requestAnimationFrame: "readonly",
        requestIdleCallback: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        navigator: "readonly",
        console: "readonly",
        CustomEvent: "readonly",
        Event: "readonly",
        CSS: "readonly",
        Node: "readonly",
        HTMLElement: "readonly",
        HTMLInputElement: "readonly",
        AbortController: "readonly",
        crypto: "readonly",
        structuredClone: "readonly",
        performance: "readonly",
        atob: "readonly",
        btoa: "readonly",
        google: "readonly",
        lucide: "readonly",
        flatpickr: "readonly",
        XLSX: "readonly",
        Chart: "readonly",
        __BIDDINGFLOW_RELEASE_ID__: "readonly"
      }
    },
    rules: {
      "biddingflow/trusted-html-sinks": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-script-url": "error"
    }
  }
];
