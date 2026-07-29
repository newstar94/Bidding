import { defineConfig, loadEnv } from 'vite';
import path from 'path';
import JavaScriptObfuscator from 'javascript-obfuscator';

const appEntry = path.resolve(__dirname, 'frontend/app/app.js');
const stylesEntry = '/views/css/app.css';

function singleBundleStylesPlugin() {
  return {
    name: 'biddingflow-single-bundle-styles',
    enforce: 'pre',
    apply: 'build',
    transform(code, id) {
      const cleanId = id.split('?', 1)[0];
      if (path.resolve(cleanId) !== appEntry) return null;
      return {
        code: `import ${JSON.stringify(stylesEntry)};\n${code}`,
        map: null
      };
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
  const enableObfuscation = mode === 'secure' || env.ENABLE_JS_OBFUSCATION === 'true';
  const enableDebugProtection = env.ENABLE_JS_DEBUG_PROTECTION === 'true';
  // Dead-code injection increases transfer/parse cost and is not a security
  // boundary. Keep it opt-in for special distributions, never the default.
  const enableDeadCodeInjection = enableObfuscation && env.ENABLE_JS_DEAD_CODE_INJECTION === 'true';
  const isProductionBuild = mode === 'production' || mode === 'secure';

  return {
    root: '.',
    base: '/dist/',
    plugins: [
      singleBundleStylesPlugin(),
      ...(enableObfuscation ? [obfuscatorPlugin({
        debugProtection: enableDebugProtection,
        deadCodeInjection: enableDeadCodeInjection,
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
      // Vite's runtime helper assigns raw strings to modulepreload hrefs.
      // Under require-trusted-types-for 'script', Chromium blocks those sinks.
      // Native ESM already loads each dynamic chunk and its dependencies.
      modulePreload: false,
      outDir: 'dist',
      emptyOutDir: true,
      cssCodeSplit: true,
      sourcemap: false,
      minify: 'esbuild',
      // The production artifact is intentionally one JavaScript bundle so the
      // complete module graph is obfuscated as a unit.
      chunkSizeWarningLimit: 5000,
      rolldownOptions: {
        input: {
          app: appEntry
        },
        output: {
          codeSplitting: false,
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
