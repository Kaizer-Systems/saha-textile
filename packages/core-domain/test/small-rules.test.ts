import { describe, expect, it } from 'vitest';

import {
	AssignmentAlreadyActiveError,
	DuplicateIdentifierError,
	OAuthProviderUnavailableError,
	OAuthTokenInvalidError,
	SearchUnavailableError,
	applyDiscountINR,
	cardPrice,
	collapseRedirectTarget,
	convertFromINR,
	convertMeasurement,
	credentialsAfterRemoval,
	discountAmountINR,
	insightWeekId,
	isWithinTier,
	mrpPriceINR,
	normaliseSourcePath,
	paypalGrossUp,
	publicRedirectView,
	resolveLegacyAddress,
	roundMoney,
	searchDocument,
	selectDefaultVariant,
	snapToStep,
	sortListing,
} from '../src/index';
import { rateLimitClientScope } from '../src/auth/client-scope';

describe('rateLimitClientScope with malformed addresses', () => {
	it.each([
		['1:2:3:4:5:6:1.2.3.4', '1:2:3:4::/64'],
		['1:2:3:4:5:6:7:8::9', '1:2:3:4:5:6:7:8::9'],
		['::ffff:1.2.3', '::ffff:1.2.3'],
		['::ffff:1.2.3.x', '::ffff:1.2.3.x'],
	])('reads %s', (address, expected) => {
		expect(rateLimitClientScope(address)).toBe(expected);
	});
});

describe('isWithinTier', () => {
	it('treats an unknown tier as below every real one', () => {
		expect(isWithinTier('ghost' as never, 'staff')).toBe(true);
		expect(isWithinTier('staff', 'ghost' as never)).toBe(false);
	});
});

describe('credentialsAfterRemoval', () => {
	it('keeps the password when a provider is removed', () => {
		expect(
			credentialsAfterRemoval({
				passwordSet: true,
				emailVerified: false,
				phoneVerified: false,
				linkedProviders: ['google'],
				removing: { kind: 'provider', provider: 'google' },
			}),
		).toBe(1);
	});
});

describe('card prices', () => {
	it('uses the compare-at price when it is above the selling price', () => {
		expect(mrpPriceINR(1000, 1500, null)).toBe(1500);
		expect(mrpPriceINR(1000, 900, null)).toBeNull();
	});

	it('has no price for no variants', () => {
		expect(cardPrice([])).toBeNull();
	});
});

describe('selectDefaultVariant', () => {
	const row = (isBase: boolean, buyable: boolean) => ({ isBase, buyable });

	it('prefers a buyable base, then any buyable, then the base, then the first', () => {
		const base = row(true, true);
		expect(selectDefaultVariant([row(false, true), base])).toBe(base);
		const buyable = row(false, true);
		expect(selectDefaultVariant([row(true, false), buyable])).toBe(buyable);
		const soldOutBase = row(true, false);
		expect(selectDefaultVariant([row(false, false), soldOutBase])).toBe(soldOutBase);
		const first = row(false, false);
		expect(selectDefaultVariant([first, row(false, false)])).toBe(first);
		expect(selectDefaultVariant([])).toBeNull();
	});
});

describe('legacy addresses', () => {
	it('stores the home address as a slash', () => {
		expect(normaliseSourcePath('/')).toBe('/');
		expect(normaliseSourcePath('/page/2')).toBe('/');
	});

	it('leaves the target out of a public row that has none', () => {
		expect(publicRedirectView({ sourcePath: '/old', statusCode: 410 })).toEqual({
			sourcePath: '/old',
			statusCode: 410,
		});
	});

	it('keeps a live page query but drops shop filters', () => {
		expect(resolveLegacyAddress('/about?orderby=price&p=12&', [], () => true)).toEqual({
			status: 301,
			location: '/en/about?p=12',
		});
	});

	it('finds a loop through existing rows', () => {
		const rows = [
			{ sourcePath: '/b', statusCode: 301 as const, targetPath: '/c' },
			{ sourcePath: '/c', statusCode: 301 as const, targetPath: '/b' },
		];
		expect(collapseRedirectTarget('/a', '/b', 301, rows)).toEqual({ error: 'loop' });
	});
});

describe('sortListing', () => {
	it('breaks a title tie by id', () => {
		const rows = [
			{ id: 'p2', title: 'Same' },
			{ id: 'p1', title: 'Same' },
		];
		const sorted = sortListing(rows as never, 'a-z' as never) as unknown as { id: string }[];
		expect(sorted.map((row) => row.id)).toEqual(['p1', 'p2']);
	});
});

describe('measurements', () => {
	it('snaps whole steps and tiny steps', () => {
		expect(snapToStep(7.4, 2)).toBe(8);
		expect(snapToStep(3, 1e-7)).toBe(3);
	});

	it('only snaps when the unit is the same', () => {
		expect(convertMeasurement(36.2, 'in', 'in', 0.5)).toBe(36);
		expect(convertMeasurement(10, 'in', 'cm', 0.5)).toBe(25.5);
		expect(convertMeasurement(25.4, 'cm', 'in', 0.5)).toBe(10);
	});
});

describe('searchDocument', () => {
	it('copes with a row that has no categories', () => {
		const doc = searchDocument({ id: 'p1', slug: 's', sku: 'k', title: { en: 'T' } } as never);
		expect(doc).toEqual({ id: 'p1', words: 'T s k', categoryIds: [] });
	});
});

describe('insightWeekId', () => {
	it('puts a Sunday in the week that started on the Monday before', () => {
		expect(insightWeekId(new Date('2026-11-08T12:00:00.000Z'))).toBe(
			insightWeekId(new Date('2026-11-02T12:00:00.000Z')),
		);
	});
});

describe('pricing guards', () => {
	it('refuses negative amounts', () => {
		expect(() => discountAmountINR(-1, { type: 'fixed', value: 1 } as never)).toThrow('priceINR');
		expect(() => discountAmountINR(1, { type: 'fixed', value: -1 } as never)).toThrow('promotion value');
		expect(() => convertFromINR(-1, 0.5)).toThrow('amountINR');
		expect(() => paypalGrossUp(-1, 0.1, 1)).toThrow('non-negative');
		expect(() => paypalGrossUp(1, 0.1, -1)).toThrow('non-negative');
	});

	it('refuses an amount that is not finite', () => {
		expect(() => roundMoney(Number.NaN)).toThrow('finite');
	});

	it('applies a fixed discount without going below zero', () => {
		expect(applyDiscountINR(100, { type: 'fixed', value: 150 } as never)).toBe(0);
	});
});

describe('port errors', () => {
	it('carry their details', () => {
		expect(new DuplicateIdentifierError('email')).toMatchObject({
			name: 'DuplicateIdentifierError',
			field: 'email',
			message: 'A customer already holds that email',
		});
		expect(new OAuthProviderUnavailableError('google')).toMatchObject({
			name: 'OAuthProviderUnavailableError',
			provider: 'google',
		});
		expect(new OAuthTokenInvalidError('google', 'expired')).toMatchObject({
			name: 'OAuthTokenInvalidError',
			message: 'OAuth token rejected for google: expired',
		});
		expect(new AssignmentAlreadyActiveError('u1', 'r1')).toMatchObject({
			name: 'AssignmentAlreadyActiveError',
			userId: 'u1',
			roleId: 'r1',
		});
		expect(new SearchUnavailableError('down').name).toBe('SearchUnavailableError');
	});
});
