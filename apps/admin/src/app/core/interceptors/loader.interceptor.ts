import { HttpContextToken, HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';

import { LoaderStore } from '@core/state/loader.store';

/**
 * Set on a request that must never cover the page with "Loading": the Inbox's own calls, which show
 * their own progress in place, and the checks that run every minute in the background behind the
 * menu badges (Inbox redesign brief, R5). Without it, every folder change and every minute's check
 * blanked the whole page.
 */
export const NO_PAGE_COVER = new HttpContextToken<boolean>(() => false);

@Injectable()
export class LoaderInterceptor implements HttpInterceptor {
	private loader = inject(LoaderStore);

	intercept<T>(req: HttpRequest<T>, next: HttpHandler): Observable<HttpEvent<T>> {
		if (req.context.get(NO_PAGE_COVER)) return next.handle(req);
		// The loader is shown a tick later (never mid change detection). A request that ends before
		// that tick — answered at once, or cancelled when TanStack refetches — must not show it at
		// all: showing after its hide left the page under "Loading" for good (shipping pages, 19 Nov).
		let ended = false;
		let shown = false;
		void Promise.resolve(null).then(() => {
			if (ended) return;
			shown = true;
			this.loader.showLoader(req.method === 'GET');
			this.loader.showButtonSpinner(req.method !== 'GET');
		});

		// `finalize` (not `tap({complete})`) so the loader is hidden on complete,
		// error, OR unsubscribe. TanStack Query reads responses via `firstValueFrom`,
		// which unsubscribes on the first emission before the stream completes —
		// `tap({complete})` would never fire and the loader would stick.
		return next.handle(req).pipe(
			finalize(() => {
				ended = true;
				if (!shown) return;
				this.loader.hideLoader();
				this.loader.hideButtonSpinner();
			}),
		);
	}
}
