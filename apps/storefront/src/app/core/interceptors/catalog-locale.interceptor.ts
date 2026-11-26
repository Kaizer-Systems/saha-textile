import { HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { ACTIVE_LOCALE } from '@core/i18n/active-locale';

import { environment } from '../../../../public/environments/environment';

/**
 * Catalogue reads and every cart answer come in the page's language, so each call names it. A new
 * account and an order also record the page language (BN-13), so those calls name it too, and so
 * does a search-result click, which is counted against the words in that language.
 */
@Injectable()
export class CatalogLocaleInterceptor implements HttpInterceptor {
	private locale = inject(ACTIVE_LOCALE);

	intercept<T>(request: HttpRequest<T>, next: HttpHandler): Observable<HttpEvent<T>> {
		const api = environment.apiUrl;
		const catalogRead = request.method === 'GET' && request.url.startsWith(`${api}/catalog`);
		const records =
			request.url === `${api}/auth/storefront/signup/finalise` ||
			(request.method === 'POST' && request.url === `${api}/orders`) ||
			(request.method === 'POST' && request.url === `${api}/catalog/search/clicks`);
		if (!catalogRead && !records && !request.url.startsWith(`${api}/cart`)) return next.handle(request);
		return next.handle(request.clone({ setParams: { locale: this.locale } }));
	}
}
