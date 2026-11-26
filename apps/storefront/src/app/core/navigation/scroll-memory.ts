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

/** Where the shopper was: the scroll position, and the page section on screen with its distance from the top. */
interface Saved {
	position: [number, number];
	anchor: { fromEnd: number; top: number } | null;
}

/** The page's sections in order: the anchor is counted from the last one, so a row added higher up changes nothing. */
const sections = (): HTMLElement[] =>
	[...document.querySelectorAll<HTMLElement>('section')].filter(
		(section) =>
			!section.closest('header, footer, app-header, app-footer') && section.getBoundingClientRect().height > 0,
	);

/** The section that fills most of the screen, read before leaving the page. */
function anchorOnScreen(): Saved['anchor'] {
	const list = sections();
	let best: Saved['anchor'] = null;
	let most = 0;
	list.forEach((section, index) => {
		const box = section.getBoundingClientRect();
		const shown = Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0);
		if (shown > most) {
			most = shown;
			best = { fromEnd: list.length - 1 - index, top: box.top };
		}
	});
	return best;
}

/** How far to move so that section is where it was on screen. */
function anchorShift(anchor: NonNullable<Saved['anchor']>): number {
	const list = sections();
	const section = list[list.length - 1 - anchor.fromEnd];
	if (!section) return 0;
	const shift = section.getBoundingClientRect().top - anchor.top;
	return Math.abs(shift) > 1 ? shift : 0;
}

/** How long after a Back the same link is kept in place while content fills in above it. */
const KEEP_ANCHORED_MS = 1500;

/**
 * Rows the browser fills in after the page is drawn ("Recently viewed") can push the restored spot down after it was
 * restored. For a short while, every change of the page's height lines the link up again; the shopper's own scroll,
 * tap or key ends it at once, so it never fights them.
 */
function keepAnchored(anchor: NonNullable<Saved['anchor']>): void {
	if (typeof ResizeObserver === 'undefined') return;
	const stop = () => {
		observer.disconnect();
		clearTimeout(timer);
		for (const type of STOP_ON) window.removeEventListener(type, stop);
	};
	const observer = new ResizeObserver(() => {
		const shift = anchorShift(anchor);
		if (shift) window.scrollBy({ top: shift, left: 0, behavior: 'instant' });
	});
	observer.observe(document.body);
	const timer = setTimeout(stop, KEEP_ANCHORED_MS);
	for (const type of STOP_ON) window.addEventListener(type, stop, { once: true, passive: true });
}

/** The shopper's own input, which ends `keepAnchored`. */
const STOP_ON = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;

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
	private readonly positions = new Map<number, Saved>();

	constructor() {
		if (isPlatformBrowser(inject(PLATFORM_ID))) this.start();
	}

	/** Runs once, from the constructor. */
	private start(): void {
		this.scroller.setHistoryScrollRestoration('manual');
		let currentId = 0;
		// The service can start after the first page has finished loading; that load is not ours to move.
		let first = !this.router.navigated;
		let restoreFrom: number | null = null;
		this.router.events.subscribe((event) => {
			if (event instanceof NavigationStart) {
				this.positions.set(currentId, {
					position: this.scroller.getScrollPosition(),
					anchor: anchorOnScreen(),
				});
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
	private restore({ position: [left, top], anchor }: Saved): void {
		const root = document.documentElement;
		root.classList.add(RENDER_ALL);
		const until = performance.now() + RESTORE_WAIT_MS;
		const attempt = () => {
			const reachable = root.scrollHeight - window.innerHeight >= top;
			if (reachable || performance.now() > until) {
				window.scrollTo({ top, left, behavior: 'instant' });
				// Content can change while the shopper is away (Home's "Recently viewed" row appears after a product was
				// opened), so the same pixel can show other content: put the section that was on screen back in place.
				const shift = anchor ? anchorShift(anchor) : 0;
				if (shift) window.scrollBy({ top: shift, left: 0, behavior: 'instant' });
				if (anchor) keepAnchored(anchor);
				// A section's real height is remembered at the next rendering step, which runs after this frame's
				// callbacks; the class goes one frame later, so every section keeps its real height and nothing moves.
				requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove(RENDER_ALL)));
			} else setTimeout(attempt, 16);
		};
		attempt();
	}
}
