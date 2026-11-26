import 'zone.js';
import '@angular/localize/init';
import { bootstrapApplication } from '@angular/platform-browser';

import { App } from './app/app';
import { appConfig } from './app/app.config';
import { installPictureFallback } from './app/core/media/picture-fallback';

// A Media picture that fails to load becomes the placeholder of its shape (R5-5).
installPictureFallback(document);

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
