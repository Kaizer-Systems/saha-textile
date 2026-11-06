import { describe, expect, it, vi } from 'vitest';

import { buildMongoConfig } from '../src/config';
import { disconnectMongo } from '../src/connection';
import { asDuplicateIdentifier } from '../src/duplicate-key';
import {
	toAdminUser,
	toCart,
	toCategory,
	toCurrency,
	toCustomer,
	toOrder,
	toProduct,
	toPromotion,
} from '../src/mappers';
import { MongoTransactionManager, sessionFrom } from '../src/transaction-manager';

const at = new Date('2026-11-06T00:00:00.000Z');
const iso = at.toISOString();

describe('buildMongoConfig', () => {
	it('uses a full URI as it is', () => {
		expect(
			buildMongoConfig({ MONGODB_URI: 'mongodb://h/db?replicaSet=rs0', MONGODB_DB_NAME: 'saha_textile_x' }),
		).toEqual({ uri: 'mongodb://h/db?replicaSet=rs0', dbName: 'saha_textile_x' });
	});

	it('treats blank values as unset and applies the defaults', () => {
		const config = buildMongoConfig({
			MONGODB_URI: '',
			MONGODB_HOST: '',
			MONGODB_PORT: '',
			MONGODB_USERNAME: '',
			MONGODB_PASSWORD: '',
			MONGODB_REPLICA_SET: '',
			MONGODB_DB_NAME: '',
			MONGODB_APP_NAME: '',
		});
		expect(config.dbName).toBe('saha_textile_local');
		expect(config.uri).toContain('mongodb://127.0.0.1:27017/saha_textile_local?replicaSet=rs0');
		expect(config.uri).not.toContain('appName');
	});

	it('encodes credentials and adds the app name', () => {
		const config = buildMongoConfig({
			MONGODB_HOST: 'db',
			MONGODB_PORT: '27018',
			MONGODB_USERNAME: 'app@user',
			MONGODB_PASSWORD: 'test/value',
			MONGODB_APP_NAME: 'saha-textile-api',
		});
		expect(config.uri).toContain('mongodb://app%40user:test%2Fvalue@db:27018/');
		expect(config.uri).toContain('appName=saha-textile-api');
	});

	it('refuses half a credential', () => {
		expect(() => buildMongoConfig({ MONGODB_USERNAME: 'app' })).toThrow('set both');
		expect(() => buildMongoConfig({ MONGODB_PASSWORD: 'test-value' })).toThrow('set both');
	});
});

describe('disconnectMongo', () => {
	it('does nothing when no connection was opened', async () => {
		await expect(disconnectMongo()).resolves.toBeUndefined();
	});
});

describe('asDuplicateIdentifier', () => {
	it('translates email and phone collisions', () => {
		expect(asDuplicateIdentifier({ code: 11000, keyPattern: { email: 1 } })?.field).toBe('email');
		expect(asDuplicateIdentifier({ code: 11000, keyPattern: { phone: 1 } })?.field).toBe('phone');
	});

	it('leaves everything else alone', () => {
		expect(asDuplicateIdentifier({ code: 11000, keyPattern: { provider: 1 } })).toBeNull();
		expect(asDuplicateIdentifier({ code: 11000 })).toBeNull();
		expect(asDuplicateIdentifier({ code: 121 })).toBeNull();
		expect(asDuplicateIdentifier(null)).toBeNull();
	});
});

describe('sessionFrom', () => {
	it('prefers the session on the context and is empty outside a transaction', () => {
		const session = { id: 's1' };
		expect(sessionFrom({ session } as never)).toBe(session);
		expect(sessionFrom()).toBeUndefined();
	});
});

