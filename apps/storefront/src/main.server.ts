// The vendor app is zone-based (provideZoneChangeDetection). Angular 21 defaults
// to zoneless, so platform-server/init won't load Zone for us — load zone.js/node
// FIRST so NgZone can construct during SSR (otherwise NG0908 on every render).
import 'zone.js/node';
import '@angular/platform-server/init';
import { render } from '@analogjs/router/server';

import { App } from './app/app';
import { config } from './app/app.config.server';

// The Fastkart theme has `@for … track` expressions that yield duplicate keys,
// so Angular dev mode logs NG0955/NG0956 on EVERY server render — thousands of
// lines flooding the dev terminal. They're benign vendor-template warnings
// (real fixes land with the template/state migration); drop them SSR-side so the
// terminal stays readable. Client-side (browser console) is unaffected.
const NOISY_SSR_WARNINGS = /NG0955|NG0956/;
for (const level of ['warn', 'error'] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && NOISY_SSR_WARNINGS.test(args[0])) return;
    original(...args);
  };
}

// Analog/Nitro SSR entry. `render` works with the plain Angular Router config
// (file-based routing is opt-in and lands in a later phase).
export default render(App, config);
