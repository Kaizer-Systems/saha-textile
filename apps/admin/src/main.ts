import 'zone.js';
import '@angular/localize/init';
import { bootstrapApplication } from '@angular/platform-browser';

import { App } from './app/app';
import { restoreThemeColor } from './app/core/brand/theme-color';
import { appConfig } from './app/app.config';

// The admin's theme colour from this browser's last visit, before anything is drawn.
restoreThemeColor(document);

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
