import { describe, expect, it } from 'vitest';

import {
	badgeSlots,
	cardPrice,
	collapseRedirectTarget,
	convertMeasurement,
	measurementInRange,
	mrpPriceINR,
	percentOff,
	publicRedirectView,
	resolveLegacyAddress,
	saleFromPercent,
	sellingPriceINR,
	snapToStep,
} from '../src/catalog/index';

describe('catalog card price', () => {
	it('shows one price, the MRP and a percent rounded down when every variant matches', () => {
		expect(
			cardPrice([
				{ sellingINR: 2950, mrpINR: 3950, buyable: true, live: true },
				{ sellingINR: 2950, mrpINR: 3950, buyable: true, live: true },
			]),
		).toEqual({ kind: 'single', sellingINR: 2950, mrpINR: 3950, percentOff: 25 });
	});

	it('shows a range with no percent when the selling price or the MRP differs', () => {
		expect(
			cardPrice([
				{ sellingINR: 2450, mrpINR: 3950, buyable: true, live: true },
				{ sellingINR: 3950, mrpINR: 3950, buyable: true, live: true },
			]),
		).toEqual({ kind: 'range', minINR: 2450, maxINR: 3950 });
	});

	it('ignores a sold-out variant while something can still be bought', () => {
		expect(
			cardPrice([
				{ sellingINR: 1000, mrpINR: 2000, buyable: false, live: true },
				{ sellingINR: 2950, mrpINR: 3950, buyable: true, live: true },
			]),
		).toEqual({ kind: 'single', sellingINR: 2950, mrpINR: 3950, percentOff: 25 });
	});

	it('falls back to every live variant when none can be bought', () => {
		expect(
			cardPrice([
				{ sellingINR: 2000, mrpINR: null, buyable: false, live: true },
				{ sellingINR: 4000, mrpINR: null, buyable: false, live: true },
			]),
		).toEqual({ kind: 'range', minINR: 2000, maxINR: 4000 });
	});

	it('rounds a typed percent half-up and never advertises a larger discount', () => {
		expect(saleFromPercent(1999, 10)).toBe(1799);
		expect(percentOff(1799, 1999)).toBe(10);
		expect(percentOff(2950, 3950)).toBe(25);
		expect(percentOff(2950, null)).toBeNull();
	});

	it('reads the selling price and the MRP from the stored pair', () => {
		expect(sellingPriceINR(3950, 2950)).toBe(2950);
		expect(mrpPriceINR(3950, null, 2950)).toBe(3950);
		expect(mrpPriceINR(2950, null, null)).toBeNull();
	});

	it('returns nothing when there is no live variant', () => {
		expect(cardPrice([])).toBeNull();
		expect(cardPrice([{ sellingINR: 1000, mrpINR: null, buyable: false, live: false }])).toBeNull();
	});

	it('treats a shared selling price with different MRPs as a range', () => {
		expect(
			cardPrice([
				{ sellingINR: 2950, mrpINR: 3950, buyable: true, live: true },
				{ sellingINR: 2950, mrpINR: 4500, buyable: true, live: true },
			]),
		).toEqual({ kind: 'range', minINR: 2950, maxINR: 2950 });
	});

	it('does not strike an MRP that equals the selling price', () => {
		expect(cardPrice([{ sellingINR: 2950, mrpINR: 2950, buyable: true, live: true }])).toEqual({
			kind: 'single',
			sellingINR: 2950,
			mrpINR: 2950,
			percentOff: null,
		});
	});

	it('keeps a made-to-order row at zero stock and drops the sold-out alternative', () => {
		expect(
			cardPrice([
				{ sellingINR: 8000, mrpINR: null, buyable: false, live: true },
				{ sellingINR: 2950, mrpINR: 3950, buyable: true, live: true },
			]),
		).toEqual({ kind: 'single', sellingINR: 2950, mrpINR: 3950, percentOff: 25 });
	});

	it('rounds a half rupee half-up and keeps the ends of the percent scale', () => {
		expect(saleFromPercent(5, 10)).toBe(5);
		expect(saleFromPercent(1999, 0)).toBe(1999);
		expect(saleFromPercent(1999, 100)).toBe(0);
		expect(percentOff(621, 1000)).toBe(37);
		expect(() => saleFromPercent(1999.5, 10)).toThrow(RangeError);
		expect(() => saleFromPercent(1999, 101)).toThrow(RangeError);
		expect(() => saleFromPercent(1999, -1)).toThrow(RangeError);
	});
});

