import { classForRuntimeDeclarations } from "./runtimeStyles.js";
import DOMPurify from "../../node_modules/dompurify/dist/purify.es.mjs";

const trustedTypesApi = globalThis.trustedTypes;

const UNSAFE_HTML_PATTERNS = [
  /<\/?(?:script|iframe|object|embed|base|meta)\b/i,
  /\s(?:on[a-z]+|srcdoc)\s*=/i,
  /(?:href|src|action|formaction)\s*=\s*["']?\s*(?:javascript|vbscript):/i,
  /data\s*:\s*text\/html/i
];

export function assertSafeHTML(value) {
  const source = String(value ?? "");
  const violation = UNSAFE_HTML_PATTERNS.find((pattern) => pattern.test(source));
  if (violation) throw new TypeError("Unsafe HTML rejected by the application Trusted Types policy");
  return source;
}

function migrateStyleAttributes(source) {
  return source.replace(/<[^>]+>/g, tag => {
    if (/^<\//.test(tag) || !/\sstyle\s*=/i.test(tag)) return tag;
    const declarations = [];
    let migrated = tag.replace(/\sstyle\s*=\s*(["'])(.*?)\1/gi, (_match, _quote, css) => {
      declarations.push(css);
      return "";
    });
    const className = classForRuntimeDeclarations(declarations.join(";"));
    if (!className) return migrated;
    if (/\sclass\s*=\s*(["'])/i.test(migrated)) {
      migrated = migrated.replace(/(\sclass\s*=\s*)(["'])(.*?)\2/i, (_match, prefix, quote, classes) => `${prefix}${quote}${classes} ${className}${quote}`);
    } else {
      migrated = migrated.replace(/\s*\/?>(\s*)$/, match => ` class="${className}"${match}`);
    }
    return migrated;
  });
}

export function assertSafeScriptURL(value) {
  const source = String(value ?? "");
  if (/^\/(?:frontend|vendor)\/[A-Za-z0-9._~!$&'()*+,;=:@/%?-]+$/.test(source)) return source;
  if (source === "https://accounts.google.com/gsi/client") return source;
  throw new TypeError("Unapproved script URL rejected by the application Trusted Types policy");
}

export function assertSafeStyleURL(value) {
  const source = String(value ?? "");
  if (/^\/(?:frontend|vendor)\/[A-Za-z0-9._~!$&'()*+,;=:@/%?-]+\.css(?:\?[A-Za-z0-9._~!$&'()*+,;=:@/%?-]*)?$/.test(source)) {
    return source;
  }
  throw new TypeError("Unapproved stylesheet URL rejected by the application security policy");
}

const TRUSTED_POLICY_CACHE_KEY = "__BF_TRUSTED_HTML_POLICY__";

function sanitizeHTML(value) {
  const migrated = migrateStyleAttributes(assertSafeHTML(value));
  if (!DOMPurify.isSupported) {
    throw new TypeError("HTML sanitizer is unavailable in this browser");
  }
  return DOMPurify.sanitize(migrated, {
    RETURN_TRUSTED_TYPE: false,
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    FORBID_TAGS: ["script", "iframe", "object", "embed", "base", "meta"],
    FORBID_ATTR: ["style", "srcdoc", "formaction"],
    ALLOW_UNKNOWN_PROTOCOLS: false,
    SANITIZE_DOM: true
  });
}

// Every first-party sink explicitly calls trustedHTML. There is intentionally no
// default policy: a newly introduced raw sink fails closed under CSP.
const createTrustedHtmlPolicy = () => trustedTypesApi?.createPolicy?.("biddingflow-html", {
  createHTML(value) {
    if (typeof value !== "string") throw new TypeError("Trusted HTML input must be a string");
    return sanitizeHTML(value);
  },
  createScriptURL(value) {
    return assertSafeScriptURL(value);
  },
  createScript() {
    throw new TypeError("Dynamic script text is not permitted");
  }
}) || null;

export const trustedHtmlPolicy = globalThis[TRUSTED_POLICY_CACHE_KEY] || createTrustedHtmlPolicy();
if (trustedHtmlPolicy && !globalThis[TRUSTED_POLICY_CACHE_KEY]) {
  Object.defineProperty(globalThis, TRUSTED_POLICY_CACHE_KEY, {
    configurable: false,
    enumerable: false,
    value: trustedHtmlPolicy,
    writable: false
  });
}

export function trustedHTML(value) {
  const source = String(value ?? "");
  return trustedHtmlPolicy ? trustedHtmlPolicy.createHTML(source) : sanitizeHTML(source);
}

export function trustedScriptURL(value) {
  const source = assertSafeScriptURL(value);
  return trustedHtmlPolicy ? trustedHtmlPolicy.createScriptURL(source) : source;
}

if (!globalThis.__BF_TRUSTED_HTML__) {
  Object.defineProperty(globalThis, "__BF_TRUSTED_HTML__", {
    configurable: false,
    enumerable: false,
    value: trustedHTML,
    writable: false
  });
}
