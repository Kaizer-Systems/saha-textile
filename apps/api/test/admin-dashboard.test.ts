import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminDashboardController } from '../src/admin/admin-dashboard.controller';
import { AdminDashboardService } from '../src/admin/admin-dashboard.service';
import { PERMISSIONS_KEY, SessionGuard } from '../src/auth/session.guard';
import { cookieNames } from '../src/common/cookies';
import { loadConfig } from '../src/config/app-config';

const title = { en: 'Silk Saree', bn: 'সিল্কের শাড়ি' };
const product = { id: 'p1', title, media: { gallery: ['asset_1'] } };
const asset = {
	id: 'asset_1',
	visibility: 'public',
	width: 10,
	height: 10,
	dominantColor: null,
	thumbHash: null,
	text: { alt: {}, title: {}, caption: {} },
	derivatives: [
		{ role: 'card', storageKey: 'k', width: 10, height: 10, byteSize: 1, format: 'image/webp', roleVersion: 1 },
	],
};

const setup = () => {
	const dashboard = {
		salesTotals: vi.fn(async () => ({ revenueINR: 1500, orders: 3 })),
		revenueByMonth: vi.fn(async (): Promise<unknown[]> => []),
		recentOrders: vi.fn(async (): Promise<unknown[]> => []),
		topProducts: vi.fn(async (): Promise<unknown[]> => []),
		customerCount: vi.fn(async () => 78),
		lowestStock: vi.fn(async (): Promise<unknown[]> => []),
		latestReviews: vi.fn(async (): Promise<unknown[]> => []),
	};
	const customers = { findById: vi.fn(async (): Promise<unknown> => ({ displayName: 'Asha' })) };
	const products = { findById: vi.fn(async (_id: string): Promise<unknown> => product) };
	const variants = { listForProducts: vi.fn(async (): Promise<unknown[]> => []) };
	const media = { findManyByIds: vi.fn(async (): Promise<unknown[]> => []) };
	const storage = { getUrl: vi.fn((key: string) => `https://cdn.test/${key}`) };
	const service = new AdminDashboardService(
		dashboard as never,
		customers as never,
		products as never,
		variants as never,
		media as never,
		storage as never,
	);
	return { service, dashboard, customers, products, variants, media };
};

