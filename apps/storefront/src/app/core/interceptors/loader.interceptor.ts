import { HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';

import { LoaderStore } from '@core/state/loader.store';

@Injectable()
export class LoaderInterceptor implements HttpInterceptor {
	private loaderStore = inject(LoaderStore);

	intercept<T>(req: HttpRequest<T>, next: HttpHandler): Observable<HttpEvent<T>> {
		void Promise.resolve(null).then(() => {
			this.loaderStore.showLoader(req.method == 'GET' ? true : false);
			this.loaderStore.showButtonSpinner(req.method != 'GET' ? true : false);
		});

		// finalize (not tap complete/error): TanStack query fns use firstValueFrom,
		// which unsubscribes on the first value — the source's `complete` can race
		// that teardown and never fire, so a tap-based hide would leak the ref-count
		// and stick the loader on. finalize runs exactly once on complete/error/
		// unsubscribe. Deferred to a microtask to keep the state change out of the
		// current change-detection pass (avoids NG0100), symmetric with show.
		return next.handle(req).pipe(
			finalize(
				() =>
					void Promise.resolve(null).then(() => {
						this.loaderStore.hideLoader();
						this.loaderStore.hideButtonSpinner();
					}),
			),
		);
	}
}
