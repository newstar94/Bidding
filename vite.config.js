import { defineConfig, loadEnv } from 'vite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'path';
import JavaScriptObfuscator from 'javascript-obfuscator';

function privateSourceMapPlugin({ directory, releaseId }) {
  const outputDirectory = path.resolve(process.cwd(), 'dist');
  const privateRoot = path.resolve(process.cwd(), directory);
  const safeReleaseId = releaseId.replace(/[^a-zA-Z0-9._-]/g, '_');
  const releaseDirectory = path.join(privateRoot, safeReleaseId);
  const relativeToOutput = path.relative(outputDirectory, releaseDirectory);
  if (!relativeToOutput || (!relativeToOutput.startsWith('..') && !path.isAbsolute(relativeToOutput))) {
    throw new Error('PRIVATE_SOURCE_MAP_DIR must be outside the public dist directory.');
  }

  return {
    name: 'biddingflow-private-source-maps',
    apply: 'build',
    closeBundle() {
      const maps = fs.readdirSync(outputDirectory, { recursive: true })
        .map(name => String(name))
        .filter(name => name.endsWith('.map'))
        .sort();
      if (!maps.length) throw new Error('Private source maps were requested but none were generated.');
      fs.mkdirSync(releaseDirectory, { recursive: true });
      const manifest = [];
      for (const relativeName of maps) {
        const source = path.join(outputDirectory, relativeName);
        const destination = path.join(releaseDirectory, relativeName);
        const content = fs.readFileSync(source);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, content);
        fs.unlinkSync(source);
        manifest.push({
          map: relativeName.replaceAll('\\', '/'),
          publicAsset: `/dist/${relativeName.replace(/\.map$/, '').replaceAll('\\', '/')}`,
          sha256: crypto.createHash('sha256').update(content).digest('hex'),
          size: content.length
        });
      }
      fs.writeFileSync(
        path.join(releaseDirectory, 'source-map-manifest.json'),
        `${JSON.stringify({ formatVersion: 1, releaseId, files: manifest }, null, 2)}\n`,
        'utf8'
      );
      fs.writeFileSync(
        path.join(outputDirectory, 'secure-build.json'),
        `${JSON.stringify({
          version: 3,
          releaseId,
          debugProtection: false,
          deadCodeInjection: false,
          identifierNamesGenerator: 'minified-private-source-maps',
          privateSourceMaps: true
        })}\n`,
        'utf8'
      );
    }
  };
}

function obfuscatorPlugin({ debugProtection = false, deadCodeInjection = false, releaseId = 'development' } = {}) {
  const obfuscationFingerprint = JSON.stringify({
    version: 3,
    releaseId,
    debugProtection,
    deadCodeInjection,
    deadCodeInjectionThreshold: deadCodeInjection ? 0.02 : 0,
    identifierNamesGenerator: 'mangled-shuffled',
    seed: 794012026
  });
  const obfuscate = code => JavaScriptObfuscator.obfuscate(code, {
    compact: true,
    // Keep the production source difficult to read without making every page
    // pay a large decode/evaluation cost before the app can start.
    controlFlowFlattening: false,
    deadCodeInjection,
    deadCodeInjectionThreshold: deadCodeInjection ? 0.02 : 0,
    debugProtection,
    debugProtectionInterval: debugProtection ? 3000 : 0,
    disableConsoleOutput: false,
    identifierNamesGenerator: 'mangled-shuffled',
    log: false,
    numbersToExpressions: false,
    renameGlobals: false,
    seed: 794012026,
    selfDefending: false,
    simplify: true,
    sourceMap: false,
    splitStrings: false,
    stringArray: false,
    stringArrayCallsTransform: false,
    stringArrayEncoding: [],
    stringArrayThreshold: 0.35,
    transformObjectKeys: false,
    unicodeEscapeSequence: false
  }).getObfuscatedCode();

  return {
    name: 'vite-plugin-obfuscator',
    enforce: 'post',
    apply: 'build',
    augmentChunkHash() {
      return obfuscationFingerprint;
    },
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk' || !output.fileName.endsWith('.js')) continue;
        output.code = obfuscate(output.code);
        if (output.code.includes('!~{')) {
          throw new Error(`Unresolved Rollup placeholder remained after obfuscation: ${output.fileName}`);
        }
        output.map = null;
      }
      this.emitFile({
        type: 'asset',
        fileName: 'secure-build.json',
        source: `${obfuscationFingerprint}\n`
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const releaseId = String(env.APP_RELEASE_ID || process.env.GITHUB_SHA || 'development')
    .trim()
    .slice(0, 128) || 'development';
  const privateSourceMapDirectory = String(env.PRIVATE_SOURCE_MAP_DIR || '').trim();
  const enablePrivateSourceMaps = Boolean(privateSourceMapDirectory);
  // javascript-obfuscator cannot compose its generated map with Rollup's original
  // source map. A diagnosable release is minified but deliberately not obfuscated.
  const enableObfuscation = !enablePrivateSourceMaps
    && (mode === 'secure' || env.ENABLE_JS_OBFUSCATION === 'true');
  const enableDebugProtection = env.ENABLE_JS_DEBUG_PROTECTION === 'true';
  // Dead-code injection increases transfer/parse cost and is not a security
  // boundary. Keep it opt-in for special distributions, never the default.
  const enableDeadCodeInjection = enableObfuscation && env.ENABLE_JS_DEAD_CODE_INJECTION === 'true';
  const isProductionBuild = mode === 'production' || mode === 'secure';

  return {
    root: '.',
    base: '/dist/',
    plugins: [
      ...(enableObfuscation ? [obfuscatorPlugin({
        debugProtection: enableDebugProtection,
        deadCodeInjection: enableDeadCodeInjection,
        releaseId
      })] : []),
      ...(enablePrivateSourceMaps ? [privateSourceMapPlugin({
        directory: privateSourceMapDirectory,
        releaseId
      })] : [])
    ],
    define: {
      __BIDDINGFLOW_RELEASE_ID__: JSON.stringify(releaseId)
    },
    esbuild: isProductionBuild ? {
      drop: ['debugger'],
      pure: ['console.log', 'console.debug', 'console.table']
    } : {},
    build: {
      manifest: true,
      outDir: 'dist',
      emptyOutDir: true,
      cssCodeSplit: true,
      sourcemap: enablePrivateSourceMaps ? 'hidden' : false,
      minify: 'esbuild',
      chunkSizeWarningLimit: 700,
      rolldownOptions: {
        input: {
          app: path.resolve(__dirname, 'frontend/app/app.js')
        },
        output: {
          codeSplitting: true,
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]'
        }
      }
    },
    resolve: {
      alias: {
        '/frontend': path.resolve(__dirname, 'frontend'),
        '/views': path.resolve(__dirname, 'views')
      }
    }
  };
});