describe('AdminDashboardService', () => {
	beforeEach(() => vi.useRealTimers());

	it('reports revenue and orders for the chosen period only', async () => {
		const { service, dashboard } = setup();
		const revenue = await service.revenue({ period: 'custom', from: '2026-10-01', to: '2026-10-31' });
		expect(revenue).toMatchObject({ revenueINR: 1500, from: '2026-09-30T18:30:00.000Z' });
		expect(revenue).not.toHaveProperty('orders');

		const orders = await service.orders({ period: 'last_12_months' });
		expect(orders.orders).toBe(3);
		expect(orders).not.toHaveProperty('revenueINR');
		expect(dashboard.salesTotals).toHaveBeenCalledTimes(2);
	});

	it('fills months with no sales with zero', async () => {
		vi.useFakeTimers({ now: new Date('2026-11-07T06:00:00.000Z') });
		const { service, dashboard } = setup();
		dashboard.revenueByMonth.mockResolvedValue([{ month: '2026-10', revenueINR: 900 }]);
		const { months } = await service.monthlyRevenue();
		expect(months).toHaveLength(12);
		expect(months[0]).toEqual({ month: '2025-12', revenueINR: 0 });
		expect(months[10]).toEqual({ month: '2026-10', revenueINR: 900 });
	});

	it('names the customer on each recent order, with room for a guest', async () => {
		const { service, dashboard, customers } = setup();
		const row = { id: 'o', orderNumber: 'N1', totalINR: 10, status: 'paid' };
		dashboard.recentOrders.mockResolvedValue([
			{ ...row, userId: 'c1', createdAt: '2026-11-01T00:00:00.000Z' },
			{ ...row, userId: null },
		]);
		customers.findById.mockResolvedValueOnce({ email: 'a@example.test' });
		const { items } = await service.recentOrders();
		expect(dashboard.recentOrders).toHaveBeenCalledWith(5);
		expect(items[0]).toMatchObject({ customerName: 'a@example.test', placedAt: '2026-11-01T00:00:00.000Z' });
		expect(items[1]).toMatchObject({ customerName: null, placedAt: null });
	});

	it('copes with a customer who no longer exists', async () => {
		const { service, dashboard, customers } = setup();
		dashboard.recentOrders.mockResolvedValue([
			{ id: 'o', orderNumber: 'N1', totalINR: 10, status: 'paid', userId: 'gone' },
		]);
		customers.findById.mockResolvedValue(null);
		expect((await service.recentOrders()).items[0]?.customerName).toBeNull();
	});

	it('counts customers', async () => {
		await expect(setup().service.customerCount()).resolves.toEqual({ customers: 78 });
	});

	it('adds stock and images to the top products', async () => {
		const { service, dashboard, variants, media, products } = setup();
		products.findById.mockImplementation(async (id: string) => (id === 'p1' ? product : null));
		const sales = {
			title,
			lastSoldAt: '2026-11-01T00:00:00.000Z',
			unitPriceINR: 100,
			orders: 2,
			quantitySold: 3,
			revenueINR: 300,
		};
		dashboard.topProducts.mockResolvedValue([
			{ ...sales, productId: 'p1' },
			{ ...sales, productId: 'gone' },
		]);
		variants.listForProducts.mockResolvedValue([
			{ productId: 'p1', stock: { quantity: 4 } },
			{ productId: 'p1', stock: { quantity: 2 } },
			{ productId: 'other', stock: { quantity: 9 } },
		]);
		media.findManyByIds.mockResolvedValue([]);
		const { items } = await service.topProducts({ period: 'this_year' });
		expect(dashboard.topProducts).toHaveBeenCalledWith(expect.anything(), 4);
		expect(items[0]).toMatchObject({ productId: 'p1', stock: 6, thumbnailUrl: null });
		expect(items[1]).toMatchObject({ productId: 'gone', stock: 0 });
	});

	it('reads no images when no row has one', async () => {
		const { service, products, dashboard, media } = setup();
		products.findById.mockResolvedValue(null);
		dashboard.latestReviews.mockResolvedValue([
			{ id: 'r', productId: 'x', userId: 'c', rating: 4, status: 'pending' },
		]);
		const { items } = await service.reviews();
		expect(media.findManyByIds).not.toHaveBeenCalled();
		expect(items[0]).toMatchObject({
			productTitle: null,
			thumbnailUrl: null,
			createdAt: null,
			customerName: 'Asha',
		});
	});

	it('shows a review with its product', async () => {
		const { service, dashboard } = setup();
		dashboard.latestReviews.mockResolvedValue([
			{
				id: 'r',
				productId: 'p1',
				userId: 'c',
				rating: 5,
				status: 'approved',
				createdAt: '2026-11-01T00:00:00.000Z',
			},
		]);
		const { items } = await service.reviews();
		expect(dashboard.latestReviews).toHaveBeenCalledWith(4);
		expect(items[0]).toMatchObject({ productTitle: title, rating: 5, createdAt: '2026-11-01T00:00:00.000Z' });
	});

	it('works out each stock row and passes the category on', async () => {
		const { service, dashboard, media } = setup();
		const row = { productId: 'p1', title, galleryAssetId: null, variantThreshold: null, productThreshold: null };
		dashboard.lowestStock.mockResolvedValue([
			{ ...row, variantId: 'v1', sku: 'S1', quantity: 0, galleryAssetId: 'asset_1' },
			{ ...row, variantId: 'v2', sku: 'S2', quantity: 1 },
			{ ...row, variantId: 'v3', sku: 'S3', quantity: 9 },
		]);
		media.findManyByIds.mockResolvedValue([asset]);
		const { items } = await service.stock({ categoryId: 'cat' });
		expect(dashboard.lowestStock).toHaveBeenCalledWith({ limit: 8, categoryId: 'cat' });
		expect(media.findManyByIds).toHaveBeenCalledWith(['asset_1']);
		expect(items.map((item) => item.state)).toEqual(['out_of_stock', 'low_stock', 'in_stock']);
		expect(items[0]?.thumbnailUrl).toBe('https://cdn.test/k');
		expect(items[1]?.thumbnailUrl).toBeNull();
	});

	it('leaves the image out while its card size is not ready', async () => {
		const { service, dashboard, media } = setup();
		dashboard.lowestStock.mockResolvedValue([
			{
				variantId: 'v1',
				productId: 'p1',
				sku: 'S1',
				title,
				galleryAssetId: 'asset_1',
				quantity: 1,
				variantThreshold: null,
				productThreshold: null,
			},
		]);
		media.findManyByIds.mockResolvedValue([{ ...asset, derivatives: [] }]);
		expect((await service.stock({})).items[0]?.thumbnailUrl).toBeNull();
	});

	it('leaves the image out for an asset that cannot be shown', async () => {
		const { service, dashboard, media } = setup();
		dashboard.latestReviews.mockResolvedValue([
			{ id: 'r', productId: 'p1', userId: 'c', rating: 4, status: 'pending' },
		]);
		media.findManyByIds.mockResolvedValue([{ ...asset, visibility: 'private' }]);
		expect((await service.reviews()).items[0]?.thumbnailUrl).toBeNull();
	});
});

