import { defineConfig, loadEnv } from 'vite';
import path from 'path';
import JavaScriptObfuscator from 'javascript-obfuscator';

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
    plugins: enableObfuscation ? [obfuscatorPlugin({
      debugProtection: enableDebugProtection,
      deadCodeInjection: enableDeadCodeInjection,
      releaseId
    })] : [],
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
      chunkSizeWarningLimit: 700,
      rolldownOptions: {
        input: {
          app: path.resolve(__dirname, 'frontend/app/app.js'),
          styles: path.resolve(__dirname, 'views/css/app.css')
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
