import { defineConfig } from 'vite';
import path from 'path';
import JavaScriptObfuscator from 'javascript-obfuscator';

// Custom plugin to obfuscate JavaScript code in production build
function obfuscatorPlugin() {
  return {
    name: 'vite-plugin-obfuscator',
    enforce: 'post',
    apply: 'build',
    renderChunk(code, chunk) {
      // Only obfuscate JS bundles
      if (chunk.fileName.endsWith('.js')) {
        const obfuscationResult = JavaScriptObfuscator.obfuscate(code, {
          compact: true,
          controlFlowFlattening: true,
          controlFlowFlatteningThreshold: 0.75,
          deadCodeInjection: true,
          deadCodeInjectionThreshold: 0.4,
          debugProtection: true,
          debugProtectionInterval: 4000,
          disableConsoleOutput: false,
          identifierNamesGenerator: 'hexadecimal',
          log: false,
          numbersToExpressions: true,
          renameGlobals: false,
          selfDefending: true,
          simplify: true,
          splitStrings: true,
          splitStringsChunkLength: 5,
          stringArray: true,
          stringArrayCallsTransform: true,
          stringArrayEncoding: ['rc4'],
          stringArrayThreshold: 0.75,
          transformObjectKeys: true,
          unicodeEscapeSequence: false
        });
        return {
          code: obfuscationResult.getObfuscatedCode(),
          map: obfuscationResult.getSourceMap()
        };
      }
      return null;
    }
  };
}

export default defineConfig({
  root: '.',
  plugins: [obfuscatorPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: false,
    minify: 'esbuild', // Nén code sử dụng esbuild cực nhanh và bảo mật
    rollupOptions: {
      input: {
        app: path.resolve(__dirname, 'controllers/app.js')
      },
      output: {
        entryFileNames: 'controllers/app.bundle.js',
        format: 'iife' // IIFE format wraps the bundle in an immediately-invoked function expression to protect variables
      }
    }
  },
  resolve: {
    alias: {
      // Cho phép Vite hiểu các import tuyệt đối bắt đầu bằng gạch chéo / như /models/...
      '/models': path.resolve(__dirname, 'models'),
      '/views': path.resolve(__dirname, 'views'),
      '/controllers': path.resolve(__dirname, 'controllers')
    }
  }
});
