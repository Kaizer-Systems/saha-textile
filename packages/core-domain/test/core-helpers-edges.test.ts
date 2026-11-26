import type { ShippingRuleSetBody } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { blogExcerpt, compareBlogPosts } from '../src/blog/blog-rules';
import { decideLanguageChange, seedLanguages } from '../src/catalog/language-rules';
import { pluralCategory } from '../src/catalog/languages';
import { resolveLegacyAddress } from '../src/catalog/legacy-resolve';
import { placeholderFile } from '../src/catalog/media-placeholder';
import { rankTrending } from '../src/catalog/search-analytics';
import {
	CommunicationSendGate,
	decideCommunicationChange,
	isCommunicationCodeUse,
} from '../src/communications/communication-rules';
import { gstinCheckCharacter } from '../src/company/gst-identity';
import { checkFormatBlocks, ourBlocks } from '../src/documents/index';
import { inrPerUnitOf } from '../src/fx/rates';
import { legalPageText, legalPageToSave } from '../src/legal/legal-pages';
import {
	firstLocationFromShop,
	inScope,
	locationFromStore,
	locationProblems,
	locationScope,
	placeFromAddress,
	shortCodeFor,
} from '../src/locations/location-rules';
import { emailPicturesLeaving } from '../src/media/email-pictures';
import { websitePicture } from '../src/media/library';
import { checkCaps } from '../src/media/policy';
import { derivativesFor } from '../src/media/resolve-image';
import { chargeableGrams, volumetricGrams } from '../src/shipping/charges';
import { foreignAmountFromINR, routePaymentGateway } from '../src/shipping/gateway-route';
import { premadeRuleSetId } from '../src/shipping/premade';
import { ruleSetReadsWeight } from '../src/shipping/reads-weight';

describe('locations: the remaining cases', () => {
	type Write = Parameters<typeof locationProblems>[0];
	const write = (over: Partial<Write>): Write =>
		({
			warehouse: true,
			store: false,
			office: false,
			showOnStoresPage: false,
			shortCode: 'KOL',
			stateCode: '19',
			gstRegistrationId: null,
			address: '1 Lake Road',
			pin: '700029',
			...over,
		}) as Write;
	const problems = (over: Partial<Write>, context: Partial<Parameters<typeof locationProblems>[1]> = {}) =>
		locationProblems(write(over), { otherShortCodes: [], registrationStateCode: null, ...context });

	it('keeps stock out of an office, needs an address for a store, and keeps a used warehouse holding stock', () => {
		expect(problems({ office: true })).toEqual(['office_holds_no_stock']);
		expect(problems({ office: true, warehouse: false, store: true })).toEqual(['office_holds_no_stock']);
		expect(problems({ warehouse: false, store: true, address: ' ' })).toEqual(['address_needed']);
		expect(problems({ warehouse: false, store: true }, { wasWarehouse: true })).toEqual([]);
		expect(problems({ warehouse: false, store: true }, { wasWarehouse: true, stockUnits: 5 })).toEqual([
			'used_cannot_stop_holding_stock',
		]);
	});

	it('gives a super admin or a “may see all” user every location, on the chip they left it on', () => {
		const user = (over: Record<string, unknown>) =>
			({
				worksAt: ['a'],
				homeLocationId: null,
				maySeeAll: false,
				maySwitch: false,
				currentLocationId: null,
				...over,
			}) as never;
		const options = (superAdmin: boolean) => ({ superAdmin, activeIds: ['a', 'b'] });
		expect(locationScope(null, options(true))).toEqual({ all: true, ids: ['a', 'b'], current: null });
		expect(locationScope(user({ currentLocationId: 'b' }), options(true)).current).toBe('b');
		expect(locationScope(user({ currentLocationId: 'gone' }), options(true)).current).toBeNull();
		expect(locationScope(user({ maySeeAll: true, currentLocationId: 'b' }), options(false))).toEqual({
			all: false,
			ids: ['a', 'b'],
			current: 'b',
		});
		expect(locationScope(user({ maySeeAll: true, currentLocationId: 'gone' }), options(false)).current).toBeNull();
		expect(locationScope(user({ maySeeAll: true }), options(false)).current).toBeNull();
	});

	it('puts other users on their home, else their first location, else nowhere', () => {
		const options = { superAdmin: false, activeIds: ['a', 'b'] };
		const user = (over: Record<string, unknown>) =>
			({
				worksAt: ['b', 'a'],
				homeLocationId: 'gone',
				maySeeAll: false,
				maySwitch: false,
				currentLocationId: null,
				...over,
			}) as never;
		expect(locationScope(user({}), options).current).toBe('b');
		expect(locationScope(user({ worksAt: [] }), options).current).toBeNull();
		expect(locationScope(null, options)).toEqual({ all: false, ids: [], current: null });
	});

	it('shows records without a location to everyone, and others by the scope', () => {
		const scope = { all: false, ids: ['a'], current: null };
		expect(inScope(scope, null)).toBe(true);
		expect(inScope(scope, 'a')).toBe(true);
		expect(inScope(scope, 'b')).toBe(false);
		expect(inScope({ ...scope, all: true }, 'b')).toBe(true);
	});

	it('names the first location from the shop, with fallbacks for a missing city, PIN and State', () => {
		const shop = { tradeName: 'ST', legalName: 'KR', address: 'a', city: ' ', pin: '12', stateCode: null };
		expect(firstLocationFromShop(shop)).toMatchObject({
			name: 'Main warehouse',
			shortCode: 'MAI',
			pin: '',
			stateCode: '19',
		});
		expect(firstLocationFromShop({ ...shop, city: '123' })).toMatchObject({
			name: '123 warehouse',
			shortCode: 'MAIN',
		});
	});

	it('reads the city before the State, only when it is a plain place name', () => {
		expect(placeFromAddress('Tripura')).toMatchObject({ city: '' });
		expect(placeFromAddress('Tripura').stateCode).not.toBeNull();
		expect(placeFromAddress('12 Main Road, Tripura').city).toBe('');
		expect(placeFromAddress('Agartala 799001, Tripura').city).toBe('Agartala');
	});

	it('makes a short code from a name without letters, and names a store by its place, city or plain “Store”', () => {
		expect(shortCodeFor('123', [])).toBe('XX');
		const store = {
			id: 's1',
			name: 'Saha Textile, ',
			address: 'nowhere',
			pinCode: '',
			phone: null,
			openingHours: '',
			active: true,
		};
		const context = { takenShortCodes: [], pinDirectory: null, shopStateCode: '19' };
		expect(locationFromStore(store, context).name).toBe('Store store');
		expect(locationFromStore(store, { ...context, pinDirectory: { stateCode: '16', city: 'Agartala' } }).name).toBe(
			'Agartala store',
		);
	});
});

