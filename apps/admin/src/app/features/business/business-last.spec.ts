import { type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BusinessesGateway } from '@core/business/businesses.gateway';
import { PurchasingGateway } from '@core/purchasing/purchasing.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { BusinessForm } from './business-form';
import { toBusinessRow } from './business-list';
import { BusinessPage, statementCsv } from './business-page';
import { BusinessReceiptPopup } from './business-receipt-popup';

import type { Business, BusinessListRow, LedgerStatementRow } from '@saha-textile/contracts';

/** Each query is a stand-in read from `h`; the popups answer what `h` says. */
const h = vi.hoisted(() => ({
	business: undefined as unknown,
	receivable: undefined as unknown,
	payable: undefined as unknown,
	balances: undefined as unknown,
	list: undefined as unknown,
	zones: undefined as unknown,
	summary: undefined as unknown,
	reads: [] as Array<() => unknown>,
	reason: 'Paid late twice' as unknown,
	confirm: true,
	payment: vi.fn(async (_id: string, deps: { t: (key: string) => string }) => void deps.t('x')),
	exportStatement: vi.fn((_summary: unknown, t: (key: string) => string) => t('x')),
	bump: (): void => undefined,
}));
vi.mock('@core/business/businesses.gateway', async (original) => {
	const { signal } = await import('@angular/core');
	const version = signal(0);
	h.bump = () => version.update((value) => value + 1);
	const make = (read: () => unknown, ...params: Array<(() => unknown) | undefined>) => {
		h.reads.push(() => params.map((param) => param?.()));
		return {
			data: () => {
				version();
				return read();
			},
		};
	};
	return {
		...(await original<typeof import('@core/business/businesses.gateway')>()),
		injectBusinessQuery: (id: () => unknown) => make(() => h.business, id),
		injectBusinessLedgerQuery: (id: () => unknown, side: () => string) =>
			make(() => (side() === 'receivable' ? h.receivable : h.payable), id, side),
		injectBusinessBalancesQuery: (id: () => unknown) => make(() => h.balances, id),
		injectBusinessesQuery: (query: () => unknown) => make(() => h.list, query),
		injectZoneChoicesQuery: (enabled?: () => unknown) => make(() => h.zones, enabled),
	};
});
vi.mock('@core/purchasing/purchasing.gateway', async (original) => ({
	...(await original<typeof import('@core/purchasing/purchasing.gateway')>()),
	injectSupplierSummaryQuery: (id: () => unknown) => {
		h.reads.push(() => id());
		return { data: () => h.summary };
	},
}));
vi.mock('@features/purchasing/shared/popups', () => ({
	askReason: async (_modals: unknown, options: { act: (reason: string) => Promise<unknown> }) =>
		typeof h.reason === 'string' ? options.act(h.reason) : h.reason,
	askConfirm: async () => h.confirm,
}));
vi.mock('@features/purchasing/shared/supplier-actions', () => ({
	recordSupplierPayment: h.payment,
	exportSupplierStatement: h.exportStatement,
}));

const t = (key: string, params?: Record<string, unknown>) =>
	params && Object.keys(params).length ? `${key}(${Object.values(params).join('|')})` : key;

function business(over: Record<string, unknown> = {}): Business {
	return {
		id: 'biz_1',
		legalName: 'Roy Textiles LLP',
		tradeName: 'Roy Textiles',
		businessType: 'llp',
		gstin: '19AABCR1234F1Z5',
		pan: 'AABCR1234F',
		stateCode: '19',
		registeredAddress: { line: '1 College Street', city: 'Kolkata', pin: '700073' },
		contacts: [
			{
				id: 'ct_1',
				name: 'Asha Roy',
				email: 'asha@example.test',
				mobile: { countryCallingCode: '91', number: '9800000000' },
				isAccounts: true,
			},
		],
		roles: {
			customer: { zoneId: 'zone_w', creditLimitINR: 100_000, creditDays: 30, standing: 'active' },
			supplier: true,
		},
		setOff: { mode: 'never' },
		addresses: [],
		notes: null,
		active: true,
		revision: 4,
		...over,
	} as unknown as Business;
}

const popupRef = (result: unknown) => {
	const instance = { start: vi.fn() };
	const promise = result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
	promise.catch(() => undefined);
	return { componentInstance: instance, result: promise };
};

interface Setup {
	id?: string | null;
	permissions?: string[];
	modalResult?: unknown;
}

