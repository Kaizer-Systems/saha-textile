import { isPlatformBrowser, ViewportScroller } from '@angular/common';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';

/**
 * Runs `work` once the new page has rendered: after the next frame or a zero-delay timer, whichever
 * comes first, like the router's own scrolling (a tab in the background gets no frames).
 */
function afterRender(work: () => void): void {
	let done = false;
	const run = () => {
		if (done) return;
		done = true;
		work();
	};
	setTimeout(run);
	requestAnimationFrame(run);
}

/** How long a restored position waits for the page to grow tall enough (lists load after the route). */
const RESTORE_WAIT_MS = 2000;

/** Draws every section that is otherwise drawn only near the screen (see `restore`). */
const RENDER_ALL = 'st-render-all';

/**
 * Where the page sits after a navigation. A new page opens at its top; Back and Forward return to
 * where the shopper was on that page; a `#fragment` scrolls to its element.
 *
 * Angular's own router scrolling waits until the app is "stable" after hydration, and this shop
 * keeps timers running (query cache clean-up, countdowns), so that moment may never come and new
 * pages kept the previous page's scroll position. This does the same job without waiting for it.
 */
@Injectable({ providedIn: 'root' })
export class ScrollMemory {
	private readonly router = inject(Router);
	private readonly scroller = inject(ViewportScroller);
	private readonly positions = new Map<number, [number, number]>();
	private started = false;

	constructor() {
		if (isPlatformBrowser(inject(PLATFORM_ID))) this.start();
	}

	private start(): void {
		if (this.started) return;
		this.started = true;
		this.scroller.setHistoryScrollRestoration('manual');
		let currentId = 0;
		// The service can start after the first page has finished loading; that load is not ours to move.
		let first = !this.router.navigated;
		let restoreFrom: number | null = null;
		this.router.events.subscribe((event) => {
			if (event instanceof NavigationStart) {
				this.positions.set(currentId, this.scroller.getScrollPosition());
				restoreFrom =
					event.navigationTrigger === 'popstate' ? (event.restoredState?.navigationId ?? null) : null;
			} else if (event instanceof NavigationEnd) {
				currentId = event.id;
				// The first page keeps whatever the browser did on load.
				if (first) {
					first = false;
					return;
				}
				const saved = restoreFrom === null ? undefined : this.positions.get(restoreFrom);
				const fragment = this.router.parseUrl(event.urlAfterRedirects).fragment;
				afterRender(() => {
					if (saved) this.restore(saved);
					else if (fragment) this.scroller.scrollToAnchor(fragment);
					else window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
				});
			}
		});
	}

	/**
	 * Waits briefly for content that loads after the route, then goes back to the saved spot. Sections far down a page
	 * are drawn only near the screen (`content-visibility`, scss/components/_render-near-screen.scss), so until then
	 * they have a guessed height; `st-render-all` draws them all while the position is restored, so the saved spot
	 * lands on the same content. Each keeps its real height afterwards, so removing the class moves nothing.
	 */
	private restore([left, top]: [number, number]): void {
		const root = document.documentElement;
		root.classList.add(RENDER_ALL);
		const until = performance.now() + RESTORE_WAIT_MS;
		const attempt = () => {
			const reachable = root.scrollHeight - window.innerHeight >= top;
			if (reachable || performance.now() > until) {
				window.scrollTo({ top, left, behavior: 'instant' });
				// A section's real height is remembered at the next rendering step, which runs after this frame's
				// callbacks; the class goes one frame later, so every section keeps its real height and nothing moves.
				requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove(RENDER_ALL)));
			} else setTimeout(attempt, 16);
		};
		attempt();
	}
}
