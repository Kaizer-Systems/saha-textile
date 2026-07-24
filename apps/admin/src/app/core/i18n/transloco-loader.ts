import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Translation, TranslocoLoader } from '@jsverse/transloco';

/**
 * Transloco translation loader for the admin SPA. Admin is client-only (no SSR),
 * so a root-relative path resolves against the served origin — mirrors the path
 * the old TranslateHttpLoader used (`assets/i18n/<lang>.json`).
 */
@Injectable({ providedIn: 'root' })
export class TranslocoHttpLoader implements TranslocoLoader {
	private http = inject(HttpClient);

	getTranslation(lang: string) {
		return this.http.get<Translation>(`/assets/i18n/${lang}.json`);
	}
}
