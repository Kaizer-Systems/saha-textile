import { isPlatformBrowser } from '@angular/common';
import { DestroyRef, DOCUMENT, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';

/** Whether the browser has a connection. The server always answers yes. */
@Injectable({ providedIn: 'root' })
export class OnlineStatus {
	readonly online = signal(true);

	constructor() {
		const view = inject<Document>(DOCUMENT).defaultView;
		if (!isPlatformBrowser(inject(PLATFORM_ID)) || !view) return;
		this.online.set(view.navigator.onLine);
		const update = () => this.online.set(view.navigator.onLine);
		view.addEventListener('online', update);
		view.addEventListener('offline', update);
		inject(DestroyRef).onDestroy(() => {
			view.removeEventListener('online', update);
			view.removeEventListener('offline', update);
		});
	}
}