describe('admin dashboard routes', () => {
	const ROUTES = [
		['revenue', 'dashboard.revenue'],
		['monthlyRevenue', 'dashboard.revenue'],
		['orders', 'dashboard.orders'],
		['recentOrders', 'dashboard.orders'],
		['customers', 'dashboard.customers'],
		['topProducts', 'dashboard.top_products'],
		['stock', 'dashboard.stock'],
		['reviews', 'dashboard.reviews'],
	] as const;

	it.each(ROUTES)('%s asks for %s and nothing else', (method, code) => {
		expect(Reflect.getMetadata(PERMISSIONS_KEY, AdminDashboardController.prototype[method])).toEqual([code]);
	});

	it('covers every route on the controller', () => {
		const methods = Object.getOwnPropertyNames(AdminDashboardController.prototype).filter(
			(name) => name !== 'constructor',
		);
		expect(methods.sort()).toEqual(ROUTES.map(([method]) => method).sort());
	});

	it('forwards each query to the service', async () => {
		const service = {
			revenue: vi.fn(),
			monthlyRevenue: vi.fn(),
			orders: vi.fn(),
			recentOrders: vi.fn(),
			customerCount: vi.fn(),
			topProducts: vi.fn(),
			stock: vi.fn(),
			reviews: vi.fn(),
		};
		const controller = new AdminDashboardController(service as never);
		const period = { period: 'last_month' } as const;
		await controller.revenue(period);
		await controller.monthlyRevenue();
		await controller.orders(period);
		await controller.recentOrders();
		await controller.customers();
		await controller.topProducts(period);
		await controller.stock({ categoryId: 'c' });
		await controller.reviews();
		expect(service.revenue).toHaveBeenCalledWith(period);
		expect(service.orders).toHaveBeenCalledWith(period);
		expect(service.topProducts).toHaveBeenCalledWith(period);
		expect(service.stock).toHaveBeenCalledWith({ categoryId: 'c' });
		for (const spy of [service.monthlyRevenue, service.recentOrders, service.customerCount, service.reviews]) {
			expect(spy).toHaveBeenCalledOnce();
		}
	});

	/** The real guard reading the real route metadata, for a staff member with one grant. */
	describe('through the session guard', () => {
		const config = loadConfig({ JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32) });
		const names = cookieNames(config);

		const guardFor = (permissions: string[]) =>
			new SessionGuard(
				new Reflector(),
				config,
				{
					verifyToken: vi.fn(async () => ({
						sub: 'adm_1',
						sid: 'sess_1',
						aud: 'admin',
						tokenVersion: 0,
						permissionsVersion: 0,
					})),
				} as never,
				{} as never,
				{
					findAuthStateById: vi.fn(async () => ({
						id: 'adm_1',
						status: 'active',
						role: 'staff',
						permissions,
						tokenVersion: 0,
						permissionsVersion: 0,
					})),
				} as never,
				{ findById: vi.fn() } as never,
				{ listActiveForUser: vi.fn(async () => []) } as never,
				{ findLiveById: vi.fn(async () => ({ id: 'sess_1' })) } as never,
			);

		const contextFor = (method: (typeof ROUTES)[number][0]) =>
			({
				getHandler: () => AdminDashboardController.prototype[method],
				getClass: () => AdminDashboardController,
				switchToHttp: () => ({
					getRequest: () => ({ cookies: { [names.access]: 'token' }, headers: {}, url: '/admin/dashboard' }),
				}),
			}) as unknown as ExecutionContext;

		it.each(ROUTES)('%s lets in the holder of %s', async (method, code) => {
			await expect(guardFor([code]).canActivate(contextFor(method))).resolves.toBe(true);
		});

		it.each(ROUTES)('%s refuses someone with every other dashboard grant', async (method, code) => {
			const others = [...new Set(ROUTES.map(([, grant]) => grant))].filter((grant) => grant !== code);
			await expect(guardFor(others).canActivate(contextFor(method))).rejects.toThrow(ForbiddenException);
		});

		it.each(ROUTES)('%s is not opened by the page permission', async (method) => {
			const pages = ['order.index', 'product.index', 'review.index', 'customer.index'];
			await expect(guardFor(pages).canActivate(contextFor(method))).rejects.toThrow(ForbiddenException);
		});
	});
});
