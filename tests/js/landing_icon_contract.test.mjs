import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
test('landing sprite covers every static icon and declares outline paint', () => {
  const html = readFileSync('views/components/landing_page.html', 'utf8');
  const sprite = readFileSync('views/assets/landing-icons.svg', 'utf8');
  const missing = [...html.matchAll(/data-lucide="([^"]+)"/g)].map(m => m[1])
    .filter(name => !sprite.includes(`id="icon-${name}"`));
  assert.deepEqual([...new Set(missing)], []);
  const renderer = readFileSync('frontend/landing/landingIcons.js', 'utf8');
  assert.match(renderer, /setAttribute\("fill", "none"\)/);
  assert.match(renderer, /setAttribute\("stroke", "currentColor"\)/);
});