describe('shipping helpers: the remaining cases', () => {
	const kg = { kind: 'result', id: 'r', result: { kind: 'amount', amount: 10, per: 'kg' } };
	const flat = { kind: 'result', id: 'f', result: { kind: 'amount', amount: 10, per: 'once' } };
	const reads = (node: unknown) =>
		ruleSetReadsWeight({
			steps: [{ id: 's', scope: 'wholeCart', combine: 'sum', node }],
			adjust: [],
		} as unknown as ShippingRuleSetBody);

	it('finds weight in a nested condition group, a band’s result or the “otherwise”, and none in an empty step', () => {
		expect(reads(null)).toBe(false);
		const weightCondition = {
			kind: 'condition',
			id: 'c',
			field: 'line.chargeableWeight',
			op: 'moreThan',
			value: 1,
		};
		const nested = {
			kind: 'if',
			id: 'i',
			when: {
				kind: 'group',
				id: 'g',
				join: 'all',
				items: [{ kind: 'group', id: 'g2', join: 'any', items: [weightCondition] }],
			},
			then: flat,
			otherwise: flat,
		};
		expect(reads(nested)).toBe(true);
		const bands = (then: unknown, otherwise: unknown) => ({
			kind: 'bands',
			id: 'b',
			field: 'cart.subtotal',
			bands: [{ id: 'b1', from: 0, to: null, then }],
			otherwise,
		});
		expect(reads(bands(kg, null))).toBe(true);
		expect(reads(bands(flat, kg))).toBe(true);
		expect(reads(bands(flat, flat))).toBe(false);
	});

	it('has no volumetric weight for a side of nothing, and uses the actual weight without a box', () => {
		const box = { weightGrams: null, lengthCm: 0, widthCm: 10, heightCm: 10 };
		expect(volumetricGrams(box)).toBeNull();
		expect(chargeableGrams({ weightGrams: 500, lengthCm: null, widthCm: null, heightCm: null })).toBe(500);
	});

	it('routes a foreign currency only to a foreign gateway, and refuses a broken markup or a negative amount', () => {
		expect(
			routePaymentGateway('USD', {
				activeInrGateway: 'ccavenue',
				foreignGateway: null,
				homeCurrency: 'INR',
			} as never),
		).toEqual({ problem: 'noForeignGateway' });
		expect(() => foreignAmountFromINR(100, 0.012, 100)).toThrow(RangeError);
		expect(() => foreignAmountFromINR(100, 0.012, Number.NaN)).toThrow(RangeError);
		expect(() => foreignAmountFromINR(-1, 0.012, 0)).toThrow(RangeError);
		expect(() => inrPerUnitOf(0)).toThrow(RangeError);
	});

	it('names a pre-made rule set', () => {
		expect(premadeRuleSetId('flat')).toBe('premade-flat');
	});
});

describe('communications: the remaining cases', () => {
	const cell = { available: true, risk: 'safe', on: true };
	const signin = { key: 'signin_code', group: 'account', cells: { email: cell, sms: cell, whatsapp: cell } } as never;

	it('knows which rows carry codes', () => {
		expect(isCommunicationCodeUse('signin_code')).toBe(true);
		expect(isCommunicationCodeUse('order_shipped')).toBe(false);
	});

	it('keeps one phone channel on for codes, whichever is switched off', () => {
		expect(
			decideCommunicationChange([signin], { use: 'signin_code', channel: 'whatsapp', on: false }, () => false),
		).toEqual({
			ok: false,
			reason: 'phone_channel_required',
		});
	});

	it('lets a message through when its row is not in the list', async () => {
		const gate = new CommunicationSendGate([], { find: async () => null } as never);
		expect(await gate.allows('otp_login', 'sms')).toBe(true);
	});
});

