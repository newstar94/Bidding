import { defineConfig, loadEnv } from 'vite';
import path from 'path';
import JavaScriptObfuscator from 'javascript-obfuscator';

function obfuscatorPlugin({ debugProtection = false } = {}) {
  return {
    name: 'vite-plugin-obfuscator',
    enforce: 'post',
    apply: 'build',
    renderChunk(code, chunk) {
      if (!chunk.fileName.endsWith('.js')) return null;

      const obfuscationResult = JavaScriptObfuscator.obfuscate(code, {
        compact: true,
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 0.35,
        deadCodeInjection: true,
        deadCodeInjectionThreshold: 0.08,
        debugProtection,
        debugProtectionInterval: debugProtection ? 3000 : 0,
        disableConsoleOutput: false,
        identifierNamesGenerator: 'hexadecimal',
        log: false,
        numbersToExpressions: true,
        renameGlobals: false,
        selfDefending: true,
        simplify: true,
        splitStrings: true,
        splitStringsChunkLength: 8,
        stringArray: true,
        stringArrayCallsTransform: true,
        stringArrayEncoding: ['rc4'],
        stringArrayThreshold: 0.55,
        transformObjectKeys: false,
        unicodeEscapeSequence: false
      });

      return {
        code: obfuscationResult.getObfuscatedCode(),
        map: obfuscationResult.getSourceMap()
      };
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const enableObfuscation = mode === 'secure' || env.ENABLE_JS_OBFUSCATION === 'true';
  const enableDebugProtection = env.ENABLE_JS_DEBUG_PROTECTION === 'true';

  return {
    root: '.',
    plugins: enableObfuscation ? [obfuscatorPlugin({ debugProtection: enableDebugProtection })] : [],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: false,
      minify: 'esbuild',
      chunkSizeWarningLimit: enableObfuscation ? 4096 : 1024,
      rollupOptions: {
        input: {
          app: path.resolve(__dirname, 'controllers/app.js')
        },
        output: {
          entryFileNames: 'controllers/app.bundle.js'
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
