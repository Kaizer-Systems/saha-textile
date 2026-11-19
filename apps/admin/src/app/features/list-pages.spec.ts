import { signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';

import { of, throwError } from 'rxjs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Coupon } from './coupon/coupon';
import { Order } from './order/order';
import { OrderStatus } from './order-status/order-status';
import { Page } from './page/page';
import { Refund } from './refund/refund';
import { Tax } from './tax/tax';
import { LegalPagesGateway } from '@core/legal-pages/legal-pages.gateway';

const data = signal<unknown>(undefined);
const query = (params?: () => unknown) => {
	params?.();
	return { data };
};
vi.mock('@data-access/queries/attribute.queries', () => ({ injectAttributesQuery: (p: () => unknown) => query(p) }));
vi.mock('@data-access/queries/coupon.queries', () => ({ injectCouponsQuery: (p: () => unknown) => query(p) }));
vi.mock('@data-access/queries/currency.queries', () => ({ injectCurrenciesQuery: (p: () => unknown) => query(p) }));
vi.mock('@data-access/queries/order.queries', () => ({ injectOrdersQuery: (p: () => unknown) => query(p) }));
vi.mock('@data-access/queries/order-status.queries', () => ({
	injectOrderStatusQuery: (p: () => unknown) => query(p),
}));
vi.mock('@data-access/queries/page.queries', () => ({ injectPagesQuery: (p: () => unknown) => query(p) }));
vi.mock('@data-access/queries/refund.queries', () => ({ injectRefundsQuery: (p: () => unknown) => query(p) }));
vi.mock('@data-access/queries/tax.queries', () => ({ injectTaxesQuery: (p: () => unknown) => query(p) }));

interface ListPage {
	tableConfig: { data: unknown[]; total: number };
	onTableChange: (value?: unknown) => void;
	onActionClicked: (action: unknown) => void;
}

const render = <T>(type: Type<T>, template = '') => {
	const router = { navigateByUrl: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: Router, useValue: router }] });
	TestBed.overrideComponent(type, { set: { imports: [], template } });
	const fixture = TestBed.createComponent(type);
	TestBed.tick();
	return { page: fixture.componentInstance, router };
};

afterEach(() => data.set(undefined));

describe.each<{ name: string; type: Type<unknown>; edit: string | null; rows: unknown[] }>([
	{ name: 'Coupon', type: Coupon, edit: '/coupon/edit/1', rows: [{ id: 1 }] },
	{ name: 'Tax', type: Tax, edit: '/tax/edit/1', rows: [{ id: 1 }] },
	{ name: 'OrderStatus', type: OrderStatus, edit: null, rows: [{ id: 1 }] },
])('$name list', ({ type, edit, rows }) => {
	it('fills the table from the query, empty until loaded', () => {
		const { page } = render(type as Type<ListPage>);
		expect(page.tableConfig).toMatchObject({ data: [], total: 0 });
		data.set({ data: rows, total: 1 });
		TestBed.tick();
		expect(page.tableConfig).toMatchObject({ data: rows, total: 1 });
		page.onTableChange({ page: 2 });
	});

	if (edit !== null) {
		it('opens a row for editing, and ignores the actions that do nothing yet', () => {
			const { page, router } = render(type as Type<ListPage>);
			page.onActionClicked({ actionToPerform: 'edit', data: { id: 1 } });
			expect(router.navigateByUrl).toHaveBeenCalledWith(edit);
			for (const actionToPerform of ['status', 'delete', 'deleteAll', 'other']) {
				page.onActionClicked({ actionToPerform, data: { id: 1 } });
			}
			expect(router.navigateByUrl).toHaveBeenCalledOnce();
		});
	}
});

describe('Order list', () => {
	it('decorates each order for the table', () => {
		const { page } = render(Order);
		data.set({
			data: [
				{
					order_number: 7,
					payment_status: 'PENDING_NOW',
					payment_method: 'cash_on',
					consumer: { name: 'Asha' },
				},
				{ order_number: 8, consumer: { name: 'Bina' } },
			],
			total: 2,
		});
		TestBed.tick();
		expect(page.tableConfig.total).toBe(2);
		expect(page.tableConfig.data[0]).toMatchObject({
			order_id: '<span class="fw-bolder">#7</span>',
			order_payment_status: '<div class="status-pending_now"><span>PENDING NOW</span></div>',
			payment_mode: '<div class="payment-mode"><span>CASH ON</span></div>',
		});
		expect(page.tableConfig.data[1]).toMatchObject({ order_payment_status: '-', payment_mode: '-' });
	});

	it('starts empty, opens a row, and ignores other actions', () => {
		const { page, router } = render(Order);
		expect(page.tableConfig.data).toEqual([]);
		data.set({});
		TestBed.tick();
		page.onTableChange({ page: 2 });
		page.onActionClicked({ actionToPerform: 'view', data: { order_number: 7 } });
		page.onActionClicked({ actionToPerform: 'other', data: {} });
		expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
		expect(router.navigateByUrl).toHaveBeenCalledWith('/order/details/7');
	});
});

