import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

// The platform console imports the complete Tabler stylesheet (~524 KB) but
// uses a small part of it. Drop rules whose class selectors never occur in the
// console sources. Matching is deliberately generous: every identifier-like
// token in the sources counts, and a token ending in "-" (e.g. `"btn-" +
// variant`) keeps every class with that prefix. Element, attribute, :root and
// @keyframes/@font-face rules are always kept.

const SOURCE_ROOTS = ['frontend/admin-platform', 'frontend/shared', 'views/admin'];
const SOURCE_EXTENSIONS = /\.(?:js|mjs|html|css)$/;

function walk(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (SOURCE_EXTENSIONS.test(entry.name)) files.push(full);
  }
  return files;
}

export function collectConsoleTokens(projectRoot) {
  const tokens = new Set();
  const prefixes = new Set();
  for (const root of SOURCE_ROOTS) {
    for (const file of walk(path.join(projectRoot, root))) {
      for (const token of fs.readFileSync(file, 'utf8').split(/[^A-Za-z0-9_-]+/)) {
        if (!token) continue;
        tokens.add(token);
        if (token.endsWith('-')) prefixes.add(token);
      }
    }
  }
  return { tokens, prefixes: [...prefixes] };
}

export function purgeTablerCss(css, { tokens, prefixes }) {
  const keepClass = (name) => tokens.has(name) || prefixes.some((prefix) => name.startsWith(prefix));
  const root = postcss.parse(css);
  root.walkRules((rule) => {
    if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
    const selectors = rule.selectors.filter((selector) => (
      // Classes inside functional selectors are not all required: :not()
      // excludes them and :is()/:where() can select alternative branches.
      // Keep these selectors conservatively instead of treating a regex as a
      // selector parser (notably Tabler's .offcanvas.show:not(.hiding)).
      /:(?:not|is|where|has)\(/i.test(selector)
      || [...selector.matchAll(/\.([A-Za-z0-9_-]+)/g)].every((match) => keepClass(match[1]))
    ));
    if (selectors.length === 0) rule.remove();
    else rule.selectors = selectors;
  });
  root.walkAtRules((atRule) => {
    if (Array.isArray(atRule.nodes) && atRule.nodes.length === 0) atRule.remove();
  });
  return root.toString();
}

export function createTablerPurgePlugin(projectRoot) {
  return {
    name: 'biddingflow-purge-tabler',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      const cleanId = id.split('?', 1)[0].replaceAll('\\', '/');
      if (!cleanId.endsWith('@tabler/core/dist/css/tabler.min.css')) return null;
      return { code: purgeTablerCss(code, collectConsoleTokens(projectRoot)), map: null };
    },
  };
}
