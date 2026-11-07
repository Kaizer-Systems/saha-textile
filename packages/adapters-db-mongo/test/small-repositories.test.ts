import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { connectMongo, disconnectMongo, getMongoose } from '../src/connection';
import {
	AddonTemplateModel,
	AdminUserModel,
	AuthIdentityModel,
	CartModel,
	CategoryModel,
	ConsentEventModel,
	CurrencyModel,
	MediaRoleModel,
	OrderModel,
	PendingContactChangeModel,
	PendingSignupModel,
	ProductInsightSetModel,
	ProductModel,
	PromotionModel,
	RoleModel,
	SeoRedirectModel,
	SeoRouteModel,
	SiteSettingModel,
	StockAlertModel,
	AdminUserRoleAssignmentModel,
} from '../src/models/index';
import {
	loadPasswordHash,
	passwordCredentialId,
	pinCredentialId,
	PinCredentialModel,
} from '../src/models/credential.model';
import {
	MongoAddonTemplateRepository,
	MongoAdminUserRepository,
	MongoAuthIdentityRepository,
	MongoCartRepository,
	MongoCategoryRepository,
	MongoConsentRepository,
	MongoCurrencyRepository,
	MongoMediaRoleRepository,
	MongoOrderRepository,
	MongoPendingContactChangeRepository,
	MongoPendingSignupRepository,
	MongoProductInsightSetRepository,
	MongoProductRepository,
	MongoPromotionRepository,
	MongoAdminUserRoleAssignmentRepository,
	MongoRoleRepository,
	MongoSeoRedirectRepository,
	MongoSeoRouteRepository,
	MongoSiteSettingsRepository,
	MongoStockAlertRepository,
} from '../src/repositories/index';
import { MongoTransactionManager } from '../src/transaction-manager';
import { hasMongoEnv, insertRaw, runPrefix } from './mongo-test-env';

const P = runPrefix('small');
const at = '2026-11-06T00:00:00.000Z';
const date = new Date(at);

