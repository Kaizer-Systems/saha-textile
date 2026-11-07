import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, PLATFORM_ID, TemplateRef, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { injectBrandQuery } from '@data-access/queries/brand.queries';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';

import { ConsentStore } from '@core/consent/consent.store';
import { runtimeConfig, runtimeConfigReady } from '@core/config/runtime-config';

import { Button } from '../../button/button';

/** One cookie records the visitor's answer; values are `snoozed`, `never` and `subscribed`. */
const COOKIE = 'st_newsletter';
const DAY = 86_400;
const SNOOZE_SECONDS = 7 * DAY;
const NEVER_SECONDS = 365 * DAY;
const SUBSCRIBED_SECONDS = 5 * 365 * DAY;
/** Shown at most once per browser session. */
const SESSION_FLAG = 'st_newsletter_shown';
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

interface BannerSource {
	url: string;
	width: number;
	height: number;
}
interface BannersResponse {
	banners: {
		position: string;
		alt: string;
		images: { desktop: { width: number; height: number; roles: Record<string, BannerSource[]> } };
	}[];
}

/**
 * The newsletter popup (owner log § Media → Newsletter popup).
 *
 * Engagement-only, so it never costs SEO or Core Web Vitals: nothing opens on arrival. It
 * opens on the first of — half the page scrolled, 30 seconds on the site, or (desktop only)
 * the pointer heading for the browser chrome — and never on cart, checkout, account or
 * sign-in pages. At most once per session; closing it rests it for 7 days, "don't show again"
 * for a year, subscribing for good.
 */
@Component({
	selector: 'app-newsletter-modal',
	templateUrl: './newsletter-modal.html',
	imports: [Button, TranslocoModule],
})
export class NewsletterModal {
	private readonly modalService = inject(NgbModal);
	private readonly platformId = inject(PLATFORM_ID);
	private readonly document = inject(DOCUMENT);
	private readonly router = inject(Router);
	private readonly http = inject(HttpClient);
	private readonly transloco = inject(TranslocoService);
	private readonly destroyRef = inject(DestroyRef);

	readonly template = viewChild.required<TemplateRef<unknown>>('newsletterModal');
	/** The `newsletter_popup` banner. With none set, the popup is text only. */
	readonly image = signal<PopupImage | null>(null);
	readonly brand = injectBrandQuery();
	private readonly consent = inject(ConsentStore);
	readonly notice = signal<string | null>(null);
	readonly neverAgain = signal(false);

	private disarm: (() => void) | null = null;

	ngAfterViewInit(): void {
		if (!isPlatformBrowser(this.platformId) || this.suppressed()) return;
		this.arm();
		this.destroyRef.onDestroy(() => this.disarm?.());
	}

	submit(email: string): void {
		if (!email.trim()) return;
		// The subscribe endpoint belongs to the notifications/consent chunk. Until it exists the
		// popup says so plainly rather than pretending the address was saved.
		this.notice.set('newsletter_signup_coming_soon');
	}

	private arm(): void {
		const win = this.document.defaultView;
		if (!win) return;
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

	private async open(): Promise<void> {
		if (this.suppressed() || this.quietPage() || !this.consent.decided()) return;
		this.disarm?.();
		this.document.defaultView?.sessionStorage.setItem(SESSION_FLAG, '1');
		await this.loadImage();
		this.notice.set(null);
		this.neverAgain.set(false);
		this.modalService
			.open(this.template(), {
				ariaLabelledBy: 'newsletter-modal-title',
				centered: true,
				windowClass: 'theme-modal modal-lg newsletter-modal',
			})
			.result.catch(() => undefined)
			.finally(() =>
				this.writeCookie(
					this.neverAgain() ? 'never' : 'snoozed',
					this.neverAgain() ? NEVER_SECONDS : SNOOZE_SECONDS,
				),
			);
	}

	/** The admin's `newsletter_popup` banner, if one is live; otherwise the theme artwork. */
	private async loadImage(): Promise<void> {
		try {
			await runtimeConfigReady;
			const locale = this.transloco.getActiveLang();
			const response = await firstValueFrom(
				this.http.get<BannersResponse>(`${runtimeConfig.apiUrl}/storefront/banners`, {
					params: { ownerType: 'global', locale },
				}),
			);
			const banner = response.banners.find((candidate) => candidate.position === 'newsletter_popup');
			const sources = banner?.images.desktop.roles['banner'] ?? [];
			const largest = sources.at(-1);
			if (banner && largest) {
				this.image.set({
					src: largest.url,
					srcset: sources.map((source) => `${source.url} ${source.width}w`).join(', '),
					width: banner.images.desktop.width,
					height: banner.images.desktop.height,
					alt: banner.alt,
				});
			}
		} catch {
			// The popup still works without a picture.
		}
	}

	private quietPage(): boolean {
		const path = this.router.url.split(/[?#]/)[0] as string;
		return QUIET_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
	}

	private suppressed(): boolean {
		if (this.document.defaultView?.sessionStorage.getItem(SESSION_FLAG)) return true;
		return this.document.cookie.split('; ').some((entry) => entry.startsWith(`${COOKIE}=`));
	}

	/** Without consent the answer lasts this visit, through the session flag `open` already set. */
	private writeCookie(value: string, maxAge: number): void {
		if (!this.consent.allows('functional')) return;
		const current = this.document.cookie.split('; ').find((entry) => entry.startsWith(`${COOKIE}=`));
		if (current === `${COOKIE}=subscribed`) return;
		this.document.cookie = `${COOKIE}=${value}; Max-Age=${maxAge}; Path=/; SameSite=Lax; Secure`;
	}

	/** For the subscribe endpoint, once it exists: the visitor is never asked again. */
	markSubscribed(): void {
		this.writeCookie('subscribed', SUBSCRIBED_SECONDS);
	}
}
