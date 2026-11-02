import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

test('build dependency lock excludes minimatch versions affected by GHSA-g3hv-75wg-m249', () => {
    const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));
    const entries = Object.entries(lock.packages).filter(([path]) => path.endsWith('node_modules/minimatch'));
    assert.ok(entries.length > 0);
    for (const [path, entry] of entries) {
        const [major, minor, patch] = entry.version.split('.').map(Number);
        assert.ok(major > 11 || (major === 11 && (minor > 0 || patch >= 1)), `${path}: ${entry.version}`);
    }
});

test('obfuscator multimatch retains include and exclude glob behavior', () => {
    const obfuscatorRequire = createRequire(require.resolve('javascript-obfuscator'));
    const multimatch = obfuscatorRequire('multimatch');
    assert.deepEqual(multimatch(['src/a.js', 'src/b.js', 'src/a.css', 'vendor/c.js'], ['src/*.js', '!src/b.js']), ['src/a.js']);
    assert.deepEqual(multimatch(['a.js', 'nested/b.js', 'a.css'], ['**/*.js']), ['a.js', 'nested/b.js']);
});
