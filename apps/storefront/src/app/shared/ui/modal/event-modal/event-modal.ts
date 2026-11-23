import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
	Component,
	DestroyRef,
	PLATFORM_ID,
	TemplateRef,
	afterNextRender,
	effect,
	inject,
	signal,
	viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbCarousel, NgbModal, NgbSlide } from '@ng-bootstrap/ng-bootstrap';
import { formatIst } from '@saha-textile/core-domain/ist-time';

import { ThemeModeStore } from '@core/brand/theme-mode';
import { ConsentStore } from '@core/consent/consent.store';
import {
	EVENTS_COOKIE,
	answerUntil,
	choosePopupEvent,
	countdownKey,
	momentKey,
	readEventsCookie,
	writeEventsCookie,
} from '@core/events/event-popup-rules';
import { ShopEvents } from '@core/events/shop-events';
import { injectBrandQuery } from '@data-access/queries/brand.queries';

import { Button } from '../../button/button';

import type { ShopEvent } from '@core/events/shop-event.interface';

/** At most one popup per visit; the newsletter popup reads this flag too and waits. */
const SESSION_FLAG = 'st_events_shown';
const NEWSLETTER_SESSION_FLAG = 'st_newsletter_shown';
const SESSION_START = 'st_session_start';
const DWELL_MS = 30_000;
const SCROLL_DEPTH = 0.5;
/** Never interrupt someone mid-purchase, signing in, or managing their account. */
const QUIET_PATHS = ['/cart', '/checkout', '/account', '/auth'];
/** The admin's Preview link opens the popup at once with this search parameter. */
const PREVIEW_PARAM = 'event_preview';

interface PopupImage {
	src: string;
	srcset: string | null;
	width: number | null;
	height: number | null;
	alt: string;
}

/** Several pictures slide at the Contact Us store photos' pace (owner, 2026-11-10). */
const SLIDE_INTERVAL_MS = 4000;

/** The popup's own timer labels: unlike the top bar line, no title stands before them. */
const POPUP_LABELS: Readonly<Record<string, string>> = {
	event_sale_ends_in: 'event_popup_sale_ends_in',
	event_sale_starts_in: 'event_popup_sale_starts_in',
	event_launches_in: 'event_popup_launches_in',
};

/** Sizes the popup picture may come in, best first; any library image can be the popup's. */
const IMAGE_ROLES = ['banner', 'blog', 'gallery', 'card'];

/**
 * The event popup (owner brief, approved 2026-11-09): the event's image, its message, the fixed
 * IST moment and a live countdown from the server's clock.
 *
 * It opens on the newsletter popup's engagement moments — half the page scrolled, 30 seconds on
 * the site, or the pointer heading for the browser bar — never on arrival and never on cart,
 * checkout, account or sign-in pages. It goes before the newsletter popup, which then waits for
 * a later visit. ✕ rests that event's popup for 3 days; "Don't show this again" stops it until
 * the popup would end anyway. Both answers live in the Functional `st_events` cookie.
 */
@Component({
	selector: 'app-event-modal',
	templateUrl: './event-modal.html',
	imports: [Button, RouterLink, TranslocoModule, NgbCarousel, NgbSlide],
})
export class EventModal {
	private readonly modalService = inject(NgbModal);
	private readonly platformId = inject(PLATFORM_ID);
	private readonly document = inject(DOCUMENT);
	private readonly router = inject(Router);
	private readonly transloco = inject(TranslocoService);
	private readonly destroyRef = inject(DestroyRef);
	private readonly consent = inject(ConsentStore);
	private readonly events = inject(ShopEvents);
	readonly brand = injectBrandQuery();
	/** The Brand Kit's dark logo in dark mode, where set. */
	readonly themeMode = inject(ThemeModeStore);

	readonly template = viewChild.required<TemplateRef<unknown>>('eventModal');
	readonly shown = signal<ShopEvent | null>(null);
	/** The pictures in slide order; several slide, one stands, none gives the text-only popup. */
	readonly images = signal<PopupImage[]>([]);
	/** The pictures stand still on the server and for visitors who ask for reduced motion. */
	readonly interval =
		isPlatformBrowser(this.platformId) &&
		!this.document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches
			? SLIDE_INTERVAL_MS
			: 0;
	readonly neverAgain = signal(false);

	private disarm: (() => void) | null = null;
	private armed = false;
	/** Opened from the admin's Preview: nothing is remembered, and the normal popup stays away. */
	private previewing = false;
	/** Opened by a tap on the phone strip: only a "Don't show this again" tick is remembered. */
	private tapped = false;

	constructor() {
		// After the first render, so the popup's template exists whenever the answer comes back.
		afterNextRender(() => this.startPreview());
		// Arms once a published event could show; the newsletter popup stands aside meanwhile.
		effect(() => {
			const candidate = this.candidate();
			if (this.previewing) return;
			this.events.popupWaiting.set(!!candidate && !this.shownThisVisit());
			if (candidate && !this.armed && isPlatformBrowser(this.platformId) && !this.shownThisVisit()) this.arm();
		});
		// A tap on the phone strip opens that event's popup at once, whatever was answered before.
		effect(() => {
			const event = this.events.asked();
			if (!event) return;
			this.events.asked.set(null);
			if (this.modalService.hasOpenModals()) return;
			this.tapped = true;
			this.show(event);
		});
		this.destroyRef.onDestroy(() => this.disarm?.());
	}

