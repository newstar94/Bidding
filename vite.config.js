import { defineConfig, loadEnv } from 'vite';
import path from 'path';

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

function secureBuildMarkerPlugin(releaseId = 'development') {
  return {
    name: 'biddingflow-secure-build-marker',
    enforce: 'post',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'secure-build.json',
        source: `${JSON.stringify({
          version: 4,
          releaseId,
          obfuscation: false,
          deadCodeInjection: false
        })}\n`
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const releaseId = String(env.APP_RELEASE_ID || process.env.GITHUB_SHA || 'development')
    .trim()
    .slice(0, 128) || 'development';
  const isProductionBuild = mode === 'production' || mode === 'secure';

  return {
    root: '.',
    base: '/dist/',
    plugins: [
      singleBundleStylesPlugin(),
      secureBuildMarkerPlugin(releaseId)
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
      // Keep one entry until route-level chunking is introduced with matching
      // Trusted Types and startup-budget coverage.
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
