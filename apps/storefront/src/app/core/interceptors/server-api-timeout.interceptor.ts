import { HttpErrorResponse, HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Injectable } from '@angular/core';

import { Observable, TimeoutError, catchError, throwError, timeout } from 'rxjs';

import { environment } from '../../../../public/environments/environment';

/** How long a server render waits for one API call before it renders the shell instead. */
export const SSR_API_TIMEOUT_MS = 2500;

/**
 * Server renders only. A slow API must not stall every page: past the limit the call
 * fails as a 504, the query stays empty, and the browser fetches it after hydration.
 */
@Injectable()
export class ServerApiTimeoutInterceptor implements HttpInterceptor {
	intercept<T>(request: HttpRequest<T>, next: HttpHandler): Observable<HttpEvent<T>> {
		if (!request.url.startsWith(environment.apiUrl)) return next.handle(request);
		return next.handle(request).pipe(
			timeout(SSR_API_TIMEOUT_MS),
			catchError((error: unknown) =>
				throwError(() =>
					error instanceof TimeoutError
						? new HttpErrorResponse({ status: 504, statusText: 'Gateway Timeout', url: request.url })
						: error,
				),
			),
		);
	}
}