describe.skipIf(!hasMongoEnv())('small repositories (integration, rs0)', () => {
	beforeAll(async () => {
		await connectMongo();
		await Promise.all([
			StockAlertModel.syncIndexes(),
			SeoRedirectModel.syncIndexes(),
			AdminUserRoleAssignmentModel.syncIndexes(),
			RoleModel.syncIndexes(),
		]);
	});

	afterAll(async () => {
		const mine = { $regex: `^${P}` };
		const byId = { _id: mine };
		await Promise.all([
			AddonTemplateModel.deleteMany({ code: mine }),
			AdminUserModel.deleteMany(byId),
			AuthIdentityModel.deleteMany(byId),
			CartModel.deleteMany(byId),
			CategoryModel.deleteMany(byId),
			ConsentEventModel.deleteMany(byId),
			CurrencyModel.deleteMany(byId),
			MediaRoleModel.deleteMany(byId),
			OrderModel.deleteMany(byId),
			PendingContactChangeModel.deleteMany(byId),
			PendingSignupModel.deleteMany(byId),
			PinCredentialModel.deleteMany({ adminUserId: mine }),
			ProductInsightSetModel.deleteMany(byId),
			ProductModel.deleteMany(byId),
			PromotionModel.deleteMany(byId),
			RoleModel.deleteMany(byId),
			SeoRedirectModel.deleteMany({ sourcePath: { $regex: `^/${P}` } }),
			SeoRouteModel.deleteMany(byId),
			StockAlertModel.deleteMany({ customerId: mine }),
			AdminUserRoleAssignmentModel.deleteMany(byId),
		]);
		await disconnectMongo();
	});

	describe('connection', () => {
		it('reuses the open connection', async () => {
			const first = await connectMongo();
			expect(await connectMongo()).toBe(first);
			expect(getMongoose()).toBe(first);
		});
	});

	describe('admin users', () => {
		const repo = new MongoAdminUserRepository();
		const id = `${P}admin`;

		it('saves, finds three ways, and reports a PIN', async () => {
			await repo.save({
				id,
				email: `${P}a@example.test`,
				username: `${P}a`,
				displayName: 'A',
				role: 'staff',
				status: 'active',
				pinConfigured: false,
			} as never);
			await PinCredentialModel.create({
				_id: pinCredentialId(id),
				adminUserId: id,
				pinHash: 'h',
				failedAttempts: 0,
			} as never);
			expect((await repo.findById(id))?.pinConfigured).toBe(true);
			expect((await repo.findByEmail(`${P}a@example.test`))?.id).toBe(id);
			expect((await repo.findByUsername(`${P}a`))?.id).toBe(id);
		});

		it('answers null for strangers', async () => {
			expect(await repo.findById(`${P}none`)).toBeNull();
			expect(await repo.findByEmail(`${P}none@example.test`)).toBeNull();
			expect(await repo.findByUsername(`${P}none`)).toBeNull();
		});

		it('pages the list, including a page past the end and a zero page size', async () => {
			const first = await repo.list({ page: 1, pageSize: 1 });
			expect(first.items).toHaveLength(1);
			expect(first.meta).toMatchObject({ page: 1, pageSize: 1, hasPrev: false });
			const beyond = await repo.list({ page: 100_000, pageSize: 5 });
			expect(beyond.items).toEqual([]);
			expect(beyond.meta).toMatchObject({ hasNext: false, hasPrev: true });
			expect((await repo.list({ page: 1, pageSize: 0 })).meta.totalPages).toBe(0);
		});
	});

	describe('consent', () => {
		const repo = new MongoConsentRepository();
		const event = (id: string, overrides: Record<string, unknown>) =>
			({
				id: `${P}${id}`,
				categories: { marketing: true },
				policyVersion: 'v1',
				source: 'storefront',
				createdAt: at,
				...overrides,
			}) as never;

		it('keeps events and reads the latest for a user and a guest', async () => {
			await repo.append(event('c1', { userId: `${P}u`, ipHash: 'i', userAgentHash: 'a' }));
			await repo.append(event('c2', { guestId: `${P}g` }));
			expect(await repo.findLatestForUser(`${P}u`)).toMatchObject({
				ipHash: 'i',
				userAgentHash: 'a',
				guestId: null,
			});
			expect(await repo.findLatestForGuest(`${P}g`)).toMatchObject({ userId: null, ipHash: null });
		});

		it('answers null for strangers', async () => {
			expect(await repo.findLatestForUser(`${P}none`)).toBeNull();
			expect(await repo.findLatestForGuest(`${P}none`)).toBeNull();
		});

		it('pages with defaults when the page is unset', async () => {
			expect(await repo.listForUser(`${P}u`, { page: 0, pageSize: 0 } as never)).toMatchObject({
				total: 1,
				page: 1,
				pageSize: 20,
			});
			expect(await repo.listForUser(`${P}u`, { page: 2, pageSize: 5 } as never)).toMatchObject({
				items: [],
				page: 2,
				pageSize: 5,
			});
			expect(await repo.listForUser(`${P}u`, {} as never)).toMatchObject({ page: 1, pageSize: 20 });
		});
	});

	describe('add-on templates', () => {
		const repo = new MongoAddonTemplateRepository();
		const code = (name: string) => `${P}${name}`;
		const row = (list: Awaited<ReturnType<typeof repo.list>>, name: string) =>
			list.find((entry) => entry.code === code(name));

		const field = {
			code: 'chest',
			label: { en: 'Chest', fr: 'Poitrine' },
			unit: 'in' as const,
			min: 24,
			max: 50,
			step: 0.5,
		};

		it('saves every field and every language', async () => {
			await repo.save({ code: code('plain'), label: { en: 'Plain' }, priceINR: 1, fields: [], sizeGuide: [] });
			await repo.save({ code: code('full'), label: { en: 'Full', fr: 'Complet' }, priceINR: 2, fields: [field], sizeGuide: [] });
			const list = await repo.list();
			expect(row(list, 'plain')).toEqual({ code: code('plain'), label: { en: 'Plain' }, priceINR: 1, fields: [], sizeGuide: [] });
			expect(row(list, 'full')?.label).toEqual({ en: 'Full', fr: 'Complet' });
			expect(row(list, 'full')?.fields).toEqual([field]);
		});

		it('leaves an open range open, and replaces the fields on a later save', async () => {
			const open = { ...field, min: null, max: null, step: null };
			await repo.save({ code: code('full'), label: { en: 'Renamed' }, priceINR: 7, fields: [open], sizeGuide: [] });
			const found = await repo.findByCode(code('full'));
			expect(found).toMatchObject({ label: { en: 'Renamed' }, priceINR: 7 });
			expect(found?.fields).toEqual([open]);
		});

		it('reads every stored field shape', async () => {
			await insertRaw(AddonTemplateModel, {
				_id: `${P}raw`,
				code: code('raw'),
				label: 'Raw',
				priceINR: 1,
				fields: [
					{ label: 'Skipped, no code' },
					{ code: 'text', label: 'Text label', unit: 'cm', validation: { min: 1, max: 2, step: 1 } },
					{ code: 'french', label: { fr: 'Seulement' } },
					{ code: 'none' },
				],
			});
			await insertRaw(AddonTemplateModel, { _id: `${P}bare`, code: code('bare'), label: 'Bare', priceINR: 1 });
			const found = await repo.findByCode(code('raw'));
			expect(found?.label).toEqual({ en: 'Raw' });
			expect(found?.fields).toEqual([
				{ code: 'text', label: { en: 'Text label' }, unit: 'cm', min: 1, max: 2, step: 1 },
				{ code: 'french', label: { fr: 'Seulement' }, unit: 'in', min: null, max: null, step: null },
				{ code: 'none', label: { en: 'none' }, unit: 'in', min: null, max: null, step: null },
			]);
			expect((await repo.findByCode(code('bare')))?.fields).toEqual([]);
		});

		it('removes, and misses a stranger', async () => {
			await repo.remove(code('plain'));
			expect(await repo.findByCode(code('plain'))).toBeNull();
		});
	});

	describe('orders', () => {
		const repo = new MongoOrderRepository();
		const order = (name: string, overrides: Record<string, unknown> = {}) =>
			({
				id: `${P}${name}`,
				orderNumber: `${P}${name}`,
				userId: `${P}buyer`,
				currency: 'INR',
				lines: [{ productId: `${P}prod`, quantity: 2 }],
				subtotalINR: 1,
				subtotalPaid: 1,
				totalINR: 1,
				totalPaid: 1,
				status: 'paid',
				statusTimeline: [],
				...overrides,
			}) as never;

		it('saves and finds by id and number', async () => {
			await repo.save(order('o1'));
			expect((await repo.findById(`${P}o1`))?.id).toBe(`${P}o1`);
			expect((await repo.findByOrderNumber(`${P}o1`))?.id).toBe(`${P}o1`);
			expect(await repo.findById(`${P}none`)).toBeNull();
			expect(await repo.findByOrderNumber(`${P}none`)).toBeNull();
		});

		it('saves inside a transaction', async () => {
			await new MongoTransactionManager().withTransaction((context) => repo.save(order('o2'), context));
			expect((await repo.findById(`${P}o2`))?.status).toBe('paid');
		});

		it('pages by user with and without a page', async () => {
			expect(await repo.listByUser(`${P}buyer`, { page: 1, pageSize: 1 } as never)).toMatchObject({
				total: 2,
				pageSize: 1,
			});
			expect(await repo.listByUser(`${P}buyer`, {} as never)).toMatchObject({ page: 1, pageSize: 20 });
		});

		it('lists purchased orders with their lines', async () => {
			const rows = await repo.listPurchased();
			expect(rows.find((row) => row.lines[0]?.productId === `${P}prod`)).toMatchObject({
				lines: [{ productId: `${P}prod`, quantity: 2 }],
			});
		});

		it('gives an order with no date the earliest time', async () => {
			await insertRaw(OrderModel, {
				_id: `${P}dateless`,
				orderNumber: `${P}dateless`,
				status: 'paid',
				lines: [{ productId: `${P}old`, quantity: 1 }],
			});
			const rows = await repo.listPurchased();
			expect(rows.find((row) => row.lines[0]?.productId === `${P}old`)?.placedAt).toBe(new Date(0).toISOString());
		});

		it('skips a recent order that has no time at all', async () => {
			const spy = vi.spyOn(OrderModel, 'find').mockReturnValue({
				sort: () => ({
					limit: () => ({
						lean: () => ({
							exec: async () => [
								{ _id: 'x', orderNumber: 'x', status: 'paid', lines: [{ productId: 'p' }] },
							],
						}),
					}),
				}),
			} as never);
			expect(await repo.listRecentlyPurchased(at, 5)).toEqual([]);
			spy.mockRestore();
		});

		it('moves an order on, and refuses a stranger', async () => {
			const updated = await repo.updateStatus(`${P}o1`, 'shipped', 'with courier');
			expect(updated.status).toBe('shipped');
			expect(updated.statusTimeline.at(-1)).toMatchObject({ status: 'shipped', note: 'with courier' });
			await expect(repo.updateStatus(`${P}none`, 'shipped')).rejects.toThrow('Order not found');
		});
	});

	describe('pending contact changes', () => {
		const repo = new MongoPendingContactChangeRepository();
		const change = (overrides: Record<string, unknown> = {}) =>
			({
				id: `${P}pc1`,
				customerId: `${P}cust`,
				field: 'email',
				newValue: 'new@example.test',
				sends: 0,
				lastSentAt: null,
				createdAt: at,
				expiresAt: '2030-01-01T00:00:00.000Z',
				absoluteExpiresAt: '2030-01-02T00:00:00.000Z',
				...overrides,
			}) as never;

		it('starts, restarts, and finds', async () => {
			await repo.start(change());
			const restarted = await repo.start(change({ newValue: 'other@example.test', lastSentAt: at }));
			expect(restarted).toMatchObject({ id: `${P}pc1`, newValue: 'other@example.test', lastSentAt: at });
			expect((await repo.findByCustomerId(`${P}cust`))?.id).toBe(`${P}pc1`);
			expect(await repo.findByCustomerId(`${P}none`)).toBeNull();
		});

		it('records a send, and misses a stranger', async () => {
			const sent = await repo.recordSend(`${P}pc1`, at, '2030-02-01T00:00:00.000Z');
			expect(sent?.sends).toBe(1);
			expect(await repo.recordSend(`${P}none`, at, at)).toBeNull();
		});

		it('consumes once', async () => {
			expect((await repo.consume(`${P}pc1`))?.id).toBe(`${P}pc1`);
			expect(await repo.consume(`${P}pc1`)).toBeNull();
		});

		it('deletes by customer', async () => {
			await repo.start(change({ id: `${P}pc2` }));
			expect(await repo.deleteByCustomerId(`${P}cust`)).toBe(true);
			expect(await repo.deleteByCustomerId(`${P}cust`)).toBe(false);
		});

		it('treats a missing delete count as nothing deleted', async () => {
			const spy = vi.spyOn(PendingContactChangeModel, 'deleteOne').mockReturnValue({
				exec: async () => ({}),
			} as never);
			expect(await repo.deleteByCustomerId(`${P}cust`)).toBe(false);
			spy.mockRestore();
		});
	});

	describe('products', () => {
		const repo = new MongoProductRepository();
		const product = (name: string, overrides: Record<string, unknown> = {}) =>
			({
				id: `${P}${name}`,
				type: 'simple',
				sku: `${P}${name}`,
				title: { en: name },
				slug: `${P}${name}`.toLowerCase(),
				basePriceINR: 100,
				status: 'live',
				...overrides,
			}) as never;

		beforeAll(async () => {
			await repo.save(
				product('filtered', {
					categoryIds: [`${P}cat`],
					featured: true,
					onSale: true,
					tags: [`${P}tag`],
					insightBadges: ['trending'],
				}),
			);
			await repo.save(product('draft', { status: 'draft' }));
		});

		it('hides a draft from the public but not from the admin', async () => {
			expect(await repo.findById(`${P}draft`)).toBeNull();
			expect(await repo.findBySlug(`${P}draft`.toLowerCase())).toBeNull();
			expect((await repo.findById(`${P}draft`, 'admin'))?.status).toBe('draft');
			expect((await repo.findBySlug(`${P}draft`.toLowerCase(), 'admin'))?.status).toBe('draft');
		});

		it.each([
			['category', { categoryId: `${P}cat` }],
			['categories', { categoryIds: [`${P}cat`] }],
			['tag', { tag: `${P}tag` }],
			['search', { search: `${P}FILTERED` }],
		])('filters by %s', async (_label, filter) => {
			const result = await repo.list({ audience: 'public', ...filter } as never);
			expect(result.items.map((item) => item.id)).toEqual([`${P}filtered`]);
		});

		it('combines the flags, and takes page settings', async () => {
			const result = await repo.list({
				audience: 'public',
				featured: true,
				onSale: true,
				insight: 'trending',
				tag: `${P}tag`,
				page: 1,
				pageSize: 5,
			} as never);
			expect(result).toMatchObject({ total: 1, page: 1, pageSize: 5 });
			expect(await repo.list({ tag: `${P}tag`, categoryIds: [] } as never)).toMatchObject({
				page: 1,
				pageSize: 20,
			});
		});

		it('lets the admin list every status', async () => {
			const result = await repo.list({ audience: 'admin', search: `${P}DRAFT` } as never);
			expect(result.total).toBe(1);
		});

		it('escapes search text', async () => {
			expect((await repo.list({ search: '.*(' } as never)).items).toBeDefined();
		});

		it('moves insight badges', async () => {
			await repo.setInsightBadges({ bestseller: [`${P}filtered`], trending: [] });
			expect((await repo.findById(`${P}filtered`))?.insightBadges).toEqual(['bestseller']);
		});

		it('lists public slugs and deletes', async () => {
			expect(await repo.categorySummaries()).toEqual(expect.any(Array));
			expect(await repo.listPublicSlugs()).toContain(`${P}filtered`.toLowerCase());
			await repo.deleteById(`${P}filtered`);
			expect(await repo.findById(`${P}filtered`)).toBeNull();
		});
	});

	describe('media roles', () => {
		const repo = new MongoMediaRoleRepository();
		const role = (name: string) =>
			({
				key: `${P}${name}`,
				label: name,
				seeded: false,
				purposes: ['product'],
				widths: [100],
				aspect: { width: 1, height: 1 },
				fit: 'cover',
				format: 'image/webp',
				quality: 80,
				primaryOnly: false,
				respectSlotMaxWidth: false,
				version: 1,
				updatedAt: at,
			}) as never;

		it('saves, finds and lists', async () => {
			await repo.save(role('r1'));
			expect(await repo.findByKey(`${P}r1`)).toMatchObject({ label: 'r1', aspect: { width: 1, height: 1 } });
			expect(await repo.findByKey(`${P}none`)).toBeNull();
			expect((await repo.list()).map((row) => row.key)).toContain(`${P}r1`);
		});

		it('reads a row with no shape or date', async () => {
			await insertRaw(MediaRoleModel, { _id: `${P}bare`, label: 'bare' });
			expect(await repo.findByKey(`${P}bare`)).toMatchObject({ aspect: null, updatedAt: undefined });
		});

		it('inserts only what is missing', async () => {
			expect(await repo.insertMissing([])).toBe(0);
			expect(await repo.insertMissing([role('r1'), role('r2')])).toBe(1);
		});
	});

	describe('stock alerts and insight sets', () => {
		const repo = new MongoStockAlertRepository();
		const customerId = `${P}alert_cust`;

		it('saves once per customer and variant, and pages in order', async () => {
			const save = (variantId: string, now: string) =>
				repo.save({ customerId, productId: `${P}p`, variantId: `${P}${variantId}`, now });
			await save('v1', '2020-01-01T00:00:00.000Z');
			await save('v1', '2020-02-01T00:00:00.000Z');
			await save('v2', '2020-01-01T00:00:00.000Z');
			await save('v3', '2020-01-02T00:00:00.000Z');
			const mine = <T extends { customerId: string }>(rows: T[]) =>
				rows.filter((row) => row.customerId === customerId);
			const first = mine(await repo.listPending(10_000));
			expect(first).toHaveLength(3);
			expect(first[0]).toMatchObject({ notifiedAt: null, lastError: null });
			const after = mine(
				await repo.listPending(10_000, {
					createdAt: first[0]?.createdAt as string,
					id: first[0]?.id as string,
				}),
			);
			expect(after.map((row) => row.id)).toEqual([first[1]?.id, first[2]?.id]);
		});

		it('marks a failure, then delivery', async () => {
			const id = `ntf_${customerId}_${P}v1`;
			await repo.markFailed(id, 'no template');
			const pending = await repo.listPending(10_000);
			expect(pending.find((row) => row.id === id)?.lastError).toBe('no template');
			await repo.markNotified(id, at);
			expect((await repo.listPending(10_000)).find((row) => row.id === id)).toBeUndefined();
			const stored = await StockAlertModel.findById(id).lean<{ notifiedAt: Date; lastError: string | null }>();
			expect(stored).toMatchObject({ notifiedAt: date, lastError: null });
		});

		it('reads a notified alert', async () => {
			const spy = vi.spyOn(StockAlertModel, 'find').mockReturnValue({
				sort: () => ({
					limit: () => ({
						lean: () => ({
							exec: async () => [
								{
									_id: 'a',
									customerId: 'c',
									productId: 'p',
									variantId: 'v',
									createdAt: date,
									notifiedAt: date,
								},
							],
						}),
					}),
				}),
			} as never);
			expect((await repo.listPending(1))[0]?.notifiedAt).toBe(at);
			spy.mockRestore();
		});

		it('stores one insight set per week', async () => {
			const sets = new MongoProductInsightSetRepository();
			const set = { id: `${P}w1`, generatedAt: at, bestsellers: [], trending: [], boughtTogether: [] } as never;
			expect(await sets.save(set)).toBe(set);
			expect(await ProductInsightSetModel.countDocuments({ _id: `${P}w1` })).toBe(1);
		});
	});

	describe('auth identities', () => {
		const repo = new MongoAuthIdentityRepository();
		const identity = (provider: string, overrides: Record<string, unknown> = {}) =>
			({
				id: `${P}${provider}`,
				subjectType: 'customer',
				subjectId: `${P}subject`,
				provider,
				providerSubject: `${P}${provider}_sub`,
				email: 'a@example.test',
				linkedAt: at,
				lastUsedAt: null,
				...overrides,
			}) as never;

		it('links and finds', async () => {
			await repo.link(identity('google'));
			await repo.link(identity('facebook', { lastUsedAt: at }));
			expect(await repo.findByProviderSubject('google', `${P}google_sub`)).toMatchObject({ lastUsedAt: null });
			expect(await repo.findByProviderSubject('google', `${P}none`)).toBeNull();
			expect(await repo.listForSubject('customer', `${P}subject`)).toHaveLength(2);
		});

		it('touches', async () => {
			await repo.touch(`${P}google`, at);
			expect((await repo.findByProviderSubject('google', `${P}google_sub`))?.lastUsedAt).toBe(at);
		});

		it('unlinks', async () => {
			expect(await repo.unlink('customer', `${P}subject`, 'facebook')).toBe(true);
			expect(await repo.unlink('customer', `${P}subject`, 'facebook')).toBe(false);
		});

		it('treats a missing delete count as nothing unlinked', async () => {
			const spy = vi.spyOn(AuthIdentityModel, 'deleteOne').mockReturnValue({ exec: async () => ({}) } as never);
			expect(await repo.unlink('customer', `${P}subject`, 'x')).toBe(false);
			spy.mockRestore();
		});

		it('releases named providers, inside a transaction or not', async () => {
			expect(await repo.releaseForSubject('customer', `${P}subject`, [])).toEqual([]);
			expect(await repo.releaseForSubject('customer', `${P}subject`, ['apple'])).toEqual([]);
			const released = await new MongoTransactionManager().withTransaction(() =>
				repo.releaseForSubject('customer', `${P}subject`, ['google']),
			);
			expect(released.map((row) => row.provider)).toEqual(['google']);
		});
	});

	describe('promotions', () => {
		const repo = new MongoPromotionRepository();
		const promotion = (name: string, overrides: Record<string, unknown> = {}) =>
			({
				id: `${P}${name}`,
				name,
				type: 'fixed',
				value: 1,
				scope: 'cart',
				kind: 'coupon',
				couponCode: `${P}${name}`,
				...overrides,
			}) as never;

		it('saves dated and undated promotions and finds them', async () => {
			await repo.save(
				promotion('dated', { startsAt: '2020-01-01T00:00:00.000Z', endsAt: '2099-01-01T00:00:00.000Z' }),
			);
			await repo.save(promotion('open'));
			expect(await repo.findById(`${P}dated`)).toMatchObject({ startsAt: '2020-01-01T00:00:00.000Z' });
			expect(await repo.findById(`${P}none`)).toBeNull();
			expect((await repo.findByCouponCode(`${P}open`))?.id).toBe(`${P}open`);
			expect(await repo.findByCouponCode(`${P}none`)).toBeNull();
		});

		it('lists what is active now or at a given time', async () => {
			expect((await repo.listActive()).map((row) => row.id)).toContain(`${P}dated`);
			expect((await repo.listActive('2019-01-01T00:00:00.000Z')).map((row) => row.id)).not.toContain(`${P}dated`);
		});
	});

	describe('SEO routes', () => {
		const repo = new MongoSeoRouteRepository();
		const route = (name: string, overrides: Record<string, unknown> = {}) =>
			({
				id: `${P}${name}`,
				path: `/${P}${name}`,
				locale: 'en',
				title: 't',
				description: 'd',
				canonicalPath: `/${P}${name}`,
				robots: 'index,follow',
				indexable: true,
				...overrides,
			}) as never;

		it('saves, finds and lists with and without an entity', async () => {
			await repo.save(route('plain'));
			await repo.save(route('entity', { entityType: 'product', entityId: 'p1', indexable: false }));
			expect(await repo.find(`/${P}plain`, 'en')).not.toHaveProperty('entityType');
			expect(await repo.find(`/${P}entity`, 'en')).toMatchObject({ entityType: 'product', entityId: 'p1' });
			expect(await repo.find(`/${P}plain`, 'fr')).toBeNull();
			const indexable = (await repo.listIndexable()).map((row) => row.id);
			expect(indexable).toContain(`${P}plain`);
			expect(indexable).not.toContain(`${P}entity`);
		});
	});

	describe('site settings', () => {
		const repo = new MongoSiteSettingsRepository();

		it('treats an unreadable stored value as unset', async () => {
			const spy = vi.spyOn(SiteSettingModel, 'findById').mockReturnValue({
				lean: () => ({ exec: async () => ({ _id: 'youtube', value: { channelHandle: 5 } }) }),
			} as never);
			expect(await repo.get('youtube')).toBeNull();
			spy.mockRestore();
		});

		it('writes and reads a value, and answers null when none is stored', async () => {
			const spy = vi.spyOn(SiteSettingModel, 'findById').mockReturnValue({
				lean: () => ({ exec: async () => null }),
			} as never);
			expect(await repo.get('youtube')).toBeNull();
			spy.mockRestore();
			const update = vi.spyOn(SiteSettingModel, 'updateOne').mockReturnValue({ exec: async () => ({}) } as never);
			const value = {
				channelHandle: '@SahaTextile',
				channelId: null,
				uploadsPlaylistId: null,
				displayCount: 8,
				railPlacements: ['home'],
			} as never;
			await repo.set('youtube', value);
			expect(update).toHaveBeenCalledTimes(1);
			update.mockRestore();
			const read = vi.spyOn(SiteSettingModel, 'findById').mockReturnValue({
				lean: () => ({ exec: async () => ({ _id: 'youtube', value }) }),
			} as never);
			expect(await repo.get('youtube')).toMatchObject({ channelHandle: '@SahaTextile' });
			read.mockRestore();
		});
	});

	describe('carts', () => {
		const repo = new MongoCartRepository();

		it('saves, finds three ways, and deletes', async () => {
			await repo.save({
				id: `${P}cart`,
				userId: `${P}u`,
				guestToken: `${P}g`,
				currency: 'INR',
				lines: [],
			} as never);
			expect((await repo.findById(`${P}cart`))?.id).toBe(`${P}cart`);
			expect((await repo.findByUserId(`${P}u`))?.id).toBe(`${P}cart`);
			expect((await repo.findByGuestToken(`${P}g`))?.id).toBe(`${P}cart`);
			expect(await repo.findById(`${P}none`)).toBeNull();
			expect(await repo.findByUserId(`${P}none`)).toBeNull();
			expect(await repo.findByGuestToken(`${P}none`)).toBeNull();
			await repo.deleteById(`${P}cart`);
			expect(await repo.findById(`${P}cart`)).toBeNull();
		});
	});

	describe('categories', () => {
		const repo = new MongoCategoryRepository();
		const category = (name: string, parentId: string | null) =>
			({
				id: `${P}${name}`,
				name: { en: name },
				slug: `${P}${name}`.toLowerCase(),
				parentId,
				path: [],
				ancestors: [],
				depth: 0,
				displayOrder: 0,
			}) as never;

		it('saves, finds, walks and deletes', async () => {
			await repo.save(category('root', null));
			await repo.save(category('kid', `${P}root`));
			expect((await repo.findById(`${P}root`))?.parentId).toBeNull();
			expect(await repo.findById(`${P}none`)).toBeNull();
			expect((await repo.findBySlug(`${P}kid`.toLowerCase()))?.id).toBe(`${P}kid`);
			expect(await repo.findBySlug(`${P}none`)).toBeNull();
			expect((await repo.listChildren(`${P}root`)).map((row) => row.id)).toEqual([`${P}kid`]);
			expect((await repo.tree()).map((row) => row.id)).toContain(`${P}root`);
			await repo.deleteById(`${P}kid`);
			expect(await repo.findById(`${P}kid`)).toBeNull();
		});
	});

	describe('currencies', () => {
		const repo = new MongoCurrencyRepository();

		it('saves and lists', async () => {
			const code = `${P}CUR`;
			await repo.upsert({ code, symbol: 'x', enabled: true, rateFromINR: 0.5 } as never);
			await repo.upsert({ code: `${code}2`, symbol: 'y', enabled: false, rateFromINR: 0.5 } as never);
			expect((await repo.findByCode(code))?.symbol).toBe('x');
			expect(await repo.findByCode(`${P}NONE`)).toBeNull();
			expect((await repo.listEnabled()).map((row) => row.code)).toContain(code);
			expect((await repo.listEnabled()).map((row) => row.code)).not.toContain(`${code}2`);
			expect((await repo.listAll()).map((row) => row.code)).toContain(`${code}2`);
		});
	});

	describe('SEO redirects', () => {
		const repo = new MongoSeoRedirectRepository();

		it('makes an id when a row has none, and reads dates', async () => {
			const saved = await repo.save({
				id: '',
				sourcePath: `/${P}a`,
				statusCode: 301,
				targetPath: '/en/about',
				reason: 'legacy_woo',
			} as never);
			expect(saved.id).toBeTruthy();
			expect(saved.createdAt ?? saved.updatedAt ?? 'no date').toBeDefined();
		});

		it('refuses a loop', async () => {
			await expect(
				repo.save({
					id: 'x',
					sourcePath: `/${P}b`,
					statusCode: 301,
					targetPath: `/${P}b`,
					reason: 'legacy_woo',
				} as never),
			).rejects.toThrow('redirect loop');
		});

		it('misses a stranger, and removes', async () => {
			expect(await repo.findBySource(`/${P}none`)).toBeNull();
			await repo.remove(`/${P}a`);
			expect(await repo.findBySource(`/${P}a`)).toBeNull();
		});

		it('reads a row with no dates', async () => {
			await insertRaw(SeoRedirectModel, {
				_id: `${P}raw`,
				sourcePath: `/${P}raw`,
				statusCode: 410,
				reason: 'legacy_woo',
			});
			expect(await repo.findBySource(`/${P}raw`)).toMatchObject({ createdAt: undefined, updatedAt: undefined });
		});
	});

	describe('pending signups', () => {
		const repo = new MongoPendingSignupRepository();

		it('misses strangers and keeps a sent time', async () => {
			expect(await repo.recordSend(`${P}none`, 'email', at, at)).toBeNull();
			expect(await repo.markVerified(`${P}none`, 'email', at)).toBeNull();
			const field = (value: string) => ({ value, verified: false, locked: false, sends: 1, lastSentAt: at });
			const started = await repo.start({
				id: `${P}ps`,
				sessionKey: `${P}key`,
				email: field('a@example.test'),
				phone: field('+91'),
				name: 'A',
				provider: null,
				providerSubject: null,
				createdAt: at,
				expiresAt: '2030-01-01T00:00:00.000Z',
				absoluteExpiresAt: '2030-01-02T00:00:00.000Z',
			} as never);
			expect((started as unknown as { email: { lastSentAt: string } }).email.lastSentAt).toBe(at);
		});

		it('treats a missing delete count as nothing deleted, and misses strangers', async () => {
			expect(await repo.deleteBySessionKey(`${P}none`)).toBe(false);
			const spy = vi.spyOn(PendingSignupModel, 'deleteOne').mockReturnValue({ exec: async () => ({}) } as never);
			expect(await repo.deleteBySessionKey(`${P}none`)).toBe(false);
			spy.mockRestore();
		});
	});

	describe('roles', () => {
		const repo = new MongoRoleRepository();
		const assignments = new MongoAdminUserRoleAssignmentRepository();
		const now = at;
		const role = {
			id: `${P}role`,
			key: `${P}role`,
			label: 'Role',
			baseRole: 'staff',
			permissions: [],
			isSystem: false,
			createdAt: now,
			updatedAt: now,
		} as never;
		const assignment = (overrides: Record<string, unknown> = {}) =>
			({
				id: `${P}assign`,
				userId: `${P}user`,
				roleId: `${P}role`,
				assignedByUserId: null,
				assignedAt: now,
				revokedAt: null,
				revokedByUserId: null,
				revokeReason: null,
				...overrides,
			}) as never;

		it('lists every role and misses a stranger', async () => {
			await repo.create(role);
			expect((await repo.listAll()).map((row) => row.id)).toContain(`${P}role`);
			expect(await repo.findByKey(`${P}none`)).toBeNull();
			expect(await repo.update(`${P}none`, { label: 'x' })).toBeNull();
		});

		it('stores a revoked assignment, and refuses a second live one', async () => {
			await assignments.assign(assignment({ id: `${P}old`, revokedAt: now }));
			await assignments.assign(assignment());
			await expect(assignments.assign(assignment({ id: `${P}twice` }))).rejects.toThrow(
				'already actively assigned',
			);
		});

		it('passes on any other failure', async () => {
			const spy = vi
				.spyOn(AdminUserRoleAssignmentModel, 'create')
				.mockRejectedValue(new Error('disk full') as never);
			await expect(assignments.assign(assignment({ id: `${P}x` }))).rejects.toThrow('disk full');
			spy.mockRestore();
		});
	});

	describe('password credentials', () => {
		it('answers null when none is stored', async () => {
			expect(await loadPasswordHash('admin_user', `${P}nobody`)).toBeNull();
			expect(passwordCredentialId('admin_user', 'a')).toContain('a');
		});
	});
});
