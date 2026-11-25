import { HttpErrorResponse } from '@angular/common/http';
import { signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { SelfInvoicesGateway } from '@core/accounts/self-invoices.gateway';
import { ExpenseBillsGateway } from '@core/purchasing/expense-bills.gateway';
import { PurchasingGateway } from '@core/purchasing/purchasing.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { SupplierForm, cleanGstin, gstinVerdict } from './supplier-form';
import { SupplierList, termsText, toSupplierRow } from './supplier-list';
import { SupplierPage, statementLink } from './supplier-page';
import { PaymentPopup, parseRupees } from '../shared/payment-popup';
import { linesQuantity, piecesOf, returnStatus, returnWhy } from '../shared/purchasing-labels';

import type { SupplierListRow, SupplierStatementRow } from '@saha-textile/contracts';

const client = vi.hoisted(() => ({ invalidateQueries: vi.fn() }));
const suppliers = signal<unknown>(undefined);
const summary = signal<unknown>(undefined);
const settings = signal<unknown>({ defaultPaymentTermsDays: 15, unpaidAlertDays: 150 });

vi.mock('@core/purchasing/purchasing.gateway', async (original) => ({
	...(await original<typeof import('@core/purchasing/purchasing.gateway')>()),
	injectSuppliersQuery: (query: () => unknown) => (query(), { data: suppliers }),
	injectSupplierSummaryQuery: (id: () => unknown) => (id(), { data: summary, isError: () => false }),
}));
vi.mock('@tanstack/angular-query-experimental', async (original) => ({
	...(await original<typeof import('@tanstack/angular-query-experimental')>()),
	// The supplier page's tab lists: their contents are drawn by the template, not asserted here.
	injectQuery: (options: () => unknown) => (options(), { data: () => undefined }),
}));
vi.mock('@core/purchasing/stock.gateway', () => ({
	injectInventorySettingsQuery: () => ({ data: settings }),
}));

const translate = (key: string, params?: Record<string, unknown>) =>
	params ? `${key} ${JSON.stringify(params)}` : key;
const transloco = { translate, getActiveLang: () => 'en', getTranslation: () => ({}) };

function render<T>(
	type: Type<T>,
	gateway: Partial<Record<keyof PurchasingGateway, unknown>>,
	routeId: string | null = null,
) {
	const router = { navigate: vi.fn(), navigateByUrl: vi.fn() };
	const toasts = { showError: vi.fn(), showSuccess: vi.fn() };
	const modals = { open: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: Router, useValue: router },
			{
				provide: ActivatedRoute,
				useValue: { snapshot: { paramMap: convertToParamMap(routeId ? { id: routeId } : {}) } },
			},
			{
				provide: PurchasingGateway,
				useValue: {
					states: () =>
						of([
							{ code: '19', name: 'West Bengal' },
							{ code: '09', name: 'Uttar Pradesh' },
						]),
					...gateway,
				},
			},
			{ provide: QueryClient, useValue: client },
			{ provide: ExpenseBillsGateway, useValue: { list: () => of([]) } },
			{ provide: NotificationService, useValue: toasts },
			{ provide: TranslocoService, useValue: transloco },
			{ provide: AuthStore, useValue: { permissions: signal(['setting.index', 'purchase_return.index']) } },
			{ provide: NgbModal, useValue: modals },
			{ provide: NgbActiveModal, useValue: { close: vi.fn(), dismiss: vi.fn() } },
		],
	});
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(type);
	TestBed.tick();
	return { page: fixture.componentInstance, fixture, router, toasts, modals };
}

const row = (over: Partial<SupplierListRow> = {}): SupplierListRow => ({
	id: 'sup_1',
	legalName: 'Banaras Silk Weavers Co-operative Society Ltd',
	shortName: 'Banaras Silk Weavers Co-op',
	kind: 'regular',
	gstin: '09AABCB4521R1Z6',
	pan: 'AABCB4521R',
	stateCode: '09',
	stateName: 'Uttar Pradesh',
	address: { line: 'D-47/112 Ramapura', city: 'Varanasi', pin: '221010' },
	contactName: null,
	phone: null,
	email: null,
	paymentTermsDays: 30,
	usesItemCodes: true,
	notes: null,
	active: true,
	taxType: 'inter_state',
	createdAt: '2026-11-01T00:00:00.000Z',
	updatedAt: '2026-11-01T00:00:00.000Z',
	owedINR: 183750,
	purchaseCount: 14,
	lastPurchaseOn: '2026-11-12',
	...over,
});

