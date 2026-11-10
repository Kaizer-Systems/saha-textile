import { Injectable, inject } from '@angular/core';

import { ScrollMemory } from '@core/navigation/scroll-memory';

/**
 * Kept on the pages that used it: it makes sure `ScrollMemory` is running, which opens new pages at
 * the top and restores the position on Back. It used to subscribe to scroll events on every
 * activation and scroll to the top even on Back.
 */
@Injectable({
	providedIn: 'root',
})
export class ScrollPositionGuard {
	private readonly scrollMemory = inject(ScrollMemory);

	canActivate(): boolean {
		return true;
	}
}
