import 'reflect-metadata';

import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { LocationStockMovement } from '../src/infra/location-stock-movement';
import { buildMailboxTokenStore } from '../src/infra/mail-adapters-factory';
import { PersistenceModule } from '../src/infra/persistence.module';
import {
	BUNDLE_READER,
	BUNDLE_STOCK,
	DOCUMENT_RENDERER,
	PRODUCT_VARIANT_REPOSITORY,
	QUEUE_STATS,
	SALE_PRICE_BOOK,
	SEARCH_PORT,
	STOCK_MOVEMENT,
} from '../src/infra/tokens';
import { UnavailableMailboxAdapter } from '../src/infra/unavailable-mailbox.adapter';
import { UnavailableYouTubeAdapter } from '../src/infra/unavailable-youtube.adapter';
import { LanguageStore } from '../src/languages/language-store';

const factoryFor = (token: unknown) => {
	const providers = Reflect.getMetadata('providers', PersistenceModule) as Array<{
		provide: unknown;
		useFactory?: (...args: never[]) => unknown;
	}>;
	return providers.find((row) => row.provide === token)?.useFactory as (...args: unknown[]) => unknown;
};

const redis = { host: '127.0.0.1', port: 6379, db: 0, password: undefined };

describe('persistence providers: the last factories', () => {
	it('builds the sale price book, the sale-aware variants, the bundle reader and the bundle stock', () => {
		const book = factoryFor(SALE_PRICE_BOOK)({}, {}, {});
		expect(book).toBeDefined();
		expect(factoryFor(PRODUCT_VARIANT_REPOSITORY)(book)).toBeDefined();
		const reader = factoryFor(BUNDLE_READER)({}, {}, {}, book);
		expect(reader).toBeDefined();
		expect(factoryFor(BUNDLE_STOCK)({}, {}, reader)).toBeDefined();
	});

	it('gives search the languages the store holds now', () => {
		const languages = { content: vi.fn(() => ['en', 'bn']) };
		const search = factoryFor(SEARCH_PORT)(
			{},
			{ search: { host: 'http://search.test', apiKey: 'k', index: 'products' } },
			languages,
		) as {
			locales: () => readonly string[];
		};
		expect(search.locales()).toEqual(['en', 'bn']);
		expect(languages.content).toHaveBeenCalledOnce();
	});

	it('keeps the language list, every stock move’s location, and the two Redis queues', () => {
		expect(factoryFor(LanguageStore)({}, { locales: ['en', 'bn'] })).toBeInstanceOf(LanguageStore);
		expect(factoryFor(STOCK_MOVEMENT)({ list: async () => [] })).toBeInstanceOf(LocationStockMovement);
		expect(factoryFor(DOCUMENT_RENDERER)({ redis, documents: { renderTimeoutMs: 30_000 } })).toBeDefined();
		expect(factoryFor(QUEUE_STATS)({ redis })).toBeDefined();
	});
});

describe('stock moves by location: the last cases', () => {
	const inner = () => ({
		move: vi.fn(),
		consumeLayer: vi.fn(async () => undefined),
		locationStock: vi.fn(async () => [{ variantId: 'var_1', locationId: 'loc_1', onHand: 2 }]),
		placeUnlocatedStock: vi.fn(),
	});
	const warehouse = {
		list: async () => [
			{ id: 'loc_1', active: true, warehouse: true, shipsOnline: true, createdAt: '2026-11-23T00:00:00.000Z' },
		],
	};

	it('tries placing unlocated stock again after a failed first try', async () => {
		const port = inner();
		port.placeUnlocatedStock.mockRejectedValueOnce(new Error('write conflict')).mockResolvedValueOnce({});
		const moves = new LocationStockMovement(port as never, warehouse as never);
		await expect(moves.defaultLocation()).rejects.toThrow('write conflict');
		await expect(moves.defaultLocation()).resolves.toBe('loc_1');
		expect(port.placeUnlocatedStock).toHaveBeenCalledTimes(2);
	});

	it('passes layers, per-location stock and placing straight through', async () => {
		const port = inner();
		const moves = new LocationStockMovement(port as never, warehouse as never);
		await moves.consumeLayer('lay_1', 2, { session: 's' } as never);
		expect(port.consumeLayer).toHaveBeenCalledWith('lay_1', 2, { session: 's' });
		expect(await moves.locationStock(['var_1'])).toEqual([{ variantId: 'var_1', locationId: 'loc_1', onHand: 2 }]);
		await moves.placeUnlocatedStock('loc_2');
		expect(port.placeUnlocatedStock).toHaveBeenCalledWith('loc_2');
	});
});

describe('adapters bound when a service is not set up', () => {
	it('refuses every YouTube read with "unavailable"', async () => {
		const youtube = new UnavailableYouTubeAdapter();
		await expect(youtube.describeVideos()).rejects.toBeInstanceOf(ServiceUnavailableException);
		await expect(youtube.downloadThumbnail()).rejects.toBeInstanceOf(ServiceUnavailableException);
	});

	it('names no Gmail feature as missing when Gmail is not set up at all', () => {
		expect(new UnavailableMailboxAdapter().featuresMissing()).toEqual([]);
	});

	it('keeps the previous mailbox token key for reading tokens saved before a key change', () => {
		const key = Buffer.alloc(32, 1).toString('base64');
		const previous = Buffer.alloc(32, 2).toString('base64');
		const store = buildMailboxTokenStore({
			mail: { tokenKey: key, tokenKeyPrevious: previous },
		} as never) as unknown as {
			previousKey: Buffer | null;
		};
		expect(store.previousKey).toEqual(Buffer.alloc(32, 2));
	});
});
