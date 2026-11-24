import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import {
	BuilderPageModel,
	CustomerModel,
	MediaFolderModel,
	PageLayoutRevisionModel,
	ProductDraftModel,
	ProductModel,
	ShippingExceptionModel,
	ShippingProviderConfigModel,
} from '../src/models/index';
import { MongoBlogCategoryRepository } from '../src/repositories/blog.repository';
import { MongoCustomerRepository } from '../src/repositories/customer.repository';
import { MongoLanguageCoverageRepository } from '../src/repositories/language-coverage.repository';
import { MongoMediaFolderRepository } from '../src/repositories/media-library.repository';
import { MongoMediaAssetRepository } from '../src/repositories/media.repository';
import { MongoPageLayoutRepository } from '../src/repositories/page-layout.repository';
import { MongoProductDraftRepository } from '../src/repositories/product-draft.repository';
import { MongoShippingRuleRepository } from '../src/repositories/shipping.repository';
import { hasMongoEnv, insertRaw, runPrefix } from './mongo-test-env';

describe.runIf(hasMongoEnv())('the adapter’s last reads and writes (rs0)', () => {
	const P = runPrefix('last');
	const at = new Date('2026-11-24T05:00:00.000Z');

	beforeAll(async () => {
		await connectMongo();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	afterAll(async () => {
		const ours = { $regex: `^${P}` };
		await Promise.all([
			BuilderPageModel.deleteMany({ _id: { $regex: P } }),
			PageLayoutRevisionModel.deleteMany({ _id: ours }),
			CustomerModel.deleteMany({ _id: ours }),
			MediaFolderModel.deleteMany({ _id: ours }),
			ProductDraftModel.deleteMany({ _id: ours }),
			ProductModel.deleteMany({ _id: ours }),
			ShippingExceptionModel.deleteMany({ _id: ours }),
		]);
		await disconnectMongo();
	});

	it('finds no blog term by a name nobody used', async () => {
		expect(await new MongoBlogCategoryRepository().findBySlug(`${P}nobody`)).toBeNull();
	});

	it('saves an address that is not the default without touching the default', async () => {
		const home = {
			id: `${P}home`,
			label: 'Home',
			fullName: 'Asha Roy',
			line1: '1 Lake Road',
			city: 'Kolkata',
			postalCode: '700029',
			country: 'India',
			isDefault: true,
		};
		const office = { ...home, id: `${P}office`, label: 'Office', isDefault: false };
		await CustomerModel.create([
			{
				_id: `${P}cus`,
				email: `${P}cus@last.test`,
				emailVerified: true,
				status: 'active',
				addresses: [home, office],
			},
		]);
		const saved = await new MongoCustomerRepository().replaceAddress(`${P}cus`, {
			...office,
			line1: '9 Park Street',
		});
		expect(saved?.addresses.map((row) => [row.id, row.isDefault, row.line1])).toEqual([
			[`${P}home`, true, '1 Lake Road'],
			[`${P}office`, false, '9 Park Street'],
		]);
	});

	it('reads a page with no schedule, and a live layout whose revision is gone', async () => {
		await insertRaw(BuilderPageModel as never, {
			_id: `home:${P}bare`,
			pageType: 'home',
			target: `${P}bare`,
			updatedAt: at,
		});
		await insertRaw(BuilderPageModel as never, {
			_id: `home:${P}gone`,
			pageType: 'home',
			target: `${P}gone`,
			schedule: [
				{
					revisionId: `${P}no-revision`,
					layoutId: `${P}lay-gone`,
					from: new Date('2001-01-01T00:00:00Z'),
					until: new Date('2999-01-01T00:00:00Z'),
				},
			],
			updatedAt: at,
		});
		const coverage = new MongoLanguageCoverageRepository();
		const missing = await coverage.missingIds('page_builder', 'zz');
		expect(missing).not.toContain(`${P}lay-gone`);

		const layouts = new MongoPageLayoutRepository();
		expect(await layouts.page('home', `${P}bare`)).toMatchObject({ schedule: [], pending: [] });
		expect(await layouts.page('home', `${P}nobody`)).toBeNull();
	});

	it('erasing a language rewrites only the arrays that held it', async () => {
		await insertRaw(ProductModel as never, {
			_id: `${P}flat`,
			type: 'simple',
			sku: `${P}F`,
			slug: `${P}f`,
			title: { en: 'Silk' },
			optionGroups: [
				{ code: 'c', label: { en: 'Colour' }, terms: [{ code: 'red', label: { en: 'Red', zz: 'Zed' } }] },
			],
			quickLengths: [{ metres: 1, label: { en: '1 m' } }],
		});
		expect(await new MongoLanguageCoverageRepository().erase('zz')).toBeGreaterThanOrEqual(1);
		const after = await ProductModel.findById(`${P}flat`)
			.lean<{ optionGroups: unknown[]; quickLengths: unknown[] }>()
			.exec();
		expect(after?.optionGroups).toEqual([
			{ code: 'c', label: { en: 'Colour' }, terms: [{ code: 'red', label: { en: 'Red' } }] },
		]);
		expect(after?.quickLengths).toEqual([{ metres: 1, label: { en: '1 m' } }]);
	});

	it('recounts an older folder with no ancestors stored', async () => {
		await insertRaw(MediaFolderModel as never, { _id: `${P}old`, name: 'Old', parentId: null, trashedAt: null });
		const folders = new MongoMediaFolderRepository();
		await folders.recount([`${P}old`]);
		expect(await folders.findById(`${P}old`)).toMatchObject({ id: `${P}old`, ancestors: [] });
	});

	it('browses only the given files, and finds photos named by a product among other values', async () => {
		const assets = new MongoMediaAssetRepository();
		const page = await assets.browse({ ids: [`${P}none`], page: 1, pageSize: 10 } as never);
		expect(page.items).toEqual([]);
		await insertRaw(ProductModel as never, {
			_id: `${P}gallery`,
			type: 'simple',
			sku: `${P}G`,
			slug: `${P}g`,
			title: { en: 'Gallery' },
			media: { gallery: [`med_${P}a`, 'not-a-photo', 7] },
		});
		const found = await assets.referencedIds();
		expect(found).toContain(`med_${P}a`);
		expect(found).not.toContain('not-a-photo');
	});

	it('reads an older draft with no author, and lists drafts without the Mine filter', async () => {
		await insertRaw(ProductDraftModel as never, {
			_id: `${P}draft`,
			kind: 'edit',
			title: `${P} Draft`,
			productId: `${P}prd`,
			createdAt: at,
			updatedAt: at,
		});
		const drafts = new MongoProductDraftRepository();
		expect(await drafts.findById(`${P}draft`)).toMatchObject({ createdBy: null, updatedBy: null });
		expect((await drafts.list({ productId: `${P}prd`, page: 1, pageSize: 10 })).items.map((row) => row.id)).toEqual(
			[`${P}draft`],
		);
		expect(await drafts.removeForProduct(`${P}prd`)).toBe(1);
	});

	it('reads an older exception with no note, and settings saved before revisions and authors', async () => {
		await insertRaw(ShippingExceptionModel as never, {
			_id: `${P}exc`,
			target: { kind: 'product', productId: 'p' },
			domestic: { kind: 'siteWide' },
			international: { kind: 'cantShip' },
			updatedAt: at,
		});
		const rules = new MongoShippingRuleRepository();
		expect((await rules.listExceptions()).find((row) => row.id === `${P}exc`)).toMatchObject({ note: '' });
		vi.spyOn(ShippingProviderConfigModel, 'findById').mockReturnValueOnce({
			lean: () => ({
				exec: async () => ({
					_id: 'zones',
					settings: {
						homeCountry: 'IN',
						domestic: { kind: 'ruleSet', ruleSetId: null },
						international: { kind: 'ruleSet', ruleSetId: null },
						mixedRuleSets: 'sum',
						defaultCharges: { domestic: 100, internationalFirst: 2000, internationalFurther: 900 },
						abroadPolicy: 'exportOffIndianInvoice',
						abroadOptions: { askForHomeAddress: true, holdPackingUntilComplete: false },
					},
					updatedAt: at,
				}),
			}),
		} as never);
		expect(await rules.getSettings()).toMatchObject({ revision: 0, updatedBy: null });
	});
});
