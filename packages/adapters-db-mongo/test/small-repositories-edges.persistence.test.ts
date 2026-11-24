import { StaleVersionError } from '@saha-textile/core-domain';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { toCategory, toCurrency, toProduct } from '../src/mappers';
import {
	AdminUserLocationsModel,
	CommunicationSwitchModel,
	CompanyProfileModel,
	EmailPictureModel,
	FeatureSwitchesModel,
	GstRegistrationModel,
	LanguageModel,
	LegalPageModel,
	LocationModel,
	MediaProfileModel,
	MediaZipModel,
	OrderModel,
	ProductModel,
	SearchOutboxModel,
	ShopEventModel,
} from '../src/models/index';
import { MongoCommunicationSwitchRepository } from '../src/repositories/communication-switch.repository';
import { MongoCompanyRepository } from '../src/repositories/company.repository';
import { MongoEmailPictureRepository } from '../src/repositories/email-picture.repository';
import { MongoLanguageRepository } from '../src/repositories/language.repository';
import { MongoLegalPageRepository } from '../src/repositories/legal-page.repository';
import { entriesFor } from '../src/repositories/localized-text-registry';
import { MongoLocationRepository } from '../src/repositories/location.repository';
import { MongoMediaProfileRepository } from '../src/repositories/media-profile.repository';
import { MongoMediaZipRepository } from '../src/repositories/media-zip.repository';
import { MongoOrderRepository } from '../src/repositories/order.repository';
import { MongoProductRepository } from '../src/repositories/product.repository';
import { MongoSearchOutboxRepository } from '../src/repositories/search-outbox.repository';
import { MongoSearchTermRepository } from '../src/repositories/search-term.repository';
import { MongoShopEventRepository } from '../src/repositories/shop-event.repository';
import { hasMongoEnv, insertRaw, runPrefix } from './mongo-test-env';

describe('mappers: the optional parts (no database)', () => {
	it('copies a category’s shipping, a product’s shipping charges and free shipping, and a rate’s date', () => {
		expect(
			toCategory({ _id: 'c1', name: { en: 'Silk' }, slug: 'silk', shipping: { domestic: 100 } } as never),
		).toMatchObject({
			shipping: { domestic: 100 },
		});
		expect(
			toProduct({
				_id: 'p1',
				type: 'simple',
				sku: 's',
				title: {},
				slug: 's',
				shippingCharges: { domestic: 50 },
				freeShipping: true,
			} as never),
		).toMatchObject({ shippingCharges: { domestic: 50 }, freeShipping: true });
		expect(
			toCurrency({
				_id: 'USD',
				symbol: '$',
				rateFromINR: 0.012,
				rateSetAt: new Date('2026-11-20T00:00:00Z'),
			} as never).rateSetAt,
		).toBe('2026-11-20T00:00:00.000Z');
	});

	it('lists the registry entries of one to-do area', () => {
		const area = entriesFor('products');
		expect(area.length).toBeGreaterThan(0);
		expect(area.every((entry) => entry.area === 'products')).toBe(true);
	});
});

