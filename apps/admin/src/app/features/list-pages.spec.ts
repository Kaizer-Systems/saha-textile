import { signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Blog } from './blog/blog';
import { Coupon } from './coupon/coupon';
import { Currency } from './currency/currency';
import { Order } from './order/order';
import { OrderStatus } from './order-status/order-status';
import { Page } from './page/page';
import { QuestionsAnswers } from './questions-answers/questions-answers';
import { Refund } from './refund/refund';
import { Tax } from './tax/tax';

const data = signal<unknown>(undefined);
const query = (params?: () => unknown) => {
	params?.();
	return { data };
};
vi.mock('@data-access/queries/attribute.queries', () => ({ injectAttributesQuery: (p: () => unknown) => query(p) }));
vi.mock('@data-access/queries/blog.queries', () => ({ injectBlogsQuery: (p: () => unknown) => query(p) }));
vi.mock('@data-access/queries/coupon.queries', () => ({ injectCouponsQuery: (p: () => unknown) => query(p) }));
vi.mock('@data-access/queries/currency.queries', () => ({ injectCurrenciesQuery: (p: () => unknown) => query(p) }));
vi.mock('@data-access/queries/order.queries', () => ({ injectOrdersQuery: (p: () => unknown) => query(p) }));
vi.mock('@data-access/queries/order-status.queries', () => ({
	injectOrderStatusQuery: (p: () => unknown) => query(p),
}));
vi.mock('@data-access/queries/page.queries', () => ({ injectPagesQuery: (p: () => unknown) => query(p) }));
vi.mock('@data-access/queries/questions-answers.queries', () => ({
	injectQuestionAnswersQuery: (p: () => unknown) => query(p),
}));
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
	{ name: 'Blog', type: Blog, edit: '/blog/edit/1', rows: [{ id: 1 }] },
	{ name: 'Coupon', type: Coupon, edit: '/coupon/edit/1', rows: [{ id: 1 }] },
	{ name: 'Currency', type: Currency, edit: '/currency/edit/1', rows: [{ id: 1 }] },
	{ name: 'Page', type: Page, edit: '/page/edit/1', rows: [{ id: 1 }] },
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

describe('Questions and answers list', () => {
	it('fills the table, treating a bare answer as empty', () => {
		const { page } = render(QuestionsAnswers);
		data.set({});
		TestBed.tick();
		expect(page.tableConfig()).toMatchObject({ data: [], total: 0 });
		data.set({ data: [{ id: 1 }], total: 1 });
		TestBed.tick();
		expect(page.tableConfig().total).toBe(1);
	});

	it('opens the answer dialog, and ignores the actions that do nothing yet', () => {
		const { page } = render(QuestionsAnswers);
		const openModal = vi.fn();
		Object.defineProperty(page, 'AnswersModal', { value: () => ({ openModal }) });
		page.onTableChange({ page: 1 });
		page.onActionClicked({ actionToPerform: 'edit', data: { id: 1 } } as never);
		page.onActionClicked({ actionToPerform: 'delete', data: {} } as never);
		page.onActionClicked({ actionToPerform: 'deleteAll', data: [] } as never);
		page.onActionClicked({ actionToPerform: 'other', data: {} } as never);
		expect(openModal).toHaveBeenCalledOnce();
	});
});