describe('blog, search, languages and legal pages: the remaining cases', () => {
	it('cuts a long excerpt mid-word when there is no space late enough', () => {
		expect(blogExcerpt(undefined, `<p>${'a'.repeat(250)}</p>`, 200)).toBe(`${'a'.repeat(200)}…`);
	});

	it('puts undated posts after dated ones, and ties by id', () => {
		const post = (id: string, publishedAt: string | null) => ({ id, sticky: false, publishedAt });
		expect(compareBlogPosts(post('a', null), post('b', null))).toBeLessThan(0);
		expect(compareBlogPosts(post('a', null), post('b', '2026-11-01'))).toBeGreaterThan(0);
		expect(compareBlogPosts(post('a', '2026-11-01'), post('b', null))).toBeLessThan(0);
	});

	it('ranks equal scores by product id', () => {
		const now = new Date('2026-11-20T06:00:00Z');
		const rows = ['c', 'a', 'b'].map((productId) => ({ date: '2026-11-20', productId, clicks: 2 }));
		expect(rankTrending(rows as never, now).map((row) => row.productId)).toEqual(['a', 'b', 'c']);
	});

	it('falls back to one and other when the language tag can’t be read', () => {
		expect(pluralCategory(1, '!!')).toBe('one');
		expect(pluralCategory(2, '!!')).toBe('other');
	});

	it('leaves a shop language that is already on as it is', () => {
		const now = '2026-11-20T00:00:00.000Z';
		const bengali = seedLanguages(['en', 'bn'], now).find((row) => row.code === 'bn');
		const current = { ...bengali, shop: 'on' } as never;
		expect(
			decideLanguageChange(
				current,
				{ kind: 'shop', code: 'bn', on: true } as never,
				{ todo: 0 } as never,
				null,
				now,
			),
		).toMatchObject({
			ok: true,
			changed: false,
		});
	});

	it('reads an English prefix before any shop has said which languages it has', () => {
		expect(() => resolveLegacyAddress('/en/videos', [], () => true)).not.toThrow();
	});

	it('draws a legal page in the language asked, else English, else nothing', () => {
		expect(legalPageText({ en: 'Terms' }, 'bn')).toBe('Terms');
		expect(legalPageText({}, 'bn')).toBe('');
	});

	it('keeps no version for a share picture saved without one', () => {
		const write = { title: {}, content: {}, metaTitle: {}, metaDescription: {}, metaImageAssetId: 'med_1' };
		expect(
			legalPageToSave({
				slug: 'terms',
				write,
				current: null,
				actor: null,
				now: new Date('2026-11-20T00:00:00Z'),
			} as never).metaImageVersionId,
		).toBeNull();
	});
});

describe('documents, GSTINs and media: the remaining cases', () => {
	it('flags a block id used twice', () => {
		const blocks = ourBlocks('taxInvoice');
		const first = blocks[0] as (typeof blocks)[number];
		expect(checkFormatBlocks('taxInvoice', [...blocks, { ...first }]).map((p) => p.code)).toContain('duplicate_id');
	});

	it('reads a short GSTIN as if padded, without failing', () => {
		expect(gstinCheckCharacter('27')).toHaveLength(1);
	});

	it('names a leaving email picture by its slug when it has no name, and counts unknown bytes as nothing', () => {
		const asset = {
			id: 'med_1',
			displayName: null,
			slug: 'red-saree',
			derivatives: [
				{ role: 'email', storageKey: 'email/med_1/thumb.jpg', width: 300, height: 400, format: 'image/jpeg' },
			],
		};
		expect(
			emailPicturesLeaving(
				asset as never,
				new Set(),
				'replaced' as never,
				new Date('2026-11-20T00:00:00Z'),
				null,
			),
		).toEqual([expect.objectContaining({ photoName: 'red-saree', bytes: 0 })]);
	});

	it('refuses a file type the photo worker can’t read', () => {
		expect(checkCaps({ contentType: 'application/pdf', byteSize: 1, width: 1, height: 1 })).toEqual({
			code: 'type_not_accepted',
		});
	});

	it('names the dark placeholder, picks the widest page size, and falls back for a photo with no versions', () => {
		expect(placeholderFile('3x4', true)).toBe('placeholder-dark-3x4.svg');
		const file = (width: number) => ({
			role: 'gallery',
			storageKey: `media/med_1/gallery-${width}w.webp`,
			width,
			height: width,
			format: 'image/webp',
			versionId: null,
		});
		const asset = { visibility: 'public', derivatives: [file(1600), file(800)], versions: [] };
		expect(websitePicture(asset as never)).toMatchObject({ role: 'gallery', width: 1600 });
		expect(derivativesFor({ derivatives: [file(800)] } as never, 'v1')).toHaveLength(1);
	});
});
