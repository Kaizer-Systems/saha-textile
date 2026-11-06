import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IProduct, IRecentPurchase } from '@data-access/interfaces/product.interface';
import { ProductService } from '@data-access/services/product.service';

import { RecentPurchasePopup } from './recent-purchase-popup';

const now = new Date('2026-11-06T12:00:00.000Z');
const sold = (slug: string, minutesAgo: number): IRecentPurchase => ({
	product: { name: slug, slug } as IProduct,
	purchasedAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
});

async function open(purchases: IRecentPurchase[]) {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			RecentPurchasePopup,
			TranslocoTestingModule.forRoot({ langs: { en: { someone_recently_purchased: 'Someone' } } }),
		],
		providers: [
			provideRouter([]),
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			{ provide: ProductService, useValue: { recentPurchases: () => of(purchases) } },
		],
	});
	const fixture = TestBed.createComponent(RecentPurchasePopup);
	fixture.autoDetectChanges();
	await vi.advanceTimersByTimeAsync(0);
	return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('the recent purchase popup', () => {
	beforeEach(() => {
		vi.useFakeTimers({ now });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('stays hidden while there are no real sales', async () => {
		const { el } = await open([]);

		await vi.advanceTimersByTimeAsync(60_000);

		expect(el.querySelector('.recently-purchase')).toBeNull();
	});

	it('names a real sale with its real age, then hides it again', async () => {
		const { fixture, el } = await open([sold('silk-saree', 11)]);

		await vi.advanceTimersByTimeAsync(20_000);
		fixture.detectChanges();

		expect(el.querySelector('.product-name')?.textContent).toBe('silk-saree');
		expect(el.querySelector('.timeAgo')?.textContent).toBe('11 minutes ago');
		expect(el.querySelector('.recently-purchase')?.classList).toContain('show');

		await vi.advanceTimersByTimeAsync(5_000);
		fixture.detectChanges();
		expect(el.querySelector('.recently-purchase')?.classList).not.toContain('show');
	});

	it('moves through the sales in turn and says hours for an older one', async () => {
		const { fixture, el } = await open([sold('first', 5), sold('second', 180)]);

		await vi.advanceTimersByTimeAsync(40_000);
		fixture.detectChanges();

		expect(el.querySelector('.product-name')?.textContent).toBe('second');
		expect(el.querySelector('.timeAgo')?.textContent).toBe('3 hours ago');
	});

	it('stays closed once the shopper closes it', async () => {
		const { fixture, el } = await open([sold('silk-saree', 11)]);
		await vi.advanceTimersByTimeAsync(20_000);
		fixture.detectChanges();

		fixture.componentInstance.closePopup();
		await vi.advanceTimersByTimeAsync(20_000);
		fixture.detectChanges();

		expect(el.querySelector('.recently-purchase')?.classList).not.toContain('show');
	});
});