const httpError = (status: number, issues: Array<{ code: string; message: string; path: string[] }>) =>
	// The API's exception filter wraps every refusal like this (apps/api/src/common/http-exception.filter.ts).
	new HttpErrorResponse({
		status,
		error: { error: { code: 'validation_failed', message: 'Request validation failed.', issues } },
	});

describe('supplier rows (s01)', () => {
	const t = (key: string, count?: number) => (count === undefined ? key : `${key}:${count}`);

	it('draws name, city and purchase count, money right-aligned in rupees', () => {
		const out = toSupplierRow(row(), t);
		expect(out.supplier).toContain('Banaras Silk Weavers Co-op');
		expect(out.supplier).toContain('Varanasi · supplier_purchase_count:14');
		expect(out.owed).toBe('₹1,83,750');
		expect(out.kind).toBe('supplier_kind_regular');
		expect(out.terms).toBe('supplier_terms_days:30');
		expect(out.last).toBe('12 Nov 2026');
	});

	it('badges only non-regular suppliers, marks inactive ones, and dashes empty money and dates', () => {
		const out = toSupplierRow(
			row({ kind: 'composition', active: false, owedINR: 0, lastPurchaseOn: null, gstin: null }),
			t,
		);
		expect(out.kind).toContain('badge bg-warning');
		expect(out.kind).toContain('supplier_kind_composition');
		expect(out.supplier).toContain('supplier_inactive');
		expect(out.owed).toContain('—');
		expect(out.last).toContain('—');
		expect(out.gstin).toContain('—');
	});

	it('escapes names typed by people', () => {
		const out = toSupplierRow(row({ shortName: '<img src=x onerror=alert(1)>' }), t);
		expect(out.supplier).not.toContain('<img');
		expect(out.supplier).toContain('&lt;img');
	});

	it('reads 0 days as on delivery', () => {
		const count = (key: string, n: number) => `${key}:${n}`;
		expect(termsText(0, count, (key) => key)).toBe('supplier_terms_on_delivery');
		expect(termsText(1, count, (key) => key)).toBe('supplier_terms_days:1');
	});
});

describe('GSTIN verdict (s02, s02b)', () => {
	const ok = {
		problem: null,
		expectedLastCharacter: null,
		stateCode: '09',
		pan: 'AABCB4521R',
		taxType: 'inter_state' as const,
		sameGstin: null,
		samePan: [],
	};

	it('cleans spaces and case', () => {
		expect(cleanGstin(' 09aabcb 4521r1z6 ')).toBe('09AABCB4521R1Z6');
	});

	it('waits while typing, then checks', () => {
		expect(gstinVerdict('', null).kind).toBe('empty');
		expect(gstinVerdict('09AAB', null).kind).toBe('typing');
		expect(gstinVerdict('09AABCB4521R1Z6', null).kind).toBe('checking');
		expect(gstinVerdict('09AABCB4521R1Z6', 'failed').kind).toBe('unchecked');
	});

	it('names the right last character for a wrong check digit', () => {
		const verdict = gstinVerdict('19AAHFS7782K1Z4', { ...ok, problem: 'check_digit', expectedLastCharacter: '3' });
		expect(verdict).toEqual({ kind: 'problem', key: 'gstin_check_digit_wrong', params: { expected: '3' } });
	});

	it('refuses a GSTIN another supplier already has, and passes a good one with State and PAN', () => {
		expect(gstinVerdict('09AABCB4521R1Z6', { ...ok, sameGstin: { id: 'sup_9', name: 'Old' } }).kind).toBe('taken');
		expect(gstinVerdict('09AABCB4521R1Z6', ok)).toEqual({
			kind: 'ok',
			stateCode: '09',
			pan: 'AABCB4521R',
			taxType: 'inter_state',
		});
	});
});

