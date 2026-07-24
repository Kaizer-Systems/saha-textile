import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Translation, TranslocoLoader } from '@jsverse/transloco';

import { environment } from '../../../../public/environments/environment';

/**
 * Transloco translation loader. Uses the absolute `environment.baseURL` (not a
 * relative path) so it resolves under Nitro SSR — a relative URL resolves against
 * http://localhost:80 on the server (ECONNREFUSED). Mirrors the absolute
 * environment.URL the data services use; prod picks up the real host from baseURL.
 */
@Injectable({ providedIn: 'root' })
export class TranslocoHttpLoader implements TranslocoLoader {
	private http = inject(HttpClient);

	getTranslation(lang: string) {
		return this.http.get<Translation>(`${environment.baseURL}assets/i18n/${lang}.json`);
	}
}
