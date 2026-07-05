import { HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';

import { LoaderStore } from '@core/state/loader.store';

@Injectable()
export class LoaderInterceptor implements HttpInterceptor {
	private loader = inject(LoaderStore);

	intercept<T>(req: HttpRequest<T>, next: HttpHandler): Observable<HttpEvent<T>> {
		void Promise.resolve(null).then(() => {
			this.loader.showLoader(req.method === 'GET');
			this.loader.showButtonSpinner(req.method !== 'GET');
		});

		// `finalize` (not `tap({complete})`) so the loader is hidden on complete,
		// error, OR unsubscribe. TanStack Query reads responses via `firstValueFrom`,
		// which unsubscribes on the first emission before the stream completes —
		// `tap({complete})` would never fire and the loader would stick.
		return next.handle(req).pipe(
			finalize(() => {
				this.loader.hideLoader();
				this.loader.hideButtonSpinner();
			}),
		);
	}
}
