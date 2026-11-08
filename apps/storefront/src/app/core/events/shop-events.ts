import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Injectable, NgZone, PLATFORM_ID, computed, inject, signal } from '@angular/core';

import { countdownParts } from '@saha-textile/core-domain';

import { environment } from '../../../../public/environments/environment';

import type {
	ShopEvent as PublicShopEvent,
	ShopEventsResponse as PublicShopEventsResponse,
} from './shop-event.interface';

/**
 * Published launch and sale events for the top bar, the phone strip, the popup and the product
 * page timer (owner brief, approved 2026-11-09).
 *
 * Every countdown runs from the server's clock: the API sends its time, and the gap to the
 * browser's clock is kept, so a wrong phone clock can't show a wrong time. The page renders
 * on the server with the lines already in it, then the browser reads the clock again and ticks.
 */
@Injectable({ providedIn: 'root' })
export class ShopEvents {
	private readonly http = inject(HttpClient);
	private readonly zone = inject(NgZone);
	private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

	readonly items = signal<PublicShopEvent[]>([]);
	/** An event popup will open this visit, so the newsletter popup waits for a later one. */
	readonly popupWaiting = signal(false);
	/** Server time in milliseconds, ticking once a second in the browser. */
	readonly now = signal(Date.now());
	private offset = 0;
	private loaded = false;
	private ticker: ReturnType<typeof setInterval> | null = null;

	/** Events with a top bar line at this moment. */
	readonly stripItems = computed(() =>
		this.items().filter((event) => event.stripUntil && Date.parse(event.stripUntil) > this.now()),
	);

	load(): void {
		if (this.loaded) return;
		this.loaded = true;
		const url = `${environment.apiUrl}/catalog/events`;
		// The server's answer is reused on hydration, so the first paint and the app agree…
		this.http.get<PublicShopEventsResponse>(url).subscribe({
			next: (response) => this.take(response, Date.now()),
			error: () => undefined,
		});
		if (!this.browser) return;
		// …then a fresh read sets the clock, because the reused answer may be minutes old.
		const sent = Date.now();
		this.http.get<PublicShopEventsResponse>(url, { transferCache: false }).subscribe({
			next: (response) => this.take(response, (sent + Date.now()) / 2),
			error: () => undefined,
		});
		this.zone.runOutsideAngular(() => {
			this.ticker = setInterval(() => this.now.set(Date.now() + this.offset), 1000);
		});
	}

	private take(response: PublicShopEventsResponse, receivedAt: number): void {
		this.offset = Date.parse(response.serverNow) - receivedAt;
		this.items.set(response.items);
		this.now.set(Date.now() + this.offset);
	}

	/** Server time now, for a component that reads it outside a signal. */
	serverTime(): number {
		return Date.now() + this.offset;
	}

	/** Days, hours, minutes and seconds left until an instant, from the server's clock. */
	left(iso: string | null): { days: number; hours: number; minutes: number; seconds: number } | null {
		if (!iso) return null;
		return countdownParts(Date.parse(iso) - this.now());
	}

	stop(): void {
		if (this.ticker) clearInterval(this.ticker);
		this.ticker = null;
	}
}
