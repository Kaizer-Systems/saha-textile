/// <reference types="vitest" />

import { fileURLToPath, URL } from 'node:url';

import analog from '@analogjs/platform';
import { defineConfig } from 'vite';

const appPath = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// AnalogJS (Vite + Nitro) build for the storefront. Unlike the admin (SPA, no
// SSR), the storefront keeps SSR — the Fastkart theme ships SSR-ready and SEO /
// first-paint matter for a public shop. Phase 5a swaps the SSR host only
// (Angular-CLI + @angular/ssr Express -> Analog Vite + Nitro); the app still
// uses the Angular Router config + NGXS + ngx-translate. File-based routing and
// the state-layer migration land in later phases on top of this platform.
export default defineConfig(() => ({
  // Pin the project root to this file's dir (as the Analog template does) so
  // Vite behaves identically regardless of the launch cwd — otherwise resolution
  // (incl. the sass importer) drifts when started from the workspace root vs the
  // app dir.
  root: appPath('.'),
  server: {
    port: 4200,
    host: 'localhost',
    fs: {
      // pnpm hoists node_modules to the workspace root; allow the app dir +
      // workspace root so Vite can serve theme assets and hoisted packages.
      allow: [appPath('.'), appPath('../..')],
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        // The Fastkart theme's app.scss @imports node_modules-prefixed paths
        // (e.g. `@import 'node_modules/bootstrap/dist/css/bootstrap.min.css'`)
        // and bare package specifiers. The Angular CLI resolved these via its
        // node_modules include path; Vite's sass doesn't by default, so give it
        // the same load paths. `node_modules/...`-prefixed imports resolve
        // against a dir that CONTAINS node_modules: the app root (pnpm keeps
        // most deps under apps/storefront/node_modules) and the workspace root
        // (hoisted deps). Also add the theme's scss dir + src. Without this:
        // "canonicalize() must return a URL" / "Can't find stylesheet to import"
        // (sass blames the root @import that pulls the chain in).
        loadPaths: [
          appPath('.'),
          appPath('../..'),
          appPath('./public/assets/scss'),
          appPath('./src'),
        ],
        // The Fastkart theme + Bootstrap 5.3 lean on Sass APIs Dart Sass marks
        // deprecated; quiet the noise (no behavioural effect).
        quietDeps: true,
        // NB: 'mixed-decls' is intentionally NOT listed — it's obsolete in the
        // current Dart Sass, and naming it makes sass warn on every compiled
        // file ("mixed-decls deprecation is obsolete"), flooding the dev log.
        silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api', 'slash-div'],
      },
    },
  },
  build: {
    target: ['es2020'],
  },
  resolve: {
    mainFields: ['module'],
    // Mirror the tsconfig path aliases so Vite/Nitro resolve + bundle them
    // (otherwise the SSR build externalises '@data-access/*' etc. as if they
    // were npm scoped packages).
    alias: {
      '@layout': appPath('./src/app/layout'),
      '@shared': appPath('./src/app/shared'),
      '@features': appPath('./src/app/features'),
      '@data-access': appPath('./src/app/data-access'),
      '@core': appPath('./src/app/core'),
      // Fastkart theme scss. It lives under src/ (NOT public/): Vite's dev sass
      // importer can't resolve @imports for files in public/ (public/ is served
      // as verbatim static assets, so those files get no module URL and relative
      // @imports fail with "canonicalize() must return a URL"). Image url()s in
      // the scss were made absolute (/assets/images/...) so they still resolve
      // from public/ regardless of the scss location.
      '@styles': appPath('./src/scss'),
    },
  },
  // Full Analog platform: Vite + Nitro SSR (ssr defaults on). Nitro emits a
  // node-server for production (`node dist/analog/server/index.mjs`).
  plugins: [
    analog({
      ssr: true,
      static: false,
      // No prerendering: the shop is fully dynamic — every route self-fetches
      // i18n + mock data over HTTP, which has no server to hit at build time.
      // Pages render on-demand via the live Nitro SSR server instead.
      prerender: {
        routes: [],
      },
      nitro: {
        preset: 'node-server',
        // Bundle tslib into the server output instead of externalising it. Its
        // package `exports` uses a deprecated trailing-slash mapping, so Nitro's
        // node-server can't resolve the emitted `tslib/modules/index.js` at
        // runtime (ERR_MODULE_NOT_FOUND on every SSR request). Inlining it fixes
        // the built server without affecting the client bundle.
        externals: {
          inline: ['tslib'],
        },
        prerender: {
          crawlLinks: false,
          routes: [],
        },
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    include: ['**/*.spec.ts'],
    reporters: ['default'],
  },
}));
