import { Product } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { ProductDraftsService } from '../src/catalog/product-drafts.service';

const T0 = '2026-11-24T10:00:00.000Z';
const draft = (id: string, over: Record<string, unknown> = {}) => ({
	id,
	kind: 'edit',
	productId: null,
	title: id,
	imageAssetId: null,
	changes: [],
	toFix: 0,
	createdAt: T0,
	updatedAt: T0,
	createdBy: 'adm_1',
	updatedBy: null,
	...over,
});
const product = (id: string, over: Record<string, unknown> = {}) =>
	Product.parse({
		id,
		type: 'simple',
		sku: `SKU-${id}`,
		title: { en: `${id} title` },
		slug: id.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
		basePriceINR: 1000,
		media: { gallery: [`img-${id}`], compound: [], altOverrides: {} },
		...over,
	});

function setup(items: unknown[], admins: unknown = undefined) {
	const products = [
		product('p_live', { status: 'live' }),
		product('p_was', { title: { en: '' }, status: 'disabled', lifecycle: { liveAt: '2026-01-01T00:00:00.000Z' } }),
		product('p_bare', { media: { gallery: [], compound: [], altOverrides: {} } }),
	];
	const drafts = {
		list: vi.fn(async () => ({ items, total: items.length, page: 1, pageSize: 20 })),
		countBy: async () => 1,
	};
	const catalog = {
		thumbnailsFor: async (ids: string[]) =>
			new Map(ids.filter((id) => id !== 'img-p_was').map((id) => [id, `https://cdn/${id}.jpg`])),
	};
	const service = new ProductDraftsService(
		drafts as never,
		{ findById: async (id: string) => products.find((row) => row.id === id) ?? null } as never,
		catalog as never,
		admins as never,
	);
	return { service, drafts };
}

const principal = { userId: 'adm_1' } as never;

describe('the drafts list', () => {
	it('passes only the filters asked for, and lists mine', async () => {
		const { service, drafts } = setup([]);
		await service.list(
			{ scope: 'mine', productId: 'p_live', search: 'silk', page: 1, pageSize: 20 } as never,
			principal,
		);
		expect(drafts.list).toHaveBeenCalledWith({
			createdBy: 'adm_1',
			productId: 'p_live',
			search: 'silk',
			page: 1,
			pageSize: 20,
		});
		await service.list({ scope: 'all', page: 1, pageSize: 20 } as never, principal);
		expect(drafts.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });
	});

	it('draws each draft’s own photo or its product’s, and the product’s state and name', async () => {
		const findById = vi
			.fn()
			.mockResolvedValueOnce({ displayName: '', username: 'rina' })
			.mockResolvedValueOnce({ displayName: '', username: '', email: 'mou@example.test' })
			.mockResolvedValueOnce({ displayName: '', username: '', email: '' });
		const { service } = setup(
			[
				draft('d_new', { kind: 'new', imageAssetId: 'img-own', updatedBy: 'adm_a' }),
				draft('d_live', { productId: 'p_live', updatedBy: 'adm_b' }),
				draft('d_was', { productId: 'p_was', updatedBy: 'adm_c', createdBy: 'adm_2' }),
				draft('d_gone', { productId: 'p_gone' }),
				draft('d_bare', { productId: 'p_bare' }),
			],
			{ findById },
		);
		const list = await service.list({ scope: 'all', page: 1, pageSize: 20 } as never, principal);
		expect(
			list.items.map((row) => [
				row.id,
				row.thumbnailUrl,
				row.productStatus,
				row.productTitle,
				row.productWasLive,
				row.updatedByName,
				row.mine,
			]),
		).toEqual([
			['d_new', 'https://cdn/img-own.jpg', null, null, false, 'rina', true],
			['d_live', 'https://cdn/img-p_live.jpg', 'live', 'p_live title', true, 'mou@example.test', true],
			['d_was', null, 'disabled', 'SKU-p_was', true, null, false],
			['d_gone', null, null, null, false, null, true],
			['d_bare', null, 'draft', 'p_bare title', false, null, true],
		]);
	});

	it('names nobody without the admin store', async () => {
		const { service } = setup([draft('d_new', { kind: 'new', updatedBy: 'adm_a' })]);
		expect(
			(await service.list({ scope: 'all', page: 1, pageSize: 20 } as never, principal)).items[0]?.updatedByName,
		).toBeNull();
	});
});
