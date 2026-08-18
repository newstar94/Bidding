import { defineConfig, loadEnv } from 'vite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'path';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { localSecureReleaseId } from './scripts/secure_release_id.mjs';

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
  sourceMap: true,
  sourceMapMode: 'separate',
  sourceMapSourcesMode: 'sources-content',
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

function writePrivateSymbolArchive({ releaseId, transformedFiles }) {
  const releaseIdSha256 = sha256(releaseId);
  const relativeArchive = `private-symbols/${releaseIdSha256}.symbols.json`;
  const archivePath = path.resolve(__dirname, 'release', relativeArchive);
  const archive = {
    formatVersion: 1,
    releaseId,
    releaseIdSha256,
    transformer: 'javascript-obfuscator@5.4.3',
    files: transformedFiles.map((transformed) => ({
      file: transformed.file,
      inputSha256: transformed.inputSha256,
      outputSha256: transformed.outputSha256,
      obfuscationMap: transformed.obfuscationMap,
      bundleMap: transformed.bundleMap
    }))
  };
  const content = `${JSON.stringify(archive)}\n`;
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  if (fs.existsSync(archivePath) && releaseId !== 'development') {
    const existing = fs.readFileSync(archivePath, 'utf8');
    if (existing !== content) {
      throw new Error(`Immutable private symbol archive collision for ${releaseId}.`);
    }
  } else {
    fs.writeFileSync(archivePath, content, { encoding: 'utf8', mode: 0o600 });
  }
  fs.chmodSync(archivePath, 0o600);
  return {
    version: 1,
    archive: relativeArchive,
    sha256: sha256(content),
    bytes: Buffer.byteLength(content),
    files: transformedFiles.length
  };
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
        if (!output.map) {
          throw new Error(`Secure build has no hidden bundle map for ${output.fileName}`);
        }
        const bundleMap = JSON.parse(output.map.toString());
        const obfuscationResult = JavaScriptObfuscator.obfuscate(
          originalCode,
          {
            ...SECURE_OBFUSCATION_OPTIONS,
            inputFileName: output.fileName,
            sourceMapFileName: `${path.basename(output.fileName)}.map`
          }
        );
        const transformedCode = obfuscationResult.getObfuscatedCode().replace(
          /\n?\/\/# sourceMappingURL=[^\r\n]*\s*$/u,
          ''
        );
        const obfuscationMap = JSON.parse(obfuscationResult.getSourceMap());
        if (transformedCode === originalCode) {
          throw new Error(`Secure obfuscation did not transform ${output.fileName}`);
        }
        if (transformedCode.includes('!~{')) {
          throw new Error(`Unresolved Rolldown placeholder remained in ${output.fileName}`);
        }
        if (transformedCode.includes('sourceMappingURL=')) {
          throw new Error(`Secure output exposes source-map metadata in ${output.fileName}`);
        }
        output.code = transformedCode;
        output.map = null;
        transformedFiles.push({
          file: output.fileName,
          inputBytes: Buffer.byteLength(originalCode),
          inputSha256: sha256(originalCode),
          obfuscationMap,
          bundleMap
        });
      }
      if (!transformedFiles.length) {
        throw new Error('Secure build produced no JavaScript chunks to obfuscate.');
      }
      for (const fileName of Object.keys(bundle)) {
        if (fileName.endsWith('.map')) delete bundle[fileName];
      }
    },
    writeBundle(outputOptions) {
      const outputDirectory = path.resolve(outputOptions.dir || 'dist');
      const archivedFiles = transformedFiles.map((transformed) => {
        const code = fs.readFileSync(path.join(outputDirectory, transformed.file), 'utf8');
        return {
          ...transformed,
          outputBytes: Buffer.byteLength(code),
          outputSha256: sha256(code)
        };
      });
      const privateSymbols = writePrivateSymbolArchive({
        releaseId,
        transformedFiles: archivedFiles
      });
      const verifiedFiles = archivedFiles.map(({
        bundleMap: _bundleMap,
        obfuscationMap: _obfuscationMap,
        ...transformed
      }) => transformed);
      fs.writeFileSync(
        path.join(outputDirectory, 'secure-build.json'),
        `${JSON.stringify({
          version: 6,
          releaseId,
          obfuscation: true,
          deadCodeInjection: true,
          deadCodeInjectionThreshold: SECURE_OBFUSCATION_OPTIONS.deadCodeInjectionThreshold,
          transformer: 'javascript-obfuscator@5.4.3',
          transformedFiles: verifiedFiles,
          privateSymbols
        })}\n`,
        'utf8'
      );
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const configuredReleaseId = env.APP_RELEASE_ID || process.env.GITHUB_SHA;
  const releaseId = String(
    configuredReleaseId || (mode === 'secure' ? localSecureReleaseId() : 'development')
  )
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
      sourcemap: mode === 'secure' ? 'hidden' : false,
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