describe('measurements', () => {
	it('snaps a centimetre entry onto the field step in inches', () => {
		expect(convertMeasurement(87.9, 'cm', 'in', 0.5)).toBe(34.5);
	});

	it('keeps a value already on the step and snaps a quarter inch to the quarter', () => {
		expect(snapToStep(34.5, 0.5)).toBe(34.5);
		expect(snapToStep(1.1, 0.25)).toBe(1);
		expect(snapToStep(1.2, 0.25)).toBe(1.25);
		expect(() => snapToStep(10, 0)).toThrow(RangeError);
		expect(() => snapToStep(Number.NaN, 0.5)).toThrow(RangeError);
	});

	it('lands back on the inch step after a centimetre round trip', () => {
		const centimetres = convertMeasurement(34.5, 'in', 'cm', 0.5);
		expect(convertMeasurement(centimetres, 'cm', 'in', 0.5)).toBe(34.5);
	});

	it('accepts the ends of the range and refuses one step past either end', () => {
		expect(measurementInRange(30, 30, 50)).toBe(true);
		expect(measurementInRange(50, 30, 50)).toBe(true);
		expect(measurementInRange(29.5, 30, 50)).toBe(false);
		expect(measurementInRange(50.5, 30, 50)).toBe(false);
	});
});

describe('badge slots', () => {
	const now = new Date('2026-11-04T00:00:00.000Z');

	it('keeps one promotion and one fact, and skips a one-off with a single unit', () => {
		expect(
			badgeSlots({
				now,
				sellingBelowMrp: true,
				featured: true,
				bestseller: false,
				trending: false,
				publishedAt: null,
				backInStockAt: null,
				sellableQuantity: 1,
				lowStockThreshold: null,
				lifetimeUnitsReceived: 1,
				pinned: [],
				hidden: [],
			}),
		).toEqual({ primary: 'sale', secondary: null });
	});

	it('shows low stock on a line that was received as many and is down to the threshold', () => {
		expect(
			badgeSlots({
				now,
				sellingBelowMrp: false,
				featured: true,
				bestseller: false,
				trending: false,
				publishedAt: null,
				backInStockAt: new Date('2026-11-01T00:00:00.000Z'),
				sellableQuantity: 2,
				lowStockThreshold: null,
				lifetimeUnitsReceived: 12,
				pinned: [],
				hidden: [],
			}),
		).toEqual({ primary: 'featured', secondary: 'low_stock' });
	});

	it('does not let a pin invent a sale or a low-stock fact', () => {
		expect(
			badgeSlots({
				now,
				sellingBelowMrp: false,
				featured: false,
				bestseller: false,
				trending: false,
				publishedAt: null,
				backInStockAt: null,
				sellableQuantity: 40,
				lowStockThreshold: null,
				lifetimeUnitsReceived: 40,
				pinned: ['sale', 'low_stock'],
				hidden: [],
			}),
		).toEqual({ primary: null, secondary: null });
	});

	const base = {
		now: new Date('2026-11-04T00:00:00.000Z'),
		sellingBelowMrp: false,
		featured: false,
		bestseller: false,
		trending: false,
		publishedAt: null as Date | null,
		backInStockAt: null as Date | null,
		sellableQuantity: 12,
		lowStockThreshold: null as number | null,
		lifetimeUnitsReceived: 12,
		pinned: [] as string[],
		hidden: [] as string[],
	};

	it('hides Sale and shows Featured, and shows insight badges only when the weekly flag is set', () => {
		expect(badgeSlots({ ...base, sellingBelowMrp: true, featured: true, hidden: ['sale'] }).primary).toBe(
			'featured',
		);
		expect(badgeSlots({ ...base, bestseller: true }).primary).toBe('bestseller');
		expect(badgeSlots({ ...base, trending: true }).primary).toBe('trending');
		expect(badgeSlots(base).primary).toBeNull();
	});

	it('keeps New through 30 days and drops it one millisecond later', () => {
		const publishedAt = new Date('2026-01-01T00:00:00.000Z');
		const day = 24 * 60 * 60 * 1000;
		expect(badgeSlots({ ...base, publishedAt, now: new Date(publishedAt.getTime() + 30 * day) }).primary).toBe(
			'new',
		);
		expect(
			badgeSlots({ ...base, publishedAt, now: new Date(publishedAt.getTime() + 30 * day + 1) }).primary,
		).toBeNull();
		expect(
			badgeSlots({
				...base,
				publishedAt,
				pinned: ['new'],
				now: new Date(publishedAt.getTime() + 30 * day + 1),
			}).primary,
		).toBe('new');
		expect(badgeSlots({ ...base, publishedAt: null }).primary).toBeNull();
	});

	it('keeps Back in stock through 14 days, refuses a future stamp, and lets a hidden Low stock fall through', () => {
		const back = new Date('2026-10-21T00:00:00.000Z');
		const day = 24 * 60 * 60 * 1000;
		const input = { ...base, backInStockAt: back, sellableQuantity: 2 };
		expect(badgeSlots({ ...input, now: new Date(back.getTime() + 14 * day) }).secondary).toBe('low_stock');
		expect(badgeSlots({ ...input, sellableQuantity: 12, now: new Date(back.getTime() + 14 * day) }).secondary).toBe(
			'back_in_stock',
		);
		expect(
			badgeSlots({ ...input, sellableQuantity: 12, now: new Date(back.getTime() + 14 * day + 1) }).secondary,
		).toBeNull();
		expect(badgeSlots({ ...input, now: new Date('2026-10-01T00:00:00.000Z') }).secondary).toBe('low_stock');
		expect(badgeSlots({ ...input, hidden: ['low_stock'], sellableQuantity: 2 }).secondary).toBe('back_in_stock');
	});

	it('stays quiet at zero, on a one-off, and above the shop threshold of 2', () => {
		expect(badgeSlots({ ...base, sellableQuantity: 0 }).secondary).toBeNull();
		expect(badgeSlots({ ...base, sellableQuantity: 1, lifetimeUnitsReceived: 1 }).secondary).toBeNull();
		expect(
			badgeSlots({ ...base, sellableQuantity: 1, lifetimeUnitsReceived: 1, lowStockThreshold: 1 }).secondary,
		).toBe('low_stock');
		expect(badgeSlots({ ...base, sellableQuantity: 2 }).secondary).toBe('low_stock');
		expect(badgeSlots({ ...base, sellableQuantity: 3 }).secondary).toBeNull();
	});
});

