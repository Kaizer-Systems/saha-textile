import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';

/** The width the Media styles switch to their phone layout at (Bootstrap's `sm`, as in `_file-manager.scss`). */
export const FM_PHONE_QUERY = '(max-width: 575.98px)';

/**
 * Whether the Media screens show their phone layout (the brief's G01–G04): rows instead of the wide table, upload
 * review rows as cards. Follows the screen as it turns or the window is resized. Off on the server.
 */
@Injectable({ providedIn: 'root' })
export class FmPhone {
	private readonly matches = signal(false);
	readonly is = this.matches.asReadonly();

	constructor() {
		const view = inject(DOCUMENT).defaultView;
		if (!isPlatformBrowser(inject(PLATFORM_ID)) || typeof view?.matchMedia !== 'function') return;
		const query = view.matchMedia(FM_PHONE_QUERY);
		this.matches.set(query.matches);
		query.addEventListener('change', (event) => this.matches.set(event.matches));
	}
}