describe.runIf(hasMongoEnv())('small repositories: the remaining reads and writes (rs0)', () => {
	const P = runPrefix('smallx');

	beforeAll(async () => {
		await connectMongo();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	afterAll(async () => {
		const ours = { $regex: `^${P}` };
		await Promise.all([
			OrderModel.deleteMany({ _id: ours }),
			ProductModel.deleteMany({ _id: ours }),
			MediaZipModel.deleteMany({ _id: ours }),
			EmailPictureModel.deleteMany({ _id: ours }),
			GstRegistrationModel.deleteMany({ _id: ours }),
			LegalPageModel.deleteMany({ _id: ours }),
			LocationModel.deleteMany({ _id: ours }),
			MediaProfileModel.deleteMany({ _id: ours }),
			ShopEventModel.deleteMany({ _id: ours }),
			CommunicationSwitchModel.deleteMany({ _id: ours }),
			SearchOutboxModel.deleteMany({ _id: ours }),
		]);
		await disconnectMongo();
	});

	it('totals nothing paid in an empty range, and lists only the asked products’ paid lines', async () => {
		const orders = new MongoOrderRepository();
		expect(await orders.paidTotalsBetween('1990-01-01T00:00:00.000Z', '1990-01-02T00:00:00.000Z')).toEqual({
			orders: 0,
			totalINR: 0,
		});
		expect(await orders.hasLinesFor(`${P}none`)).toBe(false);
		expect(await orders.listPaidLinesBetween('1990-01-01', '1990-02-01', [])).toEqual([]);
		await insertRaw(OrderModel as never, {
			_id: `${P}order`,
			orderNumber: `${P}N1`,
			status: 'paid',
			currency: 'INR',
			createdAt: new Date('1990-01-15T00:00:00.000Z'),
			lines: [
				{ productId: `${P}silk`, sku: 'SILK', quantity: 2, unitPriceINR: 100 },
				{ productId: `${P}other`, sku: 'OTHER', quantity: 1, unitPriceINR: 50 },
			],
		});
		expect(
			await orders.listPaidLinesBetween('1990-01-01T00:00:00.000Z', '1990-02-01T00:00:00.000Z', [`${P}silk`]),
		).toEqual([{ orderId: `${P}order`, productId: `${P}silk`, sku: 'SILK', quantity: 2, unitPriceINR: 100 }]);
		expect(await orders.hasLinesFor(`${P}silk`)).toBe(true);
	});

	it('lists products by type, shop visibility and ids, by main category and with videos', async () => {
		const products = new MongoProductRepository();
		await insertRaw(ProductModel as never, {
			_id: `${P}shown`,
			type: 'simple',
			sku: `${P}A`,
			slug: `${P}a`,
			title: { en: 'A' },
			status: 'live',
			categoryIds: [`${P}cat`],
			videos: [{ id: 'v' }],
		});
		await insertRaw(ProductModel as never, {
			_id: `${P}hidden`,
			type: 'variable',
			sku: `${P}B`,
			slug: `${P}b`,
			title: { en: 'B' },
			status: 'live',
			showOnShop: false,
		});
		const list = (over: Record<string, unknown>) =>
			products.list({
				audience: 'admin',
				ids: [`${P}shown`, `${P}hidden`],
				page: 1,
				pageSize: 10,
				...over,
			} as never);
		expect((await list({ shop: 'hidden' })).items.map((row) => row.id)).toEqual([`${P}hidden`]);
		expect((await list({ shop: 'shown' })).items.map((row) => row.id)).toEqual([`${P}shown`]);
		expect((await list({ type: 'variable' })).items.map((row) => row.id)).toEqual([`${P}hidden`]);
		expect((await products.listByMainCategory(`${P}cat`)).map((row) => row.id)).toEqual([`${P}shown`]);
		expect((await products.listWithVideos()).map((row) => row.id)).toContain(`${P}shown`);
	});

	it('finds no zip that is not there, and saves every part of a zip’s progress', async () => {
		const zips = new MongoMediaZipRepository();
		expect(await zips.find(`${P}none`)).toBeNull();
		await insertRaw(MediaZipModel as never, {
			_id: `${P}zip`,
			state: 'adding',
			name: 'x.zip',
			userId: 'u',
			fileIds: [],
			folderIds: [],
			storageKey: 'zips/x.zip',
			files: { done: 0, total: 1 },
			bytes: { done: 0, total: 2 },
			createdAt: new Date(),
		});
		await zips.update(`${P}zip`, {
			bytes: { done: 1, total: 2 },
			readyAt: null,
			expiresAt: null,
			error: null,
		} as never);
		const done = await zips.update(`${P}zip`, {
			readyAt: '2026-11-20T00:00:00.000Z',
			expiresAt: '2026-11-21T00:00:00.000Z',
			error: 'x',
		} as never);
		expect(done).toMatchObject({
			readyAt: '2026-11-20T00:00:00.000Z',
			expiresAt: '2026-11-21T00:00:00.000Z',
			error: 'x',
		});
	});

	it('keeps nothing for no rows, reads older email pictures, pages after a key, and totals none', async () => {
		const pictures = new MongoEmailPictureRepository();
		await pictures.keep([]);
		await insertRaw(EmailPictureModel as never, {
			_id: `${P}email/a.jpg`,
			assetId: 'med_x',
			photoName: 'x',
			width: 300,
			bytes: 10,
			why: 'deleted',
			goneAt: new Date(),
		});
		const page = await pictures.list({ sent: 'never', now: new Date(), after: `${P}email/`, limit: 1 });
		expect(page[0]).toMatchObject({ key: `${P}email/a.jpg`, goneBy: null, sentCount: 0 });
		vi.spyOn(EmailPictureModel, 'aggregate').mockReturnValueOnce({ exec: async () => [] } as never);
		expect(await pictures.totals()).toEqual({ count: 0, bytes: 0 });
	});

	it('reads missing company records as none, refuses an unwritable save, and a stale one with nothing stored', async () => {
		const company = new MongoCompanyRepository();
		vi.spyOn(CompanyProfileModel, 'findById').mockReturnValueOnce({
			lean: () => ({ exec: async () => null }),
		} as never);
		expect(await company.getProfile()).toBeNull();
		vi.spyOn(FeatureSwitchesModel, 'findById').mockReturnValueOnce({
			lean: () => ({ exec: async () => null }),
		} as never);
		expect(await company.getFeatures()).toBeNull();
		expect(await company.getRegistration(`${P}none`)).toBeNull();
		expect(await company.findRegistrationByGstin(`${P}NONE`)).toBeNull();
		await expect(company.saveRegistration({ id: `${P}reg`, $bad: 1 } as never, null)).rejects.not.toBeInstanceOf(
			StaleVersionError,
		);
		await expect(
			company.saveRegistration({ id: `${P}reg2`, gstin: `${P}G` } as never, 'not-the-stamp'),
		).rejects.toMatchObject({
			name: 'StaleVersionError',
			current: { updatedAt: '' },
		});
	});

	it('reads an older legal page, finds none for an unknown slug, and saves a first version', async () => {
		const pages = new MongoLegalPageRepository();
		await insertRaw(LegalPageModel as never, {
			_id: `${P}terms`,
			version: 1,
			updatedAt: new Date('2026-11-20T00:00:00Z'),
		});
		expect((await pages.list()).find((row) => row.slug === `${P}terms`)).toMatchObject({
			title: {},
			content: {},
			metaTitle: {},
			metaDescription: {},
		});
		expect(await pages.find(`${P}none` as never)).toBeNull();
		await pages.save(
			{
				slug: `${P}privacy`,
				title: { en: 'Privacy' },
				content: {},
				metaTitle: {},
				metaDescription: {},
				metaImageAssetId: null,
				metaImageVersionId: null,
				version: 1,
				updatedAt: '2026-11-20T00:00:00.000Z',
				updatedBy: null,
			} as never,
			null,
		);
		expect((await pages.find(`${P}privacy` as never))?.title).toEqual({ en: 'Privacy' });
	});

	it('finds no location or locations list for unknown ids, and refuses stale, duplicate and unwritable saves', async () => {
		const locations = new MongoLocationRepository();
		expect(await locations.get(`${P}none`)).toBeNull();
		expect(await locations.adminUserLocations(`${P}nobody`)).toBeNull();
		await expect(locations.save({ id: `${P}ghost`, shortCode: `${P}G` } as never, 'stamp')).rejects.toMatchObject({
			current: { updatedAt: '' },
		});
		await insertRaw(LocationModel as never, { _id: `${P}loc`, shortCode: `${P}L`, updatedAt: 'stamp' });
		// A place that is not a whole location is refused before it is written.
		await expect(locations.save({ id: `${P}loc`, shortCode: `${P}L2` } as never, null)).rejects.toThrow();
		await expect(locations.save({ id: `${P}loc`, $bad: 1 } as never, 'stamp')).rejects.not.toBeInstanceOf(
			StaleVersionError,
		);
		expect(await AdminUserLocationsModel.countDocuments({ _id: `${P}nobody` })).toBe(0);
	});

	it('reads an older image profile, and inserts nothing for no profiles', async () => {
		const profiles = new MongoMediaProfileRepository();
		await insertRaw(MediaProfileModel as never, {
			_id: `${P}old`,
			name: 'Old',
			roles: ['card'],
			widths: {},
			maxBytes: 1,
			accepts: [],
		});
		expect(await profiles.findByKey(`${P}old`)).toMatchObject({ fills: [], version: 1, updatedAt: undefined });
		// Straight to the collection: the model would stamp its own time over this one.
		await MediaProfileModel.collection.updateOne(
			{ _id: `${P}old` as never },
			{ $set: { updatedAt: new Date('2026-11-20T00:00:00Z') } },
		);
		expect((await profiles.findByKey(`${P}old`))?.updatedAt).toBe('2026-11-20T00:00:00.000Z');
		expect(await profiles.insertMissing([])).toBe(0);
	});

	it('seeds languages only into an empty list, tolerating a row another process wrote first', async () => {
		const languages = new MongoLanguageRepository();
		vi.spyOn(LanguageModel, 'estimatedDocumentCount').mockReturnValue({ exec: async () => 0 } as never);
		const update = vi.spyOn(LanguageModel, 'updateOne');
		update.mockReturnValueOnce({
			exec: async () => Promise.reject(Object.assign(new Error('dup'), { code: 11000 })),
		} as never);
		const record = {
			code: 'en',
			admin: true,
			shop: 'on',
			everOn: true,
			changedAt: null,
			changedBy: null,
			deletedAt: null,
			erasedAt: null,
		} as never;
		expect(await languages.seedIfEmpty([record])).toBe(false);
		update.mockReturnValueOnce({ exec: async () => Promise.reject(new Error('down')) } as never);
		await expect(languages.seedIfEmpty([record])).rejects.toThrow('down');
	});

	it('lists shop events by ids without a search', async () => {
		const events = new MongoShopEventRepository();
		await insertRaw(ShopEventModel as never, {
			_id: `${P}event`,
			type: 'sale',
			name: `${P}Diwali`,
			status: 'draft',
			title: { en: 'Diwali' },
		});
		expect(
			(await events.list({ ids: [`${P}event`], page: 1, pageSize: 10 } as never)).items.map((row) => row.id),
		).toEqual([`${P}event`]);
	});

	it('reads an older communication switch without who changed it or when', async () => {
		await insertRaw(CommunicationSwitchModel as never, {
			_id: `${P}use.sms`,
			use: `${P}use`,
			channel: 'sms',
			on: true,
		});
		expect(await new MongoCommunicationSwitchRepository().find(`${P}use`, 'sms')).toEqual({
			use: `${P}use`,
			channel: 'sms',
			on: true,
			updatedBy: null,
			updatedAt: null,
		});
	});

	it('reads the search outbox when nothing waits, and lists search words by ids', async () => {
		const outbox = new MongoSearchOutboxRepository();
		vi.spyOn(SearchOutboxModel, 'findOne').mockReturnValueOnce({
			sort: () => ({ lean: () => ({ exec: async () => null }) }),
		} as never);
		expect((await outbox.stats()).oldestWaitingAt).toBeNull();
		expect(
			(await new MongoSearchTermRepository().list({ ids: [`${P}none`], page: 1, pageSize: 10 } as never)).items,
		).toEqual([]);
	});
});