describe('legacy addresses', () => {
	const live = (pathname: string) => pathname === '/about-us' || pathname.startsWith('/product/');

	it('sends a live product path to English in one hop and a dead category to 410', () => {
		expect(resolveLegacyAddress('/product/silk/', [], live)).toEqual({
			status: 301,
			location: '/en/product/silk',
		});
		expect(resolveLegacyAddress('/product-category/silk/', [], live)).toEqual({ status: 410 });
	});

	it('prefers an exact row over the prefix, and never sends the rest home', () => {
		expect(
			resolveLegacyAddress(
				'/product-category/silk/',
				[{ sourcePath: '/product-category/silk', statusCode: 301, targetPath: '/en/collections/silk-sarees' }],
				live,
			),
		).toEqual({ status: 301, location: '/en/collections/silk-sarees' });
	});

	it('sorts WordPress junk, search, and the account pages', () => {
		expect(resolveLegacyAddress('/wp-login.php', [], live)).toEqual({ status: 410 });
		expect(resolveLegacyAddress('/?s=silk', [], live)).toEqual({
			status: 301,
			location: '/en/search?search=silk',
		});
		expect(resolveLegacyAddress('/my-account', [], live)).toEqual({ status: 302, location: '/en/account' });
		expect(resolveLegacyAddress('/?add-to-cart=9', [], live)).toEqual({ status: 410 });
	});

	it('collapses a redirect chain and rejects a loop', () => {
		const rows = [{ sourcePath: '/en/product/b', statusCode: 301 as const, targetPath: '/en/product/c' }];
		expect(collapseRedirectTarget('/en/product/a', '/en/product/b', 301, rows)).toEqual({
			statusCode: 301,
			targetPath: '/en/product/c',
		});
		expect(
			collapseRedirectTarget('/en/product/a', '/en/product/b', 301, [
				{ sourcePath: '/en/product/b', statusCode: 301, targetPath: '/en/product/a' },
			]),
		).toEqual({ error: 'loop' });
	});

	it('matches a trailing slash to the bare path and keeps the query on a live prefix', () => {
		expect(
			resolveLegacyAddress(
				'/product/silk',
				[{ sourcePath: '/product/silk/', statusCode: 301, targetPath: '/en/product/silk' }],
				live,
			),
		).toEqual({ status: 301, location: '/en/product/silk' });
		expect(resolveLegacyAddress('/about-us?ref=card', [], (path) => path === '/about-us')).toEqual({
			status: 301,
			location: '/en/about-us?ref=card',
		});
	});

	it('answers WordPress files, feeds and sitemaps with 410 and leaves a real asset alone', () => {
		for (const path of [
			'/wp-content/uploads/saree.jpg',
			'/feed',
			'/product-sitemap.xml',
			'/wp-admin',
			'/wp-json/wp/v2',
		]) {
			expect(resolveLegacyAddress(path, [], live)).toEqual({ status: 410 });
		}
		expect(resolveLegacyAddress('/assets/logo.png', [], live)).toBeNull();
	});

	it('does not treat an empty search as a redirect and maps add-to-cart without adding', () => {
		expect(resolveLegacyAddress('/?s=', [], live)).toBeNull();
		expect(resolveLegacyAddress('/?s=silk+saree', [], live)?.location).toBe('/en/search?search=silk%20saree');
		expect(
			resolveLegacyAddress(
				'/?add-to-cart=9',
				[{ sourcePath: '/?add-to-cart=9', statusCode: 301, targetPath: '/en/product/silk' }],
				live,
			),
		).toEqual({ status: 301, location: '/en/product/silk' });
	});

	it('sends the session pages with a temporary redirect and serves a French page as itself', () => {
		expect(resolveLegacyAddress('/cart', [], live)).toEqual({ status: 302, location: '/en/cart' });
		expect(resolveLegacyAddress('/checkout', [], live)).toEqual({ status: 302, location: '/en/checkout' });
		expect(resolveLegacyAddress('/fr/product/silk', [], live)).toBeNull();
		expect(resolveLegacyAddress('/en/product-category/silk', [], live)).toEqual({ status: 410 });
		expect(resolveLegacyAddress('/fr/cart', [], live)).toBeNull();
	});

	it('collapses onto a gone row and rejects a row that points at itself', () => {
		expect(
			collapseRedirectTarget('/en/product/a', '/en/product/b', 301, [
				{ sourcePath: '/en/product/b', statusCode: 410 },
			]),
		).toEqual({ statusCode: 410 });
		expect(collapseRedirectTarget('/en/product/a', '/en/product/a', 301, [])).toEqual({ error: 'loop' });
	});

	it('answers 410 for an old WordPress post id instead of the homepage', () => {
		expect(resolveLegacyAddress('/?p=123', [], live)).toEqual({ status: 410 });
		expect(() => resolveLegacyAddress('/?s=%E0%A4%A', [], live)).not.toThrow();
		expect(resolveLegacyAddress('/product/silk?orderby=price&filter_color=red', [], live)).toEqual({
			status: 301,
			location: '/en/product/silk',
		});
		expect(
			resolveLegacyAddress(
				'/refund-request',
				[{ sourcePath: '/refund-request', statusCode: 302, targetPath: '/en/contact-us' }],
				live,
			),
		).toEqual({ status: 302, location: '/en/contact-us' });
		expect(resolveLegacyAddress('/videos', [{ sourcePath: '/videos', statusCode: 410 }], live)).toEqual({
			status: 410,
		});
		expect(resolveLegacyAddress('/?porto_builder=1', [], live)).toEqual({ status: 410 });
		expect(resolveLegacyAddress('/?attachment_id=9', [], live)).toEqual({ status: 410 });
	});

	it('does not return internal ids on the public redirect list', () => {
		expect(
			publicRedirectView({
				sourcePath: '/product/old',
				statusCode: 301,
				targetPath: '/en/product/new',
				entityId: 'prd_1',
				entityType: 'product',
			}),
		).toEqual({ sourcePath: '/product/old', statusCode: 301, targetPath: '/en/product/new' });
	});
});
