/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/**
 * Emits sw.js with the exact list of built assets to precache. Source maps
 * and the legacy .woff font files (browsers load the .woff2 files) are left
 * out; everything the running app needs offline is included.
 */
function serviceWorker(): Plugin {
  return {
    name: 'typist-service-worker',
    apply: 'build',
    // After Vite's HTML plugin, so index.html is part of the bundle.
    enforce: 'post',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((f) => !f.endsWith('.map') && !/\.woff$/.test(f) && f !== 'sw.js')
        .sort();
      const precache = ['./', ...files.map((f) => `./${f}`)];
      const build = createHash('sha256').update(JSON.stringify(precache)).update(pkg.version).digest('hex').slice(0, 16);
      const template = readFileSync(new URL('./src/sw/sw.template.js', import.meta.url), 'utf8');
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template.replace('__BUILD_ID__', build).replace('__PRECACHE_MANIFEST__', JSON.stringify(precache, null, 2)),
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), serviceWorker()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
  build: {
    target: 'es2023',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
