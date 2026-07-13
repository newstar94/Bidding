import { defineConfig, loadEnv } from 'vite';
import path from 'path';
import JavaScriptObfuscator from 'javascript-obfuscator';

function obfuscatorPlugin({ debugProtection = false } = {}) {
  const obfuscate = code => JavaScriptObfuscator.obfuscate(code, {
    compact: true,
    // Keep the production source difficult to read without making every page
    // pay a large decode/evaluation cost before the app can start.
    controlFlowFlattening: false,
    deadCodeInjection: false,
    debugProtection,
    debugProtectionInterval: debugProtection ? 3000 : 0,
    disableConsoleOutput: false,
    identifierNamesGenerator: 'hexadecimal',
    log: false,
    numbersToExpressions: false,
    renameGlobals: false,
    selfDefending: true,
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
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk' || !output.fileName.endsWith('.js')) continue;
        output.code = obfuscate(output.code);
        if (output.code.includes('!~{')) {
          throw new Error(`Unresolved Rollup placeholder remained after obfuscation: ${output.fileName}`);
        }
        output.map = null;
      }
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const enableObfuscation = mode === 'secure' || env.ENABLE_JS_OBFUSCATION === 'true';
  const enableDebugProtection = env.ENABLE_JS_DEBUG_PROTECTION === 'true';
  const isProductionBuild = mode === 'production' || mode === 'secure';

  return {
    root: '.',
    base: '/dist/',
    plugins: enableObfuscation ? [obfuscatorPlugin({ debugProtection: enableDebugProtection })] : [],
    esbuild: isProductionBuild ? {
      drop: ['debugger'],
      pure: ['console.log', 'console.debug', 'console.table']
    } : {},
    build: {
      manifest: true,
      outDir: 'dist',
      emptyOutDir: true,
      cssCodeSplit: false,
      sourcemap: false,
      minify: 'esbuild',
      chunkSizeWarningLimit: enableObfuscation ? 4096 : 1024,
      rolldownOptions: {
        input: {
          app: path.resolve(__dirname, 'controllers/app.js')
        },
        output: {
          codeSplitting: false,
          entryFileNames: 'assets/appbundle.js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]'
        }
      }
    },
    resolve: {
      alias: {
        '/models': path.resolve(__dirname, 'models'),
        '/views': path.resolve(__dirname, 'views'),
        '/controllers': path.resolve(__dirname, 'controllers')
      }
    }
  };
});