describe('MongoTransactionManager', () => {
	it('refuses a driver that never ran the work, and still ends the session', async () => {
		const mongoose = (await import('mongoose')).default;
		const endSession = vi.fn(async () => {});
		const spy = vi.spyOn(mongoose, 'startSession').mockResolvedValue({
			withTransaction: async () => {},
			endSession,
		} as never);
		await expect(new MongoTransactionManager().withTransaction(async () => 1)).rejects.toThrow(
			'transaction callback did not run',
		);
		expect(endSession).toHaveBeenCalledTimes(1);
		spy.mockRestore();
	});
});

describe('mappers fill the gaps in an old row', () => {
	it('category', () => {
		expect(toCategory({ _id: 'c1', name: { en: 'Silk' }, slug: 'silk' } as never)).toMatchObject({
			parentId: null,
			path: [],
			ancestors: [],
			depth: 0,
			isBannerCollection: false,
			displayOrder: 0,
		});
	});

	it('product', () => {
		const product = toProduct({ _id: 'p1', type: 'simple', sku: 's', title: {}, slug: 's' } as never);
		expect(product).toMatchObject({
			categoryIds: [],
			tags: [],
			media: { gallery: [] },
			attributes: [],
			optionGroups: [],
			variations: [],
			addons: [],
			relatedProductIds: [],
			crossSellIds: [],
			upsellIds: [],
			ratingsSummary: { avg: 0, count: 0 },
			madeToOrder: false,
			estimatedDeliveryText: null,
			lowStockThreshold: null,
			lifetimeUnitsReceived: 0,
			featured: false,
			insightBadges: [],
			pinnedBadges: [],
			hiddenBadges: [],
			backInStockAt: null,
			replacementTarget: null,
			addonTemplateCode: null,
			addonPriceINR: null,
			onSale: false,
			hsnCode: null,
			createdAt: undefined,
			lifecycle: { liveAt: null, statusReason: null },
		});
	});

	it('currency, promotion, cart, order', () => {
		expect(toCurrency({ _id: 'USD', symbol: '$', enabled: true, rateFromINR: 0.01 } as never)).toMatchObject({
			paypalActive: false,
			paypalPct: 0,
			paypalFixed: 0,
		});
		expect(toPromotion({ _id: 'x', name: 'n', type: 'fixed', value: 1 } as never)).toMatchObject({
			targetIds: [],
			couponCode: null,
			stackable: false,
			priority: 0,
			conditions: { minCartINR: 0, firstOrderOnly: false },
		});
		expect(toCart({ _id: 'cart' } as never)).toMatchObject({
			userId: null,
			guestToken: null,
			currency: 'INR',
			lines: [],
		});
		expect(toOrder({ _id: 'o', orderNumber: 'n' } as never)).toMatchObject({
			userId: null,
			lines: [],
			promotionsApplied: [],
			statusTimeline: [],
		});
	});

	it('customer and admin user', () => {
		expect(toCustomer({ _id: 'u', displayName: 'A' } as never)).toMatchObject({
			email: null,
			emailVerified: false,
			phone: null,
			phoneVerified: false,
			status: 'active',
			identities: [],
			addresses: [],
			contacts: [],
			savedSizes: [],
			measurementProfiles: [],
			guestCartId: null,
		});
		expect(toAdminUser({ _id: 'a', displayName: 'A', role: 'staff' } as never)).toMatchObject({
			email: null,
			emailVerified: false,
			username: null,
			phone: null,
			status: 'active',
			pinConfigured: false,
			preferredLoginMethod: 'password',
			lastLoginAt: null,
		});
	});
});

