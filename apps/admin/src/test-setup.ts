import '@angular/compiler';
import '@analogjs/vitest-angular/setup-snapshots';
import '@analogjs/vitest-angular/setup-serializers';
import { setupTestBed } from '@analogjs/vitest-angular/setup-testbed';

setupTestBed();

// The shop's languages, as `GET /storefront/languages` answers locally. `ActiveLanguages` starts
// from this browser copy, so specs build English and Bengali fields without calling the API.
beforeEach(() => {
	if (typeof localStorage !== 'undefined') localStorage.setItem('st_admin_languages', JSON.stringify(['en', 'bn']));
});