function services(options: Setup = {}) {
	const gateway = {
		get: vi.fn(() => of(business())),
		save: vi.fn((_id: string | null, _body: unknown) => of(business({ id: 'biz_9' }))),
		setStanding: vi.fn((_id: string, _body: unknown) => of(business())),
		setSetOff: vi.fn((_id: string, _body: unknown) => of(business())),
		addAddress: vi.fn((_id: string, _body: unknown) => of(business({ addresses: [{ id: 'adr_1' }], revision: 5 }))),
		replaceAddress: vi.fn(() => of(business({ addresses: [{ id: 'adr_1' }], revision: 6 }))),
		removeAddress: vi.fn(() => of(business({ addresses: [], revision: 7 }))),
		documentPdf: vi.fn(() => of(new Blob(['%PDF']))),
		reverseSetOff: vi.fn(() => of({})),
		openOrders: vi.fn(() =>
			of([
				{ orderId: 'o2', placedAt: '2026-11-10', dueINR: 500 },
				{ orderId: 'o1', placedAt: '2026-11-01', dueINR: 1000 },
			]),
		),
		recordReceipt: vi.fn((_id: string, _body: unknown) => of({ id: 'rc_1' })),
		recordSetOff: vi.fn((_id: string, _body: unknown) => of({})),
	};
	const purchasing = {
		states: () => of([{ code: '19', name: 'West Bengal' }]),
		checkGstin: vi.fn(() => of({ problem: null, stateCode: '19', pan: 'AABCR1234F', sameGstin: null })),
		supplier: vi.fn(() => of({ kind: 'composition', paymentTermsDays: 45, usesItemCodes: true })),
	};
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const router = { navigate: vi.fn() };
	const modals = { open: vi.fn(() => popupRef('modalResult' in options ? options.modalResult : true)) };
	const activeModal = { close: vi.fn() };
	const queryClient = { invalidateQueries: vi.fn(async () => undefined) };
	const id = options.id === undefined ? 'biz_1' : options.id;
	const params = convertToParamMap(id ? { id } : {});
	const providers = [
		{ provide: BusinessesGateway, useValue: gateway },
		{ provide: PurchasingGateway, useValue: purchasing },
		{ provide: NotificationService, useValue: notifier },
		{ provide: Router, useValue: router },
		{ provide: NgbModal, useValue: modals },
		{ provide: NgbActiveModal, useValue: activeModal },
		{ provide: QueryClient, useValue: queryClient },
		{ provide: TranslocoService, useValue: { translate: t, getActiveLang: () => 'en' } },
		{
			provide: AuthStore,
			useValue: {
				permissions: () => options.permissions ?? ['business.assign', 'business.approve', 'business.settle'],
			},
		},
		{ provide: ActivatedRoute, useValue: { snapshot: { paramMap: params }, paramMap: of(params) } },
	];
	return { gateway, purchasing, notifier, router, modals, activeModal, queryClient, providers };
}

function make<T>(type: Type<T>, options: Setup = {}) {
	const s = services(options);
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: s.providers });
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(type);
	fixture.detectChanges();
	return { ...s, c: fixture.componentInstance, fixture };
}

const settle = async () => {
	for (let i = 0; i < 8; i++) await Promise.resolve();
};

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	for (const key of ['business', 'receivable', 'payable', 'balances', 'list', 'zones', 'summary'] as const)
		h[key] = undefined;
	h.reason = 'Paid late twice';
	h.confirm = true;
	h.payment.mockClear();
	h.exportStatement.mockClear();
});

describe('business screens: the last cases', () => {
	it('form: reads the credit permission, lets a short GSTIN rest, and keeps a closed address popup quiet', async () => {
		const { c, purchasing, gateway } = make(BusinessForm, { id: null, modalResult: new Error('closed') });
		expect(c.maySetCredit()).toBe(true);
		c.onGstinInput('19AAB');
		await vi.advanceTimersByTimeAsync(350);
		expect(purchasing.checkGstin).not.toHaveBeenCalled();
		expect(c.verdict().kind).toBe('typing');
		await c.openAddress();
		await settle();
		expect(c.draftAddresses()).toEqual([]);
		expect(gateway.addAddress).not.toHaveBeenCalled();
	});

	it('form: a new business with both roles compares its set-off with "never"', async () => {
		const { c, gateway, notifier } = make(BusinessForm, { id: null });
		await settle();
		await vi.advanceTimersByTimeAsync(350);
		c.form.patchValue({
			legalName: 'New Mill',
			line: '2 Strand Road',
			pin: '700001',
			kind: 'unregistered',
			buysFromUs: true,
			sellsToUs: true,
		});
		await c.save();
		expect(gateway.save).toHaveBeenCalledTimes(1);
		expect(gateway.setSetOff).not.toHaveBeenCalled();
		expect(notifier.showSuccess).toHaveBeenCalledWith('biz_created');
	});

	it('list row: the legal name alone, the same trade name, an inactive business and no credit used', () => {
		const base = {
			id: 'biz_2',
			legalName: 'Sen Weavers',
			tradeName: '',
			gstin: null,
			stateName: 'West Bengal',
			active: false,
			buysFromUs: true,
			sellsToUs: false,
			zone: null,
			creditLimitINR: 50_000,
			creditUsedINR: null,
		} as unknown as BusinessListRow;
		const row = toBusinessRow(base, t);
		expect(row.business).toContain('Sen Weavers');
		expect(row.business).toContain('biz_inactive');
		expect(row.business).toContain('West Bengal');
		expect(row.credit).toContain('₹0');
		const same = toBusinessRow({ ...base, tradeName: 'Sen Weavers', active: true } as BusinessListRow, t);
		expect(same.business).not.toContain('biz_inactive');
		expect(same.business).toContain('<small class="text-muted">West Bengal</small>');
	});

	it('page: a statement row with no document number, and every list before the accounts arrive', () => {
		const csv = statementCsv(
			[
				{
					at: '2026-11-01T10:00:00Z',
					documentNumber: null,
					kind: 'setOff',
					amountINR: 100,
					balanceINR: 100,
					dueOn: null,
				} as unknown as LedgerStatementRow,
			],
			['Date', 'Document'],
		);
		expect(csv.split('\n')[1]).toBe('"2026-11-01","setOff","100","","100",""');
		const { c } = make(BusinessPage);
		expect([...c.reversedIds()]).toEqual([]);
		expect(c.supplierEntries()).toEqual([]);
		expect(c.setOffRows()).toEqual([]);
		expect(c.activity()).toEqual([]);
	});

	it('receipt: an amount that is not a number counts as nothing', async () => {
		const s = services();
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: s.providers });
		TestBed.overrideComponent(BusinessReceiptPopup, { set: { imports: [], template: '' } });
		const c = TestBed.createComponent(BusinessReceiptPopup).componentInstance;
		c.setAmount('abc');
		expect(c.splitProblem()).toBe(false);
		expect(c.shares()).toEqual([]);
	});
});
