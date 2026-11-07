import { HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { ACTIVE_LOCALE } from '@core/i18n/active-locale';

import { environment } from '../../../../public/environments/environment';

/** Catalogue reads and every cart answer come in the page's language, so each call names it. */
@Injectable()
export class CatalogLocaleInterceptor implements HttpInterceptor {
	private locale = inject(ACTIVE_LOCALE);

	intercept<T>(request: HttpRequest<T>, next: HttpHandler): Observable<HttpEvent<T>> {
		const catalogRead = request.method === 'GET' && request.url.startsWith(`${environment.apiUrl}/catalog`);
		if (!catalogRead && !request.url.startsWith(`${environment.apiUrl}/cart`)) return next.handle(request);
		return next.handle(request.clone({ setParams: { locale: this.locale } }));
	}
}
