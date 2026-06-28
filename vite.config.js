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
      // Chỉ obfuscate các chunk nghiệp vụ trong assets, KHÔNG làm rối app.bundle.js (core loader)
      if (chunk.fileName.endsWith('.js') && !chunk.fileName.includes('app.bundle.js')) {
        const obfuscationResult = JavaScriptObfuscator.obfuscate(code, {
          compact: true,
          controlFlowFlattening: true, // Khôi phục làm rối luồng điều khiển cho nghiệp vụ
          controlFlowFlatteningThreshold: 0.5,
          deadCodeInjection: true,     // Khôi phục chèn code rác bảo mật
          deadCodeInjectionThreshold: 0.2,
          debugProtection: true,       // Bật chống debug
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
          stringArray: true,           // Khôi phục mã hoá chuỗi
          stringArrayCallsTransform: true,
          stringArrayEncoding: ['rc4'],
          stringArrayThreshold: 0.5,
          transformObjectKeys: false,  // Tắt transformObjectKeys để tránh lỗi ánh xạ thuộc tính API/DB
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
    chunkSizeWarningLimit: 2048, // Tăng giới hạn cảnh báo lên 2MB để bỏ cảnh báo do obfuscator làm phình dung lượng
    rollupOptions: {
      input: {
        app: path.resolve(__dirname, 'controllers/app.js')
      },
      output: {
        entryFileNames: 'controllers/app.bundle.js',
        chunkFileNames: 'assets/[name]-[hash].js',
        manualChunks(id) {
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        }
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