describe('SupplierList', () => {
	it('filters, restarting at page 1', () => {
		suppliers.set({ items: [row()], total: 1, counts: { all: 6, owed: 3, inactive: 0 } });
		const { page } = render(SupplierList, {});
		page.onTableChange({ page: 3, paginate: 30 });
		page.setFilter('owed');
		expect(page.filter()).toBe('owed');
		expect(page.counts()).toEqual({ all: 6, owed: 3, inactive: 0 });
		expect(page.tableConfig().data?.[0]?.id).toBe('sup_1');
	});

	it('deletes and refreshes; a supplier with documents is refused with the API sentence', () => {
		const deleteSupplier = vi
			.fn()
			.mockReturnValueOnce(of(undefined))
			.mockReturnValueOnce(
				throwError(() =>
					httpError(400, [
						{
							code: 'supplier_has_documents',
							message: 'X has purchase entries or orders, so it stays for the books.',
							path: ['supplier_has_documents'],
						},
					]),
				),
			);
		const { page, toasts } = render(SupplierList, { deleteSupplier });
		const target = toSupplierRow(row(), (key) => key);
		page.onAction({ actionToPerform: 'delete', data: target });
		expect(toasts.showSuccess).toHaveBeenCalledWith('supplier_deleted');
		expect(client.invalidateQueries).toHaveBeenCalled();
		page.onAction({ actionToPerform: 'delete', data: target });
		expect(toasts.showError).toHaveBeenCalledWith('X has purchase entries or orders, so it stays for the books.');
	});

	it('opens and edits a supplier', () => {
		const { page, router } = render(SupplierList, {});
		const target = toSupplierRow(row(), (key) => key);
		page.onAction({ actionToPerform: 'view', data: target });
		page.onAction({ actionToPerform: 'edit', data: target });
		expect(router.navigate).toHaveBeenNthCalledWith(1, ['/suppliers', 'sup_1']);
		expect(router.navigate).toHaveBeenNthCalledWith(2, ['/suppliers', 'sup_1', 'edit']);
	});
});

describe('SupplierForm', () => {
	it('starts new suppliers on the default terms and takes State and PAN from the GSTIN', () => {
		const { page } = render(SupplierForm, {});
		expect(page.form.controls.paymentTermsDays.value).toBe(15);
		page.gstinValue.set('09AABCB4521R1Z6');
		page.form.patchValue({
			legalName: 'Banaras',
			line: 'Varanasi',
			pin: '221010',
			stateCode: '19',
			pan: 'WRONGPAN00',
		});
		const body = page.body();
		expect(body.stateCode).toBe('09');
		expect(body.pan).toBe('AABCB4521R');
		expect(body.gstin).toBe('09AABCB4521R1Z6');
	});

	it('lets an unregistered supplier keep a typed State and PAN', () => {
		const { page } = render(SupplierForm, {});
		page.form.patchValue({
			kind: 'unregistered',
			legalName: 'Maa Durga Blouse Centre',
			line: 'Gariahat',
			pin: '700019',
			stateCode: '19',
			pan: 'abcde1234f',
		});
		expect(page.gstinRequired()).toBe(false);
		const body = page.body();
		expect(body.gstin).toBeNull();
		expect(body.stateCode).toBe('19');
		expect(body.pan).toBe('ABCDE1234F');
	});

	it('blocks Save while the GSTIN is wrong or already used', () => {
		const { page } = render(SupplierForm, {});
		page.form.patchValue({ legalName: 'A', line: 'B', pin: '700001' });
		page.gstinValue.set('19AAHFS7782K1Z4');
		page.check.set({
			problem: 'check_digit',
			expectedLastCharacter: '3',
			stateCode: null,
			pan: null,
			taxType: null,
			sameGstin: null,
			samePan: [],
		});
		expect(page.canSave()).toBe(false);
		page.check.set({
			problem: null,
			expectedLastCharacter: null,
			stateCode: '19',
			pan: 'AAHFS7782K',
			taxType: 'intra_state',
			sameGstin: { id: 's', name: 'S' },
			samePan: [],
		});
		expect(page.canSave()).toBe(false);
		page.check.set({
			problem: null,
			expectedLastCharacter: null,
			stateCode: '19',
			pan: 'AAHFS7782K',
			taxType: 'intra_state',
			sameGstin: null,
			samePan: [{ id: 's2', name: 'Branch', gstin: '10AAHFS7782K1Z1' }],
		});
		expect(page.canSave()).toBe(true);
		expect(page.samePan()).toHaveLength(1);
		expect(page.taxKey()).toBe('tax_cgst_sgst');
	});

	it('saves and opens the supplier; a refusal shows beside the field', async () => {
		const saveSupplier = vi
			.fn()
			.mockReturnValueOnce(of({ id: 'sup_7' }))
			.mockReturnValueOnce(
				throwError(() =>
					httpError(400, [{ code: 'gstin_taken', message: 'Already saved as X.', path: ['gstin_taken'] }]),
				),
			);
		const { page, router, toasts } = render(SupplierForm, { saveSupplier });
		page.form.patchValue({ kind: 'unregistered', legalName: 'A', line: 'B', pin: '700001' });
		await page.save();
		expect(router.navigate).toHaveBeenCalledWith(['/suppliers', 'sup_7']);
		expect(toasts.showSuccess).toHaveBeenCalledWith('supplier_created');
		await page.save();
		expect(page.serverErrors()['gstin']).toBe('Already saved as X.');
		expect(toasts.showError).toHaveBeenCalledWith('Already saved as X.');
	});

	it('loads a supplier to edit', async () => {
		const supplier = vi.fn(() => of({ ...row(), shortName: 'Banaras Silk Weavers Co-op' }));
		const checkGstin = vi.fn(() => of(null));
		const { page } = render(SupplierForm, { supplier, checkGstin }, 'sup_1');
		await new Promise((resolve) => setTimeout(resolve));
		expect(supplier).toHaveBeenCalledWith('sup_1');
		expect(page.form.controls.legalName.value).toBe('Banaras Silk Weavers Co-operative Society Ltd');
		expect(page.gstinValue()).toBe('09AABCB4521R1Z6');
	});
});