describe('Refund list', () => {
	it('decorates each refund for the table', () => {
		const { page } = render(Refund);
		data.set({
			data: [
				{ status: 'in_review', user: { name: 'Asha' }, order: { order_number: 7 } },
				{ user: undefined, order: undefined },
			],
			total: 2,
		});
		TestBed.tick();
		expect(page.tableConfig.data[0]).toMatchObject({
			consumer_name: 'Asha',
			refund_status: '<div class="status-in_review"><span>in review</span></div>',
		});
		expect(page.tableConfig.data[1]).toMatchObject({ refund_status: '-' });
	});

	it('copes with an answer that has no rows', () => {
		const { page } = render(Refund);
		data.set({});
		TestBed.tick();
		expect(page.tableConfig.data).toBeUndefined();
	});

	it('opens the payout dialog for a view', () => {
		const { page } = render(Refund);
		const openModal = vi.fn();
		Object.defineProperty(page, 'PayoutModal', { value: () => ({ openModal }) });
		page.onTableChange({ page: 1 });
		page.onActionClicked({ actionToPerform: 'view', data: { id: 1 } } as never);
		page.onActionClicked({ actionToPerform: 'other', data: {} } as never);
		expect(openModal).toHaveBeenCalledOnce();
		expect(page.approved({ data: {} as never })).toBeUndefined();
	});
});

describe('Pages list (Legal Pages brief, P1)', () => {
	const legal = (slug: string, gaps: Record<string, string[]> = {}) => ({
		page: { slug, title: { en: slug.replace('-', ' ') }, updatedAt: '2026-11-16T10:00:00.000Z' },
		gaps,
	});
	const open = (
		missing: string | null,
		answer = of([legal('privacy-policy'), legal('shipping-policy', { bn: ['content'] })]),
	) => {
		const router = { navigate: vi.fn(), navigateByUrl: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: Router, useValue: router },
				{ provide: LegalPagesGateway, useValue: { list: () => answer } },
				{ provide: ActivatedRoute, useValue: { snapshot: { queryParams: missing ? { missing } : {} } } },
			],
		});
		TestBed.overrideComponent(Page, { set: { imports: [], template: '' } });
		const page = TestBed.createComponent(Page).componentInstance;
		return { page, router };
	};

	it('lists the four pages with their fixed address and only the pencil', async () => {
		const { page } = open(null);
		await Promise.resolve();
		const config = page.tableConfig();
		expect(config.data).toEqual([
			{
				id: 'privacy-policy',
				title: 'privacy policy',
				address: '/privacy-policy',
				updated_at: '2026-11-16T10:00:00.000Z',
			},
			{
				id: 'shipping-policy',
				title: 'shipping policy',
				address: '/shipping-policy',
				updated_at: '2026-11-16T10:00:00.000Z',
			},
		]);
		expect(config.rowActions?.map((action) => action.actionToPerform)).toEqual(['edit']);
	});

	it('from Settings › Languages lists only what that language still misses, and the form opens in it', async () => {
		const { page, router } = open('bn');
		await Promise.resolve();
		expect(page.tableConfig().data.map((row) => (row as { id: string }).id)).toEqual(['shipping-policy']);
		page.onActionClicked({ actionToPerform: 'edit', data: { id: 'shipping-policy' } } as never);
		expect(router.navigate).toHaveBeenCalledWith(['/page/edit', 'shipping-policy'], {
			queryParams: { missing: 'bn' },
		});
		page.onActionClicked({ actionToPerform: 'delete', data: { id: 'shipping-policy' } } as never);
		expect(router.navigate).toHaveBeenCalledOnce();
	});

	it('shows an empty list when the API cannot answer', async () => {
		const { page } = open(
			null,
			throwError(() => new Error('down')),
		);
		await Promise.resolve();
		expect(page.tableConfig()).toMatchObject({ data: [], total: 0 });
	});
});
