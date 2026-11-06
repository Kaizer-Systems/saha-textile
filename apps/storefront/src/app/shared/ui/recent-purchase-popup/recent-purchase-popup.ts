import { isPlatformBrowser } from '@angular/common';
import { Component, DestroyRef, NgZone, PLATFORM_ID, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { ACTIVE_LOCALE } from '@core/i18n/active-locale';
import { IRecentPurchase } from '@data-access/interfaces/product.interface';
import { injectRecentPurchasesQuery } from '@data-access/queries/product.queries';

const EVERY_MS = 20_000;
const VISIBLE_MS = 5_000;
const MINUTE_MS = 60_000;

/**
 * "Someone recently purchased", from real paid orders only. Nothing is shown until the API
 * reports a sale, so the popup starts by itself once orders exist and goes quiet when they stop.
 */
@Component({
	selector: 'app-recent-purchase-popup',
	templateUrl: './recent-purchase-popup.html',
	styleUrls: ['./recent-purchase-popup.scss'],
	imports: [RouterLink, TranslocoModule],
})
export class RecentPurchasePopup {
	private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
	private readonly purchases = injectRecentPurchasesQuery(() => this.browser);
	private readonly relativeTime = new Intl.RelativeTimeFormat(inject(ACTIVE_LOCALE));
	private next = 0;

	readonly purchase = signal<IRecentPurchase | null>(null);
	readonly timeAgo = signal('');
	readonly show = signal(false);
	readonly enabled = signal(true);

	constructor() {
		if (!this.browser) return;
		// Outside the zone: a repeating timer inside it would keep the app "unstable" for good.
		const timer = inject(NgZone).runOutsideAngular(() => setInterval(() => this.showNext(), EVERY_MS));
		inject(DestroyRef).onDestroy(() => clearInterval(timer));
	}

	private showNext(): void {
		const purchases = this.purchases.data() ?? [];
		if (!purchases.length || !this.enabled()) return;
		const purchase = purchases[this.next++ % purchases.length];
		this.purchase.set(purchase);
		this.timeAgo.set(this.age(purchase.purchasedAt));
		this.show.set(true);
		setTimeout(() => this.show.set(false), VISIBLE_MS);
	}

	private age(purchasedAt: string): string {
		const minutes = Math.max(1, Math.round((Date.now() - new Date(purchasedAt).getTime()) / MINUTE_MS));
		return minutes < 60
			? this.relativeTime.format(-minutes, 'minute')
			: this.relativeTime.format(-Math.round(minutes / 60), 'hour');
	}

	closePopup(): void {
		this.enabled.set(false);
		this.show.set(false);
	}
}