describe('supplier page (s03)', () => {
	const statementRow = (kind: SupplierStatementRow['kind']): SupplierStatementRow => ({
		date: '2026-10-02',
		kind,
		documentId: 'doc_1',
		documentNumber: 'PE/26-27/000009',
		details: '',
		billINR: 0,
		paidOrCreditedINR: 0,
		balanceINR: 0,
	});

	it('links each statement row to its document', () => {
		expect(statementLink(statementRow('bill'))).toEqual(['/purchase-entries', 'doc_1']);
		expect(statementLink(statementRow('payment'))).toEqual(['/purchase-entries', 'doc_1']);
		expect(statementLink(statementRow('debit_note'))).toEqual(['/purchase-returns', 'doc_1']);
		expect(statementLink(statementRow('claim_written_off'))).toEqual(['/purchase-returns', 'doc_1']);
	});

	it('records a payment against the oldest due unpaid bill, and says when nothing is owed', async () => {
		summary.set({ supplier: row(), statement: [statementRow('bill'), statementRow('payment')] });
		const entries = vi
			.fn()
			.mockReturnValueOnce(
				of({
					items: [
						{
							id: 'e2',
							number: 'PE/2',
							billNumber: 'B2',
							status: 'posted',
							dueOn: '2026-12-12',
							totalINR: 100,
							paidINR: 0,
							leftINR: 100,
						},
						{
							id: 'e1',
							number: 'PE/1',
							billNumber: 'B1',
							status: 'posted',
							dueOn: '2026-11-20',
							totalINR: 50,
							paidINR: 10,
							leftINR: 40,
						},
						{
							id: 'e3',
							number: null,
							billNumber: 'B3',
							status: 'draft',
							dueOn: '2026-11-01',
							totalINR: 9,
							paidINR: 0,
							leftINR: 0,
						},
					],
				}),
			)
			.mockReturnValueOnce(of({ items: [] }));
		const popup = { start: vi.fn() };
		const { page, modals, toasts } = render(SupplierPage, { entries }, 'sup_1');
		modals.open.mockReturnValue({ componentInstance: popup, result: Promise.resolve({ id: 'e1' }) });
		expect(page.payments()).toHaveLength(1);
		await page.recordPayment();
		expect(popup.start.mock.calls[0][0].map((bill: { id: string }) => bill.id)).toEqual(['e1', 'e2']);
		expect(toasts.showSuccess).toHaveBeenCalledWith('payment_saved');
		await page.recordPayment();
		expect(toasts.showSuccess).toHaveBeenCalledWith('supplier_nothing_to_pay');
	});
});

