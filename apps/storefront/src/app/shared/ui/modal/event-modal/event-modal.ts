import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Component, DestroyRef, PLATFORM_ID, TemplateRef, effect, inject, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { formatIst } from '@saha-textile/core-domain';

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

interface PopupImage {
	src: string;
	srcset: string | null;
	width: number | null;
	height: number | null;
	alt: string;
}

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
	imports: [Button, RouterLink, TranslocoModule],
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

	readonly template = viewChild.required<TemplateRef<unknown>>('eventModal');
	readonly shown = signal<ShopEvent | null>(null);
	readonly image = signal<PopupImage | null>(null);
	readonly neverAgain = signal(false);

	private disarm: (() => void) | null = null;
	private armed = false;

	constructor() {
		// Arms once a published event could show; the newsletter popup stands aside meanwhile.
		effect(() => {
			const candidate = this.candidate();
			this.events.popupWaiting.set(!!candidate && !this.shownThisVisit());
			if (candidate && !this.armed && isPlatformBrowser(this.platformId) && !this.shownThisVisit()) this.arm();
		});
		this.destroyRef.onDestroy(() => this.disarm?.());
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
		return countdownKey(event);
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
		this.shown.set(event);
		this.image.set(this.pickImage(event));
		this.neverAgain.set(false);
		this.modalService
			.open(this.template(), {
				ariaLabelledBy: 'event-modal-title',
				centered: true,
				windowClass: 'theme-modal modal-lg newsletter-modal',
			})
			.result.catch(() => undefined)
			.finally(() => this.remember(event));
	}

	private pickImage(event: ShopEvent): PopupImage | null {
		const art = event.popupImage;
		if (!art) return null;
		const sources = IMAGE_ROLES.map((role) => art.roles[role] ?? []).find((list) => list.length) ?? [];
		const largest = sources.at(-1);
		if (!largest) return null;
		return {
			src: largest.url,
			srcset: sources.map((source) => `${source.url} ${source.width}w`).join(', '),
			width: art.width,
			height: art.height,
			alt: art.alt,
		};
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
