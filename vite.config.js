import { defineConfig, loadEnv } from 'vite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
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

const SECURE_OBFUSCATION_OPTIONS = Object.freeze({
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.02,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  numbersToExpressions: false,
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  sourceMap: false,
  splitStrings: false,
  stringArray: true,
  stringArrayCallsTransform: false,
  stringArrayEncoding: [],
  stringArrayThreshold: 0.35,
  target: 'browser-no-eval',
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
  seed: 794012026
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function secureObfuscatorPlugin(releaseId = 'development') {
  const fingerprint = JSON.stringify({ releaseId, ...SECURE_OBFUSCATION_OPTIONS });
  let transformedFiles = [];
  return {
    name: 'biddingflow-secure-obfuscator',
    enforce: 'post',
    apply: 'build',
    augmentChunkHash() {
      return fingerprint;
    },
    generateBundle(_options, bundle) {
      transformedFiles = [];
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk' || !output.fileName.endsWith('.js')) continue;
        const originalCode = output.code;
        const transformedCode = JavaScriptObfuscator.obfuscate(
          originalCode,
          SECURE_OBFUSCATION_OPTIONS
        ).getObfuscatedCode();
        if (transformedCode === originalCode) {
          throw new Error(`Secure obfuscation did not transform ${output.fileName}`);
        }
        if (transformedCode.includes('!~{')) {
          throw new Error(`Unresolved Rolldown placeholder remained in ${output.fileName}`);
        }
        output.code = transformedCode;
        output.map = null;
        transformedFiles.push({
          file: output.fileName,
          inputBytes: Buffer.byteLength(originalCode),
          inputSha256: sha256(originalCode)
        });
      }
      if (!transformedFiles.length) {
        throw new Error('Secure build produced no JavaScript chunks to obfuscate.');
      }
    },
    writeBundle(outputOptions) {
      const outputDirectory = path.resolve(outputOptions.dir || 'dist');
      const verifiedFiles = transformedFiles.map((transformed) => {
        const code = fs.readFileSync(path.join(outputDirectory, transformed.file), 'utf8');
        return {
          ...transformed,
          outputBytes: Buffer.byteLength(code),
          outputSha256: sha256(code)
        };
      });
      fs.writeFileSync(
        path.join(outputDirectory, 'secure-build.json'),
        `${JSON.stringify({
          version: 5,
          releaseId,
          obfuscation: true,
          deadCodeInjection: true,
          deadCodeInjectionThreshold: SECURE_OBFUSCATION_OPTIONS.deadCodeInjectionThreshold,
          transformer: 'javascript-obfuscator@5.4.3',
          transformedFiles: verifiedFiles
        })}\n`,
        'utf8'
      );
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
      ...(mode === 'secure' ? [secureObfuscatorPlugin(releaseId)] : [])
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
      // Route/module loaders are now the reviewed split points. Native ESM
      // imports preserve CSP/Trusted Types without injecting script elements.
      chunkSizeWarningLimit: 1800,
      rolldownOptions: {
        // Obfuscation is intentionally CPU-heavy in secure builds; keep all
        // correctness checks while suppressing only the expected timing notice.
        checks: {
          pluginTimings: false
        },
        input: {
          app: appEntry
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
        '/views': path.resolve(__dirname, 'views'),
        '/vendor': path.resolve(__dirname, 'views/vendor')
      }
    }
  };
});