describe('mappers keep a complete row', () => {
	it('category', () => {
		expect(
			toCategory({
				_id: 'c1',
				name: {},
				slug: 's',
				parentId: 'c0',
				path: ['c0'],
				ancestors: ['c0'],
				depth: 1,
				isBannerCollection: true,
				displayOrder: 3,
			} as never),
		).toMatchObject({
			parentId: 'c0',
			path: ['c0'],
			ancestors: ['c0'],
			depth: 1,
			isBannerCollection: true,
			displayOrder: 3,
		});
	});

	it('product', () => {
		const doc = {
			_id: 'p1',
			type: 'simple',
			sku: 's',
			title: {},
			slug: 's',
			categoryIds: ['c'],
			tags: ['t'],
			media: { gallery: ['m'] },
			attributes: ['a'],
			optionGroups: ['g'],
			variations: ['v'],
			addons: ['x'],
			relatedProductIds: ['r'],
			crossSellIds: ['c'],
			upsellIds: ['u'],
			ratingsSummary: { avg: 4, count: 2 },
			lifecycle: { liveAt: at, disabledAt: at, discontinuedAt: at, richDataPurgedAt: at, statusReason: 'why' },
			madeToOrder: true,
			estimatedDeliveryText: { en: 'soon' },
			lowStockThreshold: 2,
			lifetimeUnitsReceived: 9,
			featured: true,
			insightBadges: ['trending'],
			pinnedBadges: ['sale'],
			hiddenBadges: ['new'],
			backInStockAt: at,
			replacementTarget: { kind: 'product' },
			addonTemplateCode: 'fall',
			addonPriceINR: 100,
			onSale: true,
			shippingDefaults: { weightGrams: 1, lengthCm: 2, widthCm: 3, heightCm: 4 },
			hsnCode: '5007',
			createdAt: at,
			updatedAt: at,
		};
		expect(toProduct(doc as never)).toMatchObject({
			categoryIds: ['c'],
			lifecycle: { liveAt: iso, statusReason: 'why' },
			backInStockAt: iso,
			addonPriceINR: 100,
			shippingDefaults: { weightGrams: 1 },
			createdAt: iso,
		});
	});

	it('currency, promotion, cart, order', () => {
		expect(
			toCurrency({ _id: 'USD', paypalActive: true, paypalPct: 3, paypalFixed: 1, updatedAt: at } as never),
		).toMatchObject({ paypalActive: true, paypalPct: 3, paypalFixed: 1, updatedAt: iso });
		expect(
			toPromotion({
				_id: 'x',
				targetIds: ['t'],
				couponCode: 'C',
				stackable: true,
				priority: 2,
				startsAt: at,
				endsAt: at,
				conditions: { minCartINR: 5, firstOrderOnly: true },
			} as never),
		).toMatchObject({ couponCode: 'C', priority: 2, startsAt: iso, conditions: { minCartINR: 5 } });
		expect(
			toCart({ _id: 'c', userId: 'u', guestToken: 'g', currency: 'USD', lines: ['l'], updatedAt: at } as never),
		).toMatchObject({ userId: 'u', guestToken: 'g', currency: 'USD', lines: ['l'] });
		expect(
			toOrder({
				_id: 'o',
				userId: 'u',
				lines: ['l'],
				promotionsApplied: ['p'],
				statusTimeline: ['t'],
				createdAt: at,
			} as never),
		).toMatchObject({ userId: 'u', lines: ['l'], promotionsApplied: ['p'], statusTimeline: ['t'], createdAt: iso });
	});

	it('customer and admin user', () => {
		expect(
			toCustomer(
				{
					_id: 'u',
					email: 'a@example.test',
					emailVerified: true,
					phone: '+91',
					phoneVerified: true,
					status: 'suspended',
					addresses: ['a'],
					contacts: ['c'],
					savedSizes: ['s'],
					measurementProfiles: ['m'],
					guestCartId: 'g',
				} as never,
				['i'] as never,
			),
		).toMatchObject({ email: 'a@example.test', status: 'suspended', identities: ['i'], guestCartId: 'g' });
		expect(
			toAdminUser(
				{
					_id: 'a',
					email: 'a@example.test',
					emailVerified: true,
					username: 'a',
					phone: '+91',
					status: 'suspended',
					preferredLoginMethod: 'pin',
					lastLoginAt: at,
				} as never,
				true,
			),
		).toMatchObject({ username: 'a', pinConfigured: true, preferredLoginMethod: 'pin', lastLoginAt: iso });
	});
});
