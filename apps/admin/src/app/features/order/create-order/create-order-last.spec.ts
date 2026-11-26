import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Observable, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CouponsGateway } from '@core/coupons/coupons.gateway';
import { OrderDraftStore } from '@core/orders/order-draft.store';
import { OrdersGateway } from '@core/orders/orders.gateway';
import { LoaderStore } from '@core/state/loader.store';
import { NotificationService } from '@data-access/services/notification.service';

import { CreateOrder } from './create-order';
import { OrderBuyerCard } from './order-buyer-card';

import type { AdminProductCard } from '@saha-textile/contracts';

vi.mock('@data-access/queries/category.queries', async () => {
	const { signal: make } = await import('@angular/core');
	return { injectCategoriesQuery: () => ({ data: make(undefined) }) };
});
vi.mock('@core/orders/orders.gateway', async (original) => ({
	...(await original<typeof import('@core/orders/orders.gateway')>()),
	injectAdminCardsQuery: () => ({ data: () => undefined, isPending: () => false }),
	injectAdminCartQuery: () => ({ data: signal(undefined), isFetching: () => false }),
	injectOrderCurrenciesQuery: () => ({ data: () => undefined }),
}));

const card = (over: Partial<AdminProductCard> = {}): AdminProductCard => ({
	productId: 'set1',
	title: 'Wedding set',
	imageUrl: null,
	categoryIds: [],
	hasVariants: false,
	soldBy: 'piece',
	shortestCutTenths: null,
	stock: 4,
	retailINR: 6_800,
	isBundle: true,
	setsPossible: 2,
	price: 6_800,
	zonePrice: null,
	...over,
});

function make<T>(type: new (...args: never[]) => T, lang = 'en', gateway: object = {}) {
	const modals = {
		open: vi.fn(() => {
			const result = Promise.reject(new Error('closed'));
			result.catch(() => undefined);
			return { componentInstance: { start: vi.fn(async () => undefined) }, result };
		}),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: OrdersGateway, useValue: gateway },
			{ provide: CouponsGateway, useValue: { checkoutOptions: vi.fn(() => of([])) } },
			{ provide: NotificationService, useValue: { showSuccess: vi.fn(), showError: vi.fn() } },
			{ provide: Router, useValue: { navigate: vi.fn(async () => true) } },
			{ provide: NgbModal, useValue: modals },
			{ provide: NgbActiveModal, useValue: { close: vi.fn() } },
			{ provide: LoaderStore, useValue: { status: () => false } },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key, getActiveLang: () => lang } },
			{ provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
		],
	});
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	const draft = TestBed.inject(OrderDraftStore);
	draft.clear();
	const fixture = TestBed.createComponent(type);
	fixture.detectChanges();
	return { c: fixture.componentInstance, draft, modals };
}

afterEach(() => {
	vi.useRealTimers();
	sessionStorage.clear();
});

describe('Create order: the last cases', () => {
	it('searches after a pause, a cleared box searching for everything', () => {
		vi.useFakeTimers();
		const { c } = make(CreateOrder);
		c.page.set(3);
		c.term.setValue('  silk ');
		vi.advanceTimersByTime(400);
		expect([c.search(), c.page()]).toEqual(['silk', 1]);
		c.term.setValue(null);
		vi.advanceTimersByTime(400);
		expect(c.search()).toBe('');
	});

	it('writes prices for a Bengali page', () => {
		const { c } = make(CreateOrder, 'bn');
		expect(c.rupees(1_200)).toContain('₹');
		expect(c.money(1_200)).toContain('₹');
	});

	it('a set whose Configure popup is closed adds nothing', async () => {
		const { c, draft, modals } = make(CreateOrder);
		await c.add(card());
		expect(modals.open).toHaveBeenCalledTimes(1);
		expect(draft.lines()).toEqual([]);
	});

	it('a buyer search that fails after a newer one was asked leaves the newer answer', async () => {
		vi.useFakeTimers();
		let fail: () => void = () => undefined;
		const searchCustomers = vi
			.fn()
			.mockReturnValueOnce(
				new Observable((subscriber) => {
					fail = () => subscriber.error(new Error('late'));
				}),
			)
			.mockReturnValueOnce(of([{ id: 'cus_2', name: 'Asha Roy', email: null, phone: null }]));
		const { c } = make(OrderBuyerCard, 'en', { searchCustomers });
		c.search({ search: 'old' } as never);
		await vi.advanceTimersByTimeAsync(350);
		c.search({ search: 'asha' } as never);
		await vi.advanceTimersByTimeAsync(350);
		fail();
		await vi.advanceTimersByTimeAsync(0);
		expect((c as unknown as { found: () => Array<{ id: string }> }).found().map((row) => row.id)).toEqual([
			'cus_2',
		]);
	});

	it('a business search that answers after a newer one was asked is not shown', async () => {
		vi.useFakeTimers();
		let answer: () => void = () => undefined;
		const row = (id: string) => ({ id, legalName: id, tradeName: '', gstin: null, phone: null });
		const searchBusinesses = vi
			.fn()
			.mockReturnValueOnce(
				new Observable((subscriber) => {
					answer = () => {
						subscriber.next([row('biz_old')]);
						subscriber.complete();
					};
				}),
			)
			.mockReturnValueOnce(of([row('biz_new')]));
		const { c, draft } = make(OrderBuyerCard, 'en', { searchBusinesses });
		draft.setBuyerKind('business');
		c.search({ search: 'old' } as never);
		await vi.advanceTimersByTimeAsync(350);
		c.search({ search: 'new' } as never);
		await vi.advanceTimersByTimeAsync(350);
		answer();
		await vi.advanceTimersByTimeAsync(0);
		expect((c as unknown as { found: () => Array<{ id: string }> }).found().map((row) => row.id)).toEqual([
			'biz_new',
		]);
	});

	it('the buyer card names a currency in the page’s language', () => {
		const { c } = make(OrderBuyerCard);
		expect(c.currencyName('USD')).toEqual(expect.any(String));
		expect(c.currencyName('GBP')).toBe('fx_name_GBP');
	});
});
