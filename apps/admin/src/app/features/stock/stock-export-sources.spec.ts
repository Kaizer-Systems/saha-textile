import { signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { StockGateway } from '@core/purchasing/stock.gateway';
import { AuthStore } from '@core/state/auth.store';
import { CategoryService } from '@data-access/services/category.service';
import { NotificationService } from '@data-access/services/notification.service';

import { Reorder } from './reorder';
import { Reports } from './reports';
import { StockList } from './stock-list';

/** Stock reports, the reorder list and all stock through the Export menu (brief 25 EX1), written by their CSV code. */

const settle = async () => {
	for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const REORDER_ROW = {
	variantId: 'v1',
	productId: 'p1',
	sku: 'ST-1',
	title: 'Silk saree',
	optionsLabel: 'Red',
	soldBy: 'piece',
	freeToSell: 2,
	soldLast60Days: 9,
	daysLeft: 13,
	lastSupplierId: 'sup_1',
	lastSupplierName: 'Nadia Weavers',
	suggested: 6,
};
const STOCK_ROW = {
	id: 'v1',
	sku: 'ST-1',
	title: 'Silk saree',
	optionsLabel: null,
	categoryPath: 'Sarees',
	soldBy: 'piece',
	onHand: 5,
	held: 0,
	inOrders: 1,
	freeToSell: 4,
	valueAtCostINR: 12_000,
	lastReceivedOn: '2026-11-01',
};

function mount<T>(type: Type<T>, stock: Record<string, unknown> = {}) {
	TestBed.resetTestingModule();
	const gateway = {
		ageing: vi.fn(() => of({ rows: [], total: 0 })),
		valuation: vi.fn(() => of(undefined)),
		movements: vi.fn(() => of({ rows: [], total: 0 })),
		register: vi.fn(() => of({ rows: [] })),
		unpaidBills: vi.fn(() => of(undefined)),
		reorder: vi.fn(() => of({ items: [REORDER_ROW] })),
		reorderToOrders: vi.fn(),
		list: vi.fn(() => of({ items: [STOCK_ROW], total: 1, counts: {}, tiles: null })),
		...stock,
	};
	TestBed.configureTestingModule({
		imports: [
			type,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
			provideRouter([]),
			{
				provide: ActivatedRoute,
				useValue: {
					snapshot: { data: {}, queryParamMap: convertToParamMap({}) },
					paramMap: of(convertToParamMap({})),
				},
			},
			{ provide: StockGateway, useValue: gateway },
			{ provide: CategoryService, useValue: { getCategoryRows: vi.fn(() => of([])) } },
			{ provide: NgbModal, useValue: { open: vi.fn() } },
			{ provide: NotificationService, useValue: { showError: vi.fn(), showSuccess: vi.fn() } },
			{ provide: AuthStore, useValue: { permissions: signal(['stock.cost']), user: signal({ id: 'adm_1' }) } },
		],
	});
	TestBed.overrideComponent(type, { set: { template: '' } });
	const fixture = TestBed.createComponent(type);
	fixture.detectChanges();
	return { page: fixture.componentInstance, gateway };
}

describe('stock reports for the Export menu (EX1)', () => {
	it('hands over ageing and the purchase register as their CSV writes them, titled for the report', () => {
		const { page } = mount(Reports);
		expect(page.exportAgeingSource()()).toMatchObject({
			fileName: 'stock-ageing.csv',
			title: 'report_stock_ageing',
			rows: [],
			area: 'other',
		});
		const register = page.exportRegisterSource()();
		expect(register?.title).toBe('report_stock_register');
		expect(register?.fileName).toMatch(/^purchase-register-\d{4}-\d{2}\.csv$/);
		expect(register?.header).toHaveLength(12);
	});

	it('has nothing to hand over for the stock value or unpaid bills before they are read', () => {
		const { page } = mount(Reports);
		expect(page.exportValuationSource()()).toBeNull();
		expect(page.exportUnpaidSource()()).toBeNull();
	});
});

describe('the reorder list for the Export menu (EX1)', () => {
	it('hands over the lines shown, as the CSV writes them', async () => {
		const { page } = mount(Reorder);
		await settle();
		const source = page.exportListSource()();
		expect(source).toMatchObject({ fileName: 'reorder-list.csv', title: 'reorder_list', area: 'other' });
		expect(source?.rows.map((row) => row[0])).toEqual(['ST-1']);
	});
});

describe('all stock for the Export menu (EX1)', () => {
	it('reads the filtered stock and hands over what its CSV writes', async () => {
		const { page, gateway } = mount(StockList);
		const source = await page.exportListSource();
		expect(gateway.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, pageSize: 100 }));
		expect(source).toMatchObject({ fileName: 'stock.csv', title: 'all_stock', area: 'other' });
		expect(source?.rows.map((row) => row[0])).toEqual(['ST-1']);
	});
});