	/**
	 * Preview popup (owner brief): the admin's link carries a 30-minute token. The popup opens
	 * at once, whatever the engagement rules, and closing it stores no cookie or visit flag.
	 */
	private startPreview(): void {
		const token = new URLSearchParams(this.document.defaultView?.location.search ?? '').get(PREVIEW_PARAM);
		if (!token) return;
		this.previewing = true;
		this.disarm?.();
		this.events.popupWaiting.set(true);
		this.events.preview(token, (event) => {
			if (event) this.show(event);
		});
	}

	private candidate(): ShopEvent | null {
		if (!isPlatformBrowser(this.platformId)) return null;
		return choosePopupEvent(this.events.items(), this.events.serverTime(), this.answered());
	}

	private answered(): Map<string, number> {
		const raw = this.document.cookie
			.split('; ')
			.find((entry) => entry.startsWith(`${EVENTS_COOKIE}=`))
			?.slice(EVENTS_COOKIE.length + 1);
		return readEventsCookie(raw ? decodeURIComponent(raw) : null);
	}

	private shownThisVisit(): boolean {
		return !!this.document.defaultView?.sessionStorage.getItem(SESSION_FLAG);
	}

	label(event: ShopEvent): string {
		const key = countdownKey(event);
		return POPUP_LABELS[key] ?? key;
	}

	left(event: ShopEvent) {
		return event.countdownTo ? this.events.left(event.countdownTo) : null;
	}

	/** "Ends 27 Sep 2027, 11:59 PM IST": fixed text, the same for every shopper in the world. */
	momentText(event: ShopEvent): string {
		const { key, at } = momentKey(event);
		return this.transloco.translate(key, { at: formatIst(at, this.transloco.getActiveLang()) });
	}

	buttonKey(event: ShopEvent): string {
		if (event.phase === 'upcoming') return 'event_have_a_look';
		return event.type === 'sale' ? 'event_shop_the_sale' : 'event_shop_the_collection';
	}

	private arm(): void {
		const win = this.document.defaultView;
		if (!win) return;
		this.armed = true;
		const sessionStart = Number(win.sessionStorage.getItem(SESSION_START) ?? Date.now());
		win.sessionStorage.setItem(SESSION_START, String(sessionStart));
		const fire = () => void this.open();
		const onScroll = () => {
			const scrollable = this.document.documentElement.scrollHeight - win.innerHeight;
			if (scrollable > 0 && win.scrollY / scrollable >= SCROLL_DEPTH) fire();
		};
		const onLeave = (event: MouseEvent) => {
			if (!event.relatedTarget && event.clientY <= 0) fire();
		};
		const timer = win.setTimeout(fire, Math.max(0, DWELL_MS - (Date.now() - sessionStart)));
		win.addEventListener('scroll', onScroll, { passive: true });
		const fineHover = win.matchMedia('(hover: hover) and (pointer: fine)').matches;
		if (fineHover) this.document.addEventListener('mouseout', onLeave);
		this.disarm = () => {
			win.clearTimeout(timer);
			win.removeEventListener('scroll', onScroll);
			this.document.removeEventListener('mouseout', onLeave);
			this.disarm = null;
		};
	}

	private open(): void {
		const event = this.candidate();
		if (!event || this.shownThisVisit() || this.quietPage() || !this.consent.decided()) return;
		this.disarm?.();
		const session = this.document.defaultView?.sessionStorage;
		session?.setItem(SESSION_FLAG, '1');
		session?.setItem(NEWSLETTER_SESSION_FLAG, '1');
		this.events.popupWaiting.set(false);
		this.show(event);
	}

	private show(event: ShopEvent): void {
		this.shown.set(event);
		const images = this.pickImages(event);
		this.images.set(images);
		this.neverAgain.set(false);
		this.modalService
			.open(this.template(), {
				ariaLabelledBy: 'event-modal-title',
				centered: true,
				// With pictures the theme's 800px split; without, its 400px text half alone.
				windowClass: `theme-modal newsletter-modal ${images.length ? 'modal-lg' : 'event-popup-text-only'}`,
			})
			.result.catch(() => undefined)
			.finally(() => {
				const tapped = this.tapped;
				this.tapped = false;
				if (this.previewing || (tapped && !this.neverAgain())) return;
				this.remember(event);
			});
	}

	private pickImages(event: ShopEvent): PopupImage[] {
		return event.popupImages.flatMap((art) => {
			const sources = IMAGE_ROLES.map((role) => art.roles[role] ?? []).find((list) => list.length) ?? [];
			const largest = sources.at(-1);
			if (!largest) return [];
			return [
				{
					src: largest.url,
					srcset: sources.map((source) => `${source.url} ${source.width}w`).join(', '),
					width: art.width,
					height: art.height,
					alt: art.alt,
				},
			];
		});
	}

	/** Without functional consent nothing is stored: the session flag keeps it to once a visit. */
	private remember(event: ShopEvent): void {
		if (!this.consent.allows('functional')) return;
		const now = this.events.serverTime();
		const answered = this.answered();
		answered.set(event.id, answerUntil(event, this.neverAgain(), now));
		const { value, maxAge } = writeEventsCookie(answered, now);
		this.document.cookie = `${EVENTS_COOKIE}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax; Secure`;
	}

	private quietPage(): boolean {
		const path = this.router.url.split(/[?#]/)[0] as string;
		return QUIET_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
	}
}