describe('PaymentPopup (p11)', () => {
	const bills = [
		{ id: 'e1', number: 'PE/26-27/000014', billNumber: 'BSW/0418', totalINR: 183750, paidINR: 0, leftINR: 183750 },
		{
			id: 'e2',
			number: 'PE/26-27/000012',
			billNumber: 'SFP-2588',
			totalINR: 91250,
			paidINR: 50000,
			leftINR: 41250,
		},
	];

	it('reads rupees as typed', () => {
		expect(parseRupees('1,83,750')).toBe(183750);
		expect(parseRupees('₹ 9295.61')).toBe(9295.61);
		expect(parseRupees('12.345')).toBeNull();
		expect(parseRupees('-5')).toBeNull();
	});

	it('fills what is left, refuses more than that, and switches bills', () => {
		const { page } = render(PaymentPopup, {});
		page.start(bills);
		expect(page.amount()).toBe('183750');
		expect(page.canSave()).toBe(true);
		page.amount.set('200000');
		expect(page.amountProblem()).toBe('payment_amount_over');
		expect(page.canSave()).toBe(false);
		page.amount.set('abc');
		expect(page.amountProblem()).toBe('payment_amount_invalid');
		page.choose('e2');
		expect(page.amount()).toBe('41250');
	});

	it('saves a part payment and closes with the entry; a refusal stays in the popup', async () => {
		// Every payment gets its own payment voucher (accounts brief D4, decision D5): saved through that endpoint.
		const payPurchaseEntry = vi
			.fn()
			.mockReturnValueOnce(
				of({ entry: { id: 'e1', paymentStatus: 'part_paid' }, voucher: { number: 'PV/26-27/000006' } }),
			)
			.mockReturnValueOnce(
				throwError(() =>
					httpError(400, [
						{
							code: 'books_closed',
							message: 'Books are closed up to 31 Oct 2026.',
							path: ['books_closed'],
						},
					]),
				),
			);
		const { page } = render(PaymentPopup, {});
		Object.assign(TestBed.inject(SelfInvoicesGateway), { payPurchaseEntry });
		const close = TestBed.inject(NgbActiveModal).close as ReturnType<typeof vi.fn>;
		page.start(bills, 'e1');
		page.amount.set('1,00,000');
		page.mode.set('upi');
		page.reference.set('  UPI123  ');
		await page.save();
		expect(payPurchaseEntry).toHaveBeenCalledWith(
			'e1',
			expect.objectContaining({ amountINR: 100000, mode: 'upi', reference: 'UPI123', proofAssetId: null }),
		);
		expect(close).toHaveBeenCalledWith({ id: 'e1', paymentStatus: 'part_paid' });
		await page.save();
		expect(page.error()).toBe('Books are closed up to 31 Oct 2026.');
	});
});

describe('purchasing words', () => {
	const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key);
	const count = (key: string, n: number) => `${n} ${key}`;
	const ret = (over: Record<string, unknown>) =>
		({ status: 'sent', settledINR: 0, settlements: [], origin: 'manual', reason: 'wrong_item', ...over }) as never;

	it('counts pieces and metres apart', () => {
		const lines = [
			{ quantity: 6, soldBy: 'piece' as const },
			{ quantity: 125, soldBy: 'metre' as const },
		];
		expect(piecesOf(lines)).toBe(6);
		expect(linesQuantity(lines, count, t, 'en')).toBe('6 qty_pieces and unit_metres:{"value":"12.5"}');
		expect(linesQuantity([], count, t, 'en')).toBe('0 qty_pieces');
	});

	it('names a return state the way r01 does', () => {
		expect(returnStatus(ret({ status: 'draft' }), t)).toEqual({ pill: 'draft', label: 'pr_status_draft' });
		expect(returnStatus(ret({}), t).label).toBe('pr_status_waiting');
		expect(returnStatus(ret({ settledINR: 10 }), t).label).toBe('pr_status_part_settled');
		expect(
			returnStatus(ret({ status: 'settled', settlements: [{ how: 'credit_note', reference: 'DHS-CN-14' }] }), t)
				.label,
		).toBe('pr_status_settled_how:{"how":"settled_how_credit_note DHS-CN-14"}');
		expect(returnWhy(ret({ origin: 'goods_check', reason: 'damaged_on_arrival' }), t)).toBe(
			'pr_reason_damaged_on_arrival · pr_made_by_goods_check',
		);
	});
});
