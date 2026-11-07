import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import {
	AttributeDefinitionModel,
	AuthIdentityModel,
	CategoryFacetConfigModel,
	CategoryPlacementModel,
	CustomerModel,
	InventoryCostLayerModel,
	InventoryLedgerModel,
	ProductBundleModel,
	ProductRelationModel,
	ProductVariantModel,
} from '../src/models/index';
import {
	InsufficientStockError,
	MongoAttributeDefinitionRepository,
	MongoCategoryFacetConfigRepository,
	MongoCategoryPlacementRepository,
	MongoCustomerRepository,
	MongoInventoryCostLayerRepository,
	MongoInventoryRepository,
	MongoProductBundleRepository,
	MongoProductRelationRepository,
	MongoProductVariantRepository,
} from '../src/repositories/index';
import { MongoTransactionManager } from '../src/transaction-manager';
import { hasMongoEnv, insertRaw, runPrefix } from './mongo-test-env';

const P = runPrefix('cat');
const at = '2026-11-06T00:00:00.000Z';
const future = '2099-01-01T00:00:00.000Z';
const past = '2000-01-01T00:00:00.000Z';
const date = new Date(at);
const transactions = new MongoTransactionManager();

describe.skipIf(!hasMongoEnv())('customer, catalogue and inventory repositories (integration, rs0)', () => {
	beforeAll(async () => {
		await connectMongo();
		await Promise.all([
			CategoryPlacementModel.syncIndexes(),
			ProductVariantModel.syncIndexes(),
			CustomerModel.syncIndexes(),
			ProductBundleModel.syncIndexes(),
		]);
	});

	afterAll(async () => {
		const byId = { _id: { $regex: `^${P}` } };
		await Promise.all([
			AttributeDefinitionModel.deleteMany(byId),
			AuthIdentityModel.deleteMany(byId),
			CategoryFacetConfigModel.deleteMany(byId),
			CategoryPlacementModel.deleteMany(byId),
			CustomerModel.deleteMany(byId),
			InventoryCostLayerModel.deleteMany(byId),
			InventoryLedgerModel.deleteMany({ variantId: { $regex: `^${P}` } }),
			ProductBundleModel.deleteMany(byId),
			ProductRelationModel.deleteMany(byId),
			ProductVariantModel.deleteMany(byId),
		]);
		await disconnectMongo();
	});

	describe('customers', () => {
		const repo = new MongoCustomerRepository();
		const id = `${P}c1`;
		const email = `${P}c1@example.test`.toLowerCase();
		const phone = `+9199${Date.now().toString().slice(-8)}`;
		const customer = (overrides: Record<string, unknown> = {}) =>
			({
				id,
				email,
				emailVerified: true,
				phone,
				phoneVerified: true,
				status: 'active',
				displayName: `${P}Asha Roy`,
				identities: [],
				addresses: [],
				contacts: [],
				savedSizes: [],
				measurementProfiles: [],
				guestCartId: null,
				...overrides,
			}) as never;
		const address = (name: string, isDefault = false) =>
			({
				id: `${P}${name}`,
				label: name,
				fullName: 'A',
				line1: '1 Road',
				city: 'Kolkata',
				state: 'WB',
				postalCode: '700001',
				country: 'IN',
				phone: '+91',
				isDefault,
			}) as never;

		it('creates and finds', async () => {
			await repo.create(customer());
			expect((await repo.findById(id))?.email).toBe(email);
			expect(await repo.findById(`${P}none`)).toBeNull();
			expect((await repo.findByPhone(phone))?.id).toBe(id);
			expect(await repo.findByPhone('+000')).toBeNull();
			expect((await repo.findByEmail(email))?.id).toBe(id);
			expect(await repo.findByEmail(`${P}none`)).toBeNull();
		});

		it('reads the credential', async () => {
			await repo.setPasswordHash(id, 'hash');
			expect(await repo.findCredentialByEmail(email)).toMatchObject({ passwordHash: 'hash' });
			expect(await repo.findCredentialByEmail(`${P}none`)).toBeNull();
		});

		it('lists with search, sort, status and an identity', async () => {
			await AuthIdentityModel.create([
				{
					_id: `${P}id1`,
					subjectType: 'customer',
					subjectId: id,
					provider: 'google',
					providerSubject: `${P}g1`,
					email: 'g@example.test',
					linkedAt: date,
				},
				{
					_id: `${P}id2`,
					subjectType: 'customer',
					subjectId: id,
					provider: 'facebook',
					providerSubject: `${P}f1`,
					linkedAt: date,
				},
			]);
			const found = await repo.list({ page: 1, pageSize: 5, q: `${P}Asha Roy`, sort: 'displayName' } as never);
			expect(found.items[0]?.identities).toEqual(
				expect.arrayContaining([
					{ provider: 'google', providerId: `${P}g1`, email: 'g@example.test' },
					{ provider: 'facebook', providerId: `${P}f1` },
				]),
			);
			expect(found.meta).toMatchObject({ total: 1, hasNext: false, hasPrev: false });
			expect(
				(await repo.list({ page: 1, pageSize: 5, status: 'deleted', q: `${P}Asha` } as never)).items,
			).toEqual([]);
			expect((await repo.list({ page: 2, pageSize: 0, q: '   ' } as never)).meta).toMatchObject({
				totalPages: 0,
				hasPrev: true,
			});
		});

		it('lists a customer with no linked sign-in', async () => {
			await insertRaw(CustomerModel, { _id: `${P}plain`, status: 'active', displayName: `${P}Plain Row` });
			const found = await repo.list({ page: 1, pageSize: 5, q: `${P}Plain` } as never);
			expect(found.items[0]?.identities).toEqual([]);
		});

		it('patches only what is given', async () => {
			expect((await repo.update(id, {}))?.id).toBe(id);
			expect((await repo.update(id, { displayName: `${P}New` }))?.displayName).toBe(`${P}New`);
			const moved = await repo.update(id, { email, phone, status: 'active' });
			expect(moved?.status).toBe('active');
			expect(await repo.update(`${P}none`, { displayName: 'x' })).toBeNull();
			expect((await repo.setStatus(id, 'disabled'))?.status).toBe('disabled');
			await repo.setStatus(id, 'active');
		});

		it('adds addresses, and a new default demotes the rest', async () => {
			await repo.addAddress(id, address('home'));
			const updated = await repo.addAddress(id, address('work', true));
			expect(updated?.addresses.map((row) => row.isDefault)).toEqual([false, true]);
			expect(await repo.addAddress(`${P}none`, address('x'))).toBeNull();
		});

		it('updates one address, and promoting it demotes the others', async () => {
			const updated = await repo.updateAddress(id, `${P}home`, { city: 'Howrah', isDefault: true });
			expect(updated?.addresses.find((row) => row.id === `${P}home`)).toMatchObject({
				city: 'Howrah',
				isDefault: true,
			});
			expect(updated?.addresses.find((row) => row.id === `${P}work`)?.isDefault).toBe(false);
			expect((await repo.updateAddress(id, `${P}home`, { line2: 'Flat 2' }))?.addresses[0]?.line2).toBe('Flat 2');
			expect(await repo.updateAddress(id, `${P}none`, { city: 'x' })).toBeNull();
		});

		it('removes an address', async () => {
			expect((await repo.deleteAddress(id, `${P}work`))?.addresses).toHaveLength(1);
			expect(await repo.deleteAddress(id, `${P}work`)).toBeNull();
		});

		it('soft deletes, restores, and falls back for an old row', async () => {
			expect((await repo.softDelete(id, at))?.status).toBe('deleted');
			expect(await repo.softDelete(id, at)).toBeNull();
			expect(await repo.findByEmail(email)).toBeNull();
			expect((await repo.restore(id))?.status).toBe('active');
			expect(await repo.restore(id)).toBeNull();
			await insertRaw(CustomerModel, { _id: `${P}old`, status: 'deleted', displayName: 'O' });
			expect((await repo.restore(`${P}old`))?.status).toBe('disabled');
		});

		it('translates a lost race, and passes on anything else', async () => {
			const duplicate = Object.assign(new Error('E11000'), { code: 11000, keyPattern: { email: 1 } });
			const rejecting = (method: 'findOneAndUpdate' | 'findByIdAndUpdate', error: unknown) =>
				vi.spyOn(CustomerModel, method).mockReturnValue({
					lean: () => ({
						exec: async () => {
							throw error;
						},
					}),
				} as never);
			let spy = rejecting('findOneAndUpdate', duplicate);
			await expect(repo.restore(id)).rejects.toMatchObject({ field: 'email' });
			spy.mockRestore();
			spy = rejecting('findOneAndUpdate', new Error('disk full'));
			await expect(repo.restore(id)).rejects.toThrow('disk full');
			spy.mockRestore();
			spy = rejecting('findByIdAndUpdate', duplicate);
			await expect(repo.save(customer())).rejects.toMatchObject({ field: 'email' });
			spy.mockRestore();
			spy = rejecting('findByIdAndUpdate', new Error('disk full'));
			await expect(repo.save(customer())).rejects.toThrow('disk full');
			spy.mockRestore();
		});

		it('adds an address to a row that has none', async () => {
			await insertRaw(CustomerModel, { _id: `${P}bare`, status: 'active', displayName: 'B' });
			expect((await repo.addAddress(`${P}bare`, address('first', true)))?.addresses).toHaveLength(1);
		});
	});

	describe('category placements', () => {
		const repo = new MongoCategoryPlacementRepository();
		const root = `${P}root`.toLowerCase();
		const placement = (
			name: string,
			parent: string | null,
			path: string[],
			overrides: Record<string, unknown> = {},
		) =>
			({
				id: `${P}${name}`,
				categoryId: `${P}${name}_cat`,
				parentCategoryId: parent,
				pathCategoryIds: path,
				pathSlugs: path.map((part) => part.toLowerCase()),
				pathLabel: name,
				depth: path.length - 1,
				isCanonical: true,
				displayOrder: 0,
				status: 'live',
				...overrides,
			}) as never;
		const a = `${P}a_cat`;
		const b = `${P}b_cat`;
		const c = `${P}c_cat`;
		const d = `${P}d_cat`;

		beforeAll(async () => {
			await repo.save(placement('a', null, [a]));
			await repo.save(placement('b', a, [a, b]));
			await repo.save(placement('c', b, [a, b, c]));
			await repo.save(placement('d', null, [d], { status: 'disabled' }));
		});

		it('finds by id, path, category and canonical', async () => {
			expect((await repo.findById(`${P}a`))?.parentCategoryId).toBeNull();
			expect(await repo.findById(`${P}none`)).toBeNull();
			expect((await repo.findByPath([a.toLowerCase(), b.toLowerCase()]))?.id).toBe(`${P}b`);
			expect(await repo.findByPath([root])).toBeNull();
			expect(await repo.findByPath([d.toLowerCase()])).toBeNull();
			expect((await repo.findByPath([d.toLowerCase()], 'admin'))?.id).toBe(`${P}d`);
			expect(await repo.listForCategory(b)).toHaveLength(1);
			expect((await repo.findCanonical(b))?.id).toBe(`${P}b`);
			expect(await repo.findCanonical(`${P}none`)).toBeNull();
		});

		it('walks children and subtrees', async () => {
			expect((await repo.listChildren(a)).map((row) => row.id)).toEqual([`${P}b`]);
			expect(await repo.listChildren(`${P}none`, 'admin')).toEqual([]);
			expect((await repo.listSubtree(`${P}b`)).map((row) => row.id)).toEqual([`${P}b`, `${P}c`]);
			expect(await repo.listSubtree(`${P}none`)).toEqual([]);
		});

		it('lists live and retired paths', async () => {
			expect(await repo.listLivePaths()).toContain(a.toLowerCase());
			expect((await repo.listCanonicalLive()).map((row) => row.id)).toContain(`${P}a`);
			expect(await repo.listRetiredPaths()).toContain(d.toLowerCase());
		});

		it('moves a subtree under a new parent and to the root', async () => {
			const moved = await transactions.withTransaction((context) =>
				repo.moveSubtree({ placementId: `${P}c`, newParentCategoryId: a }, context),
			);
			expect(moved[0]).toMatchObject({ pathCategoryIds: [a, c], depth: 1, parentCategoryId: a });
			const toRoot = await repo.moveSubtree({ placementId: `${P}c`, newParentCategoryId: null });
			expect(toRoot[0]).toMatchObject({ pathCategoryIds: [c], depth: 0, parentCategoryId: null });
		});

		it('refuses a cycle, and misses strangers', async () => {
			await expect(repo.moveSubtree({ placementId: `${P}a`, newParentCategoryId: b })).rejects.toThrow('cycle');
			expect(await repo.moveSubtree({ placementId: `${P}none`, newParentCategoryId: null })).toEqual([]);
			expect(await repo.moveSubtree({ placementId: `${P}a`, newParentCategoryId: `${P}none` })).toEqual([]);
		});

		it('skips a descendant that vanished mid-move', async () => {
			const spy = vi.spyOn(CategoryPlacementModel, 'findByIdAndUpdate').mockReturnValue({
				lean: () => ({ exec: async () => null }),
			} as never);
			expect(await repo.moveSubtree({ placementId: `${P}b`, newParentCategoryId: null })).toEqual([]);
			spy.mockRestore();
		});

		it('fills the gaps in a sparse row, keeps dates, and deletes', async () => {
			await insertRaw(CategoryPlacementModel, {
				_id: `${P}sparse`,
				categoryId: `${P}sparse_cat`,
				pathKey: `${P}sparse`,
				status: 'draft',
			});
			expect(await repo.findById(`${P}sparse`)).toMatchObject({
				parentCategoryId: null,
				isCanonical: false,
				displayOrder: 0,
				createdAt: undefined,
			});
			await insertRaw(CategoryPlacementModel, {
				_id: `${P}dated`,
				categoryId: `${P}dated_cat`,
				pathKey: `${P}dated`,
				createdAt: date,
				updatedAt: date,
			});
			expect(await repo.findById(`${P}dated`)).toMatchObject({ createdAt: at, updatedAt: at });
			await repo.deleteById(`${P}dated`);
			expect(await repo.findById(`${P}dated`)).toBeNull();
		});
	});

	describe('category facet configs', () => {
		const repo = new MongoCategoryFacetConfigRepository();
		const config = (name: string, overrides: Record<string, unknown>) =>
			({ id: `${P}${name}`, facets: [], status: 'live', ...overrides }) as never;

		it('resolves the most specific live config first', async () => {
			await repo.save(config('byPlacement', { scope: 'placement', categoryPlacementId: `${P}pl` }));
			await repo.save(config('byCategory', { scope: 'category', categoryId: `${P}ct` }));
			await repo.save(config('byGroup', { scope: 'group', productGroupId: `${P}gp` }));
			expect(
				(
					await repo.resolveFor({
						categoryPlacementId: `${P}pl`,
						categoryId: `${P}ct`,
						productGroupId: `${P}gp`,
					})
				)?.id,
			).toBe(`${P}byPlacement`);
			expect((await repo.resolveFor({ categoryPlacementId: `${P}no`, categoryId: `${P}ct` }))?.id).toBe(
				`${P}byCategory`,
			);
			expect((await repo.resolveFor({ productGroupId: `${P}gp` }))?.id).toBe(`${P}byGroup`);
		});

		it('answers null when nothing matches', async () => {
			const spy = vi.spyOn(CategoryFacetConfigModel, 'findOne').mockReturnValue({
				lean: () => ({ exec: async () => null }),
			} as never);
			expect(await repo.resolveFor({})).toBeNull();
			spy.mockRestore();
		});

		it('finds, reads a sparse row, keeps dates, and deletes', async () => {
			expect((await repo.findById(`${P}byCategory`))?.categoryId).toBe(`${P}ct`);
			expect(await repo.findById(`${P}none`)).toBeNull();
			await insertRaw(CategoryFacetConfigModel, { _id: `${P}sparse`, scope: 'global', categoryId: null });
			expect((await repo.findById(`${P}sparse`))?.categoryId).toBeUndefined();
			await insertRaw(CategoryFacetConfigModel, { _id: `${P}dated`, createdAt: date, updatedAt: date });
			expect(await repo.findById(`${P}dated`)).toMatchObject({ createdAt: at, updatedAt: at });
			await repo.deleteById(`${P}dated`);
			expect(await repo.findById(`${P}dated`)).toBeNull();
		});
	});

	describe('attribute definitions', () => {
		const repo = new MongoAttributeDefinitionRepository();
		const code = `${P}attr`.toLowerCase();

		it('saves, finds, lists and deletes', async () => {
			await repo.save({
				id: `${P}attr`,
				code,
				label: { en: 'A' },
				defaultRole: 'filter_only',
				defaultDisplayStyle: 'dropdown',
				valueType: 'text',
				terms: [],
			} as never);
			expect((await repo.findByCode(code))?.id).toBe(`${P}attr`);
			expect(await repo.findByCode(`${P}none`)).toBeNull();
			expect((await repo.listAll()).map((row) => row.code)).toContain(code);
			await insertRaw(AttributeDefinitionModel, { _id: `${P}sparse`, code: `${P}sparse` });
			expect((await repo.findByCode(`${P}sparse`))?.terms).toEqual([]);
			await insertRaw(AttributeDefinitionModel, {
				_id: `${P}dated`,
				code: `${P}dated`,
				terms: [{ code: 't' }],
				createdAt: date,
				updatedAt: date,
			});
			expect(await repo.findByCode(`${P}dated`)).toMatchObject({ createdAt: at, updatedAt: at });
			await repo.deleteByCode(code);
			expect(await repo.findByCode(code)).toBeNull();
		});
	});

	describe('product variants', () => {
		const repo = new MongoProductVariantRepository();
		const productId = `${P}vprod`;
		const variant = (name: string, overrides: Record<string, unknown> = {}) =>
			({
				id: `${P}${name}`,
				productId,
				sku: `${P}${name}`,
				status: 'live',
				optionSelections: [],
				optionSelectionHash: `${P}${name}_hash`,
				isBaseVariant: true,
				priceINR: 100,
				compareAtPriceINR: 200,
				salePriceINR: 90,
				saleWindow: { startsAt: past, endsAt: future },
				stock: { tracked: true, quantity: 5, lowStockThreshold: 1, allowBackorder: false },
				barcode: 'b',
				...overrides,
			}) as never;

		beforeAll(async () => {
			await repo.save(variant('v1'));
			await transactions.withTransaction((context) =>
				repo.saveMany(
					[
						variant('v2', { status: 'draft' }),
						variant('v3', {
							stock: { tracked: true, quantity: 0, lowStockThreshold: null, allowBackorder: false },
						}),
					],
					context,
				),
			);
		});

		it('finds with the audience applied', async () => {
			expect(await repo.findById(`${P}v1`)).toMatchObject({
				compareAtPriceINR: 200,
				salePriceINR: 90,
				barcode: 'b',
				saleWindow: { startsAt: past, endsAt: future },
			});
			expect(await repo.findById(`${P}v2`)).toBeNull();
			expect((await repo.findById(`${P}v2`, 'admin'))?.status).toBe('draft');
			expect((await repo.findBySku(`${P}v1`))?.id).toBe(`${P}v1`);
			expect(await repo.findBySku(`${P}v2`)).toBeNull();
			expect((await repo.findByOptionSelectionHash(productId, `${P}v1_hash`))?.id).toBe(`${P}v1`);
			expect(await repo.findByOptionSelectionHash(productId, 'none')).toBeNull();
		});

		it('lists one product, several, and pages', async () => {
			expect(await repo.listForProduct(productId)).toHaveLength(2);
			expect(await repo.listForProduct(productId, 'admin')).toHaveLength(3);
			expect(await repo.listForProducts([productId])).toHaveLength(2);
			expect(await repo.listForProducts([productId], 'admin')).toHaveLength(3);
			expect(await repo.list({ productId } as never)).toMatchObject({ total: 2, page: 1, pageSize: 20 });
			expect(await repo.list({ productId, purchasableOnly: true, page: 1, pageSize: 5 } as never)).toMatchObject({
				total: 1,
				pageSize: 5,
			});
			expect(Array.isArray((await repo.list({ pageSize: 1 } as never)).items)).toBe(true);
		});

		it('reads a window with open ends, and fills the gaps', async () => {
			await repo.save(variant('v4', { saleWindow: { startsAt: null, endsAt: null } }));
			expect((await repo.findById(`${P}v4`))?.saleWindow).toEqual({ startsAt: null, endsAt: null });
			await insertRaw(ProductVariantModel, {
				_id: `${P}sparse`,
				sku: `${P}sparse`,
				optionSelectionHash: `${P}sparse`,
				status: 'live',
				productId: `${P}other`,
			});
			expect(await repo.findById(`${P}sparse`)).toMatchObject({
				optionSelections: [],
				isBaseVariant: false,
				compareAtPriceINR: null,
				salePriceINR: null,
				saleWindow: undefined,
				stock: { tracked: true, quantity: 0 },
				barcode: null,
				createdAt: undefined,
			});
			await insertRaw(ProductVariantModel, {
				_id: `${P}dated`,
				sku: `${P}dated`,
				optionSelectionHash: `${P}dated`,
				status: 'live',
				productId: `${P}other`,
				optionSelections: ['x'],
				createdAt: date,
				updatedAt: date,
			});
			expect(await repo.findById(`${P}dated`)).toMatchObject({ createdAt: at, updatedAt: at });
		});

		it('deletes', async () => {
			await repo.deleteById(`${P}v4`);
			expect(await repo.findById(`${P}v4`)).toBeNull();
		});
	});

	describe('product bundles', () => {
		const repo = new MongoProductBundleRepository();

		it('saves, finds, knows a bundle, and deletes', async () => {
			const bundle = {
				id: `${P}bun`,
				productId: `${P}bprod`,
				bundleType: 'fixed_kit',
				pricePolicy: 'fixed_bundle_price',
				fixedPriceINR: 100,
				groups: [],
				status: 'draft',
			} as never;
			await repo.save(bundle);
			expect(await repo.findByProductId(`${P}bprod`)).toBeNull();
			expect((await repo.findByProductId(`${P}bprod`, 'admin'))?.fixedPriceINR).toBe(100);
			expect(await repo.isBundleProduct(`${P}bprod`)).toBe(true);
			expect(await repo.isBundleProduct(`${P}none`)).toBe(false);
			await repo.deleteById(`${P}bun`);
			expect(await repo.isBundleProduct(`${P}bprod`)).toBe(false);
		});

		it('fills the gaps, and keeps dates', async () => {
			await insertRaw(ProductBundleModel, { _id: `${P}sparse`, productId: `${P}sparse`, status: 'live' });
			expect(await repo.findByProductId(`${P}sparse`)).toMatchObject({
				fixedPriceINR: null,
				createdAt: undefined,
			});
			await insertRaw(ProductBundleModel, {
				_id: `${P}dated`,
				productId: `${P}dated`,
				status: 'live',
				createdAt: date,
				updatedAt: date,
			});
			expect(await repo.findByProductId(`${P}dated`)).toMatchObject({ createdAt: at, updatedAt: at });
		});
	});

	describe('product relations', () => {
		const repo = new MongoProductRelationRepository();
		const source = `${P}rsrc`;
		const relation = (name: string, overrides: Record<string, unknown> = {}) =>
			({
				id: `${P}${name}`,
				sourceProductId: source,
				relationType: 'related',
				targetType: 'product',
				targetId: `${P}target_${name}`,
				surfaces: ['pdp'],
				rank: 1,
				source: 'manual',
				insightSetId: 'set',
				reason: 'why',
				startsAt: null,
				endsAt: null,
				status: 'live',
				...overrides,
			}) as never;

		it('lists what is live and inside its window', async () => {
			await repo.save(relation('r1'));
			await repo.save(relation('r2', { startsAt: future }));
			await repo.save(relation('r3', { relationType: 'upsell', surfaces: ['cart'] }));
			const rows = await repo.listForProduct({ sourceProductId: source } as never);
			expect(rows.map((row) => row.id).sort()).toEqual([`${P}r1`, `${P}r3`]);
			expect(rows[0]).toMatchObject({ insightSetId: 'set', reason: 'why' });
			expect(
				await repo.listForProduct({
					sourceProductId: source,
					relationType: 'upsell',
					surface: 'cart',
					pageSize: 1,
				} as never),
			).toHaveLength(1);
			expect(Array.isArray(await repo.listForProduct({} as never))).toBe(true);
		});

		it('replaces an insight set, or clears it', async () => {
			const insight = (name: string, overrides: Record<string, unknown> = {}) =>
				relation(name, { source: 'insight_set', relationType: 'bought_together', ...overrides });
			const count = await transactions.withTransaction((context) =>
				repo.replaceFromInsightSet(
					{
						insightSetId: 's',
						relations: [insight('i1'), insight('i2', { startsAt: past, endsAt: future })],
					},
					context,
				),
			);
			expect(count).toBe(2);
			const rows = await repo.listForProduct({
				sourceProductId: source,
				relationType: 'bought_together',
			} as never);
			expect(rows.find((row) => row.id === `${P}i2`)).toMatchObject({ startsAt: past, endsAt: future });
			expect(await repo.replaceFromInsightSet({ insightSetId: 's', relations: [] })).toBe(0);
		});

		it('disables for a target, fills gaps, and deletes', async () => {
			await repo.save(relation('r4', { targetId: `${P}gone` }));
			expect(await repo.disableForTarget(`${P}gone`)).toBe(1);
			await insertRaw(ProductRelationModel, {
				_id: `${P}sparse`,
				sourceProductId: `${P}sparse`,
				status: 'live',
				startsAt: null,
				endsAt: null,
			});
			expect((await repo.listForProduct({ sourceProductId: `${P}sparse` } as never))[0]).toMatchObject({
				rank: 0,
				insightSetId: null,
				reason: null,
				startsAt: null,
				endsAt: null,
				createdAt: undefined,
			});
			await insertRaw(ProductRelationModel, {
				_id: `${P}dated`,
				sourceProductId: `${P}dated`,
				status: 'live',
				startsAt: null,
				endsAt: null,
				createdAt: date,
				updatedAt: date,
			});
			expect((await repo.listForProduct({ sourceProductId: `${P}dated` } as never))[0]).toMatchObject({
				createdAt: at,
				updatedAt: at,
			});
			await repo.deleteById(`${P}dated`);
			expect(await repo.listForProduct({ sourceProductId: `${P}dated` } as never)).toEqual([]);
		});
	});

	describe('inventory', () => {
		const repo = new MongoInventoryRepository();
		const variantId = `${P}inv`;
		const movement = (quantityDelta: number, overrides: Record<string, unknown> = {}) =>
			({
				variantId,
				productId: `${P}invprod`,
				quantityDelta,
				source: 'manual_adjustment',
				createdAt: at,
				...overrides,
			}) as never;

		beforeAll(async () => {
			await insertRaw(ProductVariantModel, {
				_id: variantId,
				sku: variantId,
				optionSelectionHash: variantId,
				productId: `${P}invprod`,
				status: 'live',
				stock: { tracked: true, quantity: 3, lowStockThreshold: 1, allowBackorder: false },
			});
			await insertRaw(ProductVariantModel, {
				_id: `${P}nostock`,
				sku: `${P}nostock`,
				optionSelectionHash: `${P}nostock`,
				productId: `${P}invprod`,
				status: 'live',
			});
		});

		it('reads snapshots', async () => {
			expect(await repo.getSnapshot(variantId)).toMatchObject({ onHand: 3, available: 3, lowStockThreshold: 1 });
			expect(await repo.getSnapshot(`${P}nostock`)).toMatchObject({
				onHand: 0,
				available: 0,
				lowStockThreshold: null,
			});
			expect(await repo.getSnapshot(`${P}none`)).toBeNull();
			const rows = await repo.getSnapshots([variantId, `${P}nostock`]);
			expect(rows.map((row) => row.onHand).sort()).toEqual([0, 3]);
			expect(rows.find((row) => row.variantId === `${P}nostock`)?.lowStockThreshold).toBeNull();
		});

		it('moves stock in and out, and refuses to oversell', async () => {
			const added = await repo.applyDelta(
				movement(2, {
					reasonCode: 'damage',
					note: 'n',
					referenceType: 't',
					referenceId: 'r',
					actorUserId: 'a',
				}),
			);
			expect(added).toMatchObject({ balanceAfter: 5, reasonCode: 'damage', note: 'n', actorUserId: 'a' });
			const taken = await transactions.withTransaction((context) => repo.applyDelta(movement(-1), context));
			expect(taken).toMatchObject({
				balanceAfter: 4,
				reasonCode: null,
				note: null,
				referenceType: null,
				referenceId: null,
				actorUserId: null,
			});
			await expect(repo.applyDelta(movement(-99))).rejects.toBeInstanceOf(InsufficientStockError);
		});

		it('lists the ledger with every filter', async () => {
			expect(await repo.listLedger({ variantId } as never)).toMatchObject({ total: 2, page: 1, pageSize: 20 });
			expect(
				(
					await repo.listLedger({
						productId: `${P}invprod`,
						source: 'manual_adjustment',
						page: 1,
						pageSize: 1,
					} as never)
				).items,
			).toHaveLength(1);
			expect((await repo.listLedger({ variantId, from: past } as never)).total).toBe(2);
			expect((await repo.listLedger({ variantId, to: past } as never)).total).toBe(0);
			expect((await repo.listLedger({ variantId, from: past, to: future } as never)).total).toBe(2);
			expect(Array.isArray((await repo.listLedger({ pageSize: 1 } as never)).items)).toBe(true);
		});
	});

	describe('inventory cost layers', () => {
		const repo = new MongoInventoryCostLayerRepository();
		const variantId = `${P}fifo`;
		const layer = (name: string, overrides: Record<string, unknown> = {}) =>
			({
				id: `${P}${name}`,
				variantId,
				purchaseInvoiceId: 'inv',
				unitCostINR: 10,
				quantityReceived: 2,
				quantityRemaining: 2,
				receivedAt: at,
				...overrides,
			}) as never;

		it('creates layers and lists the open ones', async () => {
			await repo.createLayer(layer('l1', { receivedAt: past, createdAt: at }));
			await transactions.withTransaction((context) =>
				repo.createLayer(layer('l2', { purchaseInvoiceId: null }), context),
			);
			const open = await repo.listOpenLayers(variantId);
			expect(open.map((row) => row.id)).toEqual([`${P}l1`, `${P}l2`]);
			expect(open[0]).toMatchObject({ purchaseInvoiceId: 'inv', createdAt: at });
			expect(open[1]?.purchaseInvoiceId).toBeNull();
		});

		it('reads a layer with no date', async () => {
			await insertRaw(InventoryCostLayerModel, {
				_id: `${P}undated`,
				variantId: `${P}undated_v`,
				quantityRemaining: 1,
				receivedAt: date,
			});
			expect((await repo.listOpenLayers(`${P}undated_v`))[0]).toMatchObject({
				createdAt: undefined,
				purchaseInvoiceId: null,
			});
		});

		it('draws oldest first and puts stock back', async () => {
			expect(await repo.consumeFifo({ variantId, quantity: 0 })).toEqual([]);
			const allocations = await transactions.withTransaction((context) =>
				repo.consumeFifo({ variantId, quantity: 3 }, context),
			);
			expect(allocations).toEqual([
				{ layerId: `${P}l1`, quantity: 2, unitCostINR: 10 },
				{ layerId: `${P}l2`, quantity: 1, unitCostINR: 10 },
			]);
			await repo.releaseFifo({ variantId, allocations });
			expect((await repo.listOpenLayers(variantId)).map((row) => row.quantityRemaining)).toEqual([2, 2]);
		});

		it('stops once it has enough', async () => {
			expect(await repo.consumeFifo({ variantId, quantity: 1 })).toEqual([
				{ layerId: `${P}l1`, quantity: 1, unitCostINR: 10 },
			]);
		});

		it('refuses to cost more than exists', async () => {
			await expect(repo.consumeFifo({ variantId, quantity: 99 })).rejects.toThrow(
				'insufficient FIFO cost layers',
			);
		});

		it('moves on from a layer someone else drew first', async () => {
			await repo.createLayer(layer('l3', { variantId: `${P}raced`, quantityRemaining: 1 }));
			const spy = vi.spyOn(InventoryCostLayerModel, 'findOneAndUpdate').mockReturnValue({
				lean: () => ({ exec: async () => null }),
			} as never);
			await expect(repo.consumeFifo({ variantId: `${P}raced`, quantity: 1 })).rejects.toThrow('uncosted');
			spy.mockRestore();
		});
	});
});
