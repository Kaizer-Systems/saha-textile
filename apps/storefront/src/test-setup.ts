import '@angular/compiler';
import '@analogjs/vitest-angular/setup-snapshots';
import '@analogjs/vitest-angular/setup-serializers';
import { setupTestBed } from '@analogjs/vitest-angular/setup-testbed';

import { setSupportedLocales } from './app/core/i18n/locale';

setupTestBed();

// The shop's languages, as `GET /storefront/languages` answers locally. Specs that test the
// moment before the API has answered call `resetSupportedLocales()` themselves.
beforeEach(() => setSupportedLocales(['en', 'bn']));
