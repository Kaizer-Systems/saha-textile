import { afterEach, describe, expect, it } from 'vitest';

import { cardOffer } from './card-offer';
import { readNotifyIntent, rememberNotifyIntent } from './notify-intent';
import { readRecentViews } from './recent-views';

afterEach(() => sessionStorage.clear());

describe('notify intent', () => {
	it('reads a fresh intent and drops an old one', () => {
		rememberNotifyIntent(sessionStorage, 'red', 'SKU-1', 1000);
		expect(readNotifyIntent(sessionStorage, 2000)).toEqual({ slug: 'red', variant: 'SKU-1' });
		expect(readNotifyIntent(sessionStorage, 1000 + 31 * 60_000)).toBeNull();
	});

	it('refuses a malformed record', () => {
		sessionStorage.setItem('st_notify_intent', '{"slug":1}');
		expect(readNotifyIntent(sessionStorage)).toBeNull();
		sessionStorage.setItem('st_notify_intent', '"text"');
		expect(readNotifyIntent(sessionStorage)).toBeNull();
		sessionStorage.setItem('st_notify_intent', '{broken');
		expect(readNotifyIntent(sessionStorage)).toBeNull();
	});
});

describe('recent views', () => {
	it('refuses something that is not a list, and broken text', () => {
		sessionStorage.setItem('st_recent', '{}');
		expect(readRecentViews(sessionStorage)).toEqual([]);
		sessionStorage.setItem('st_recent', '{broken');
		expect(readRecentViews(sessionStorage)).toEqual([]);
	});
});

describe('cardOffer edges', () => {
	const base = { price: 200, sale_price: 100, stock_status: 'in_stock', quantity: 1 };

	it('reads the plain price of a variant with no sale price', () => {
		const offer = cardOffer({
			...base,
			variations: [{ price: 300, sale_price: 0, stock_status: 'in_stock', quantity: 1 }],
		} as never);
		expect(offer.selling).toBe(300);
	});

	it('counts live variants when none can be bought, and all when none is live', () => {
		const sold = { price: 300, sale_price: 250, stock_status: 'out_of_stock', quantity: 0 };
		expect(cardOffer({ ...base, variations: [sold] } as never).selling).toBe(250);
		expect(cardOffer({ ...base, variations: [{ ...sold, status: false }] } as never).selling).toBe(250);
	});

	it('uses the old demo flags without API badges', () => {
		expect(cardOffer({ ...base, is_sale_enable: true } as never).primary).toBe('badge_sale');
		expect(cardOffer({ ...base, is_featured: true } as never).primary).toBe('badge_featured');
		expect(cardOffer(base as never).primary).toBeNull();
	});
});
