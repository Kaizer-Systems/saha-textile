import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID, inject, provideEnvironmentInitializer } from '@angular/core';

const HIDDEN_SLIDE = '.owl-item[aria-hidden="true"]';

/** Off-screen slides are `inert`, so a keyboard user never tabs into a link they cannot see. */
export function syncCarouselInert(root: ParentNode): void {
	for (const slide of Array.from(root.querySelectorAll('.owl-item'))) {
		slide.toggleAttribute('inert', slide.matches(HIDDEN_SLIDE));
	}
}

/**
 * The carousel library hides off-screen slides from screen readers with `aria-hidden` but leaves
 * their links and buttons focusable, which Lighthouse and axe fail as `aria-hidden-focus`. One
 * observer for the whole page keeps `inert` in step with `aria-hidden` on every carousel, so no
 * template has to change. Browser only: the server renders before any slide moves.
 */
export function provideCarouselInert() {
	return provideEnvironmentInitializer(() => {
		if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
		const document = inject(DOCUMENT);
		let queued = false;
		const sync = () => {
			queued = false;
			syncCarouselInert(document);
		};
		new MutationObserver(() => {
			if (queued) return;
			queued = true;
			requestAnimationFrame(sync);
		}).observe(document.documentElement, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ['aria-hidden'],
		});
	});
}
