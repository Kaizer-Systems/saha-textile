import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { Select2 } from 'ng-select2-component';
import { NEVER, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ExpenseBillsGateway } from '@core/purchasing/expense-bills.gateway';
import { PurchasingGateway } from '@core/purchasing/purchasing.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { ExpenseBillFormPage, blankExpenseLine, expenseLineWrite, type ExpenseFormLine } from './bill-form';

import type { ReasonAsk } from '@features/purchasing/shared/reason-popup';
import type { ExpenseBill } from '@saha-textile/contracts';

/** Purchases › Expense bills › New and one bill (brief 25 EB1): the supplier, the lines, the tax, save, post, cancel. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const refusal = (message: string) => ({ error: { message } });
const supplier = (id: string, over: Record<string, unknown> = {}) => ({
	id,
	shortName: '',
	legalName: `Supplier ${id}`,
	gstin: '19AAPFU0939F1ZV',
	stateName: 'West Bengal',
	active: true,
	...over,
});
const SUPPLIERS = [
	supplier('sup_wb', { shortName: 'Bose' }),
	supplier('sup_ka', { gstin: '29AAPFU0939F1ZV', stateName: 'Karnataka' }),
	supplier('sup_none', { gstin: null }),
	supplier('sup_old', { active: false }),
];
const OPTIONS = {
	locations: [
		{ id: 'loc_b', name: 'Barasat', stateCode: '19', gstin: '19DBYPS6736R1ZZ', composition: false },
		{ id: 'loc_c', name: 'Counter', stateCode: '19', gstin: null, composition: true },
	],
	ledgers: [
		{ id: 'rent', name: 'Rent' },
		{ id: 'power', name: 'Electricity' },
	],
};
const line = (over: Partial<ExpenseFormLine> = {}): ExpenseFormLine => ({
	...blankExpenseLine(),
	expenseLedgerId: 'rent',
	what: 'Shop rent',
	taxable: '50,000',
	...over,
});
const saved = (over: Partial<ExpenseBill> = {}): ExpenseBill =>
	({
		id: 'eb_1',
		number: null,
		supplierId: 'sup_wb',
		supplierName: 'Bose',
		billNumber: 'BP-77',
		billDate: '2026-11-20',
		locationId: 'loc_b',
		lines: [
			{
				expenseLedgerId: 'rent',
				what: 'Shop rent',
				sac: '997212',
				taxableINR: 50_000,
				gstRatePct: 18,
				credit: 'claim',
				blockedClause: '',
			},
		],
		note: 'November',
		status: 'draft',
		interState: false,
		taxableINR: 50_000,
		cgstINR: 4_500,
		sgstINR: 4_500,
		igstINR: 0,
		blockedTaxINR: 0,
		totalINR: 59_000,
		voucherId: null,
		postedAt: null,
		postedBy: null,
		createdAt: '2026-11-20T06:00:00.000Z',
		updatedAt: '2026-11-20T06:00:00.000Z',
		version: 2,
		...over,
	}) as ExpenseBill;

interface Mounted {
	gateway: Record<string, ReturnType<typeof vi.fn>>;
	asked: ReasonAsk[];
	answer: { value: unknown };
}

function mount(
	options: { id?: string; bill?: ExpenseBill | null; permissions?: string[]; gateway?: Record<string, unknown> } = {},
) {
	TestBed.resetTestingModule();
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const invalidate = vi.spyOn(queries, 'invalidateQueries');
	// The server's copy: what the last write left, read back by get.
	let current = options.bill === null ? null : (options.bill ?? saved());
	const keep = (bill: ExpenseBill) => of((current = bill));
	const gateway = {
		get: vi.fn(() => (current ? of(current) : NEVER)),
		form: vi.fn(() => of(OPTIONS)),
		create: vi.fn((write: object) => keep(saved({ ...write, id: 'eb_9', version: 0 }))),
		update: vi.fn((id: string, write: object, version: number) =>
			keep(saved({ ...write, id, version: version + 1 })),
		),
		post: vi.fn((id: string) =>
			keep(saved({ ...current, id, number: 'EB/26-27/000007', status: 'posted', version: 9 })),
		),
		cancel: vi.fn((id: string) => keep(saved({ ...current, id, status: 'cancelled', version: 10 }))),
		...options.gateway,
	} as Record<string, ReturnType<typeof vi.fn>>;
	const asked: ReasonAsk[] = [];
	const answer = { value: undefined as unknown };
	TestBed.configureTestingModule({
		imports: [
			ExpenseBillFormPage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(queries),
			provideRouter([]),
			{
				provide: ActivatedRoute,
				useValue: { paramMap: of(convertToParamMap(options.id ? { id: options.id } : {})) },
			},
			{ provide: ExpenseBillsGateway, useValue: gateway },
			{ provide: PurchasingGateway, useValue: { suppliers: vi.fn(() => of({ items: SUPPLIERS, total: 4 })) } },
			{ provide: NotificationService, useValue: notifier },
			{
				provide: AuthStore,
				useValue: {
					permissions: signal(options.permissions ?? ['accounts.index', 'accounts.edit', 'accounts.post']),
				},
			},
			{
				provide: NgbModal,
				useValue: {
					// The reason pop-up: confirming runs its act with a reason, as the pop-up does.
					open: vi.fn(() => {
						let ask: ReasonAsk | null = null;
						return {
							componentInstance: { start: (given: ReasonAsk) => ((ask = given), asked.push(given)) },
							result: Promise.resolve().then(async () =>
								answer.value === undefined
									? (ask as unknown as ReasonAsk).act('Entered twice')
									: answer.value,
							),
						};
					}),
				},
			},
		],
	});
	// The supplier picker is ng-select2; the page takes its search and its choice through searchSuppliers and chooseSupplier.
	TestBed.overrideComponent(ExpenseBillFormPage, {
		remove: { imports: [Select2] },
		add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
	});
	const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
	const fixture = TestBed.createComponent(ExpenseBillFormPage);
	fixture.detectChanges();
	const mounted: Mounted = { gateway, asked, answer };
	return { fixture, page: fixture.componentInstance, notifier, invalidate, navigate, queries, ...mounted };
}
async function opened(options: Parameters<typeof mount>[0] = {}) {
	const harness = mount(options);
	await settle(harness.fixture);
	return harness;
}

const el = <T extends HTMLElement = HTMLElement>(fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as T | null;
const enter = async (
	fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void },
	box: Element | null,
	value: string,
) => {
	(box as HTMLInputElement).value = value;
	box?.dispatchEvent(new Event(box instanceof HTMLSelectElement ? 'change' : 'input'));
	await settle(fixture);
};
/** A new bill ready to save: Bose in West Bengal, billed to Barasat, one rent line. */
async function filled() {
	const harness = await opened();
	const { page, fixture } = harness;
	page.chooseSupplier({ value: 'sup_wb' } as never);
	page.billNumber.set(' BP-77 ');
	page.billDate.set('2026-11-20');
	page.locationId.set('loc_b');
	page.lines.set([line({ sac: ' 997212 ' })]);
	page.note.set(' November ');
	await settle(fixture);
	return harness;
}

describe('an expense line as the form holds it, and as the API takes it (EB1)', () => {
	it('starts empty at 18% with the credit claimed', () => {
		expect(blankExpenseLine()).toEqual({
			expenseLedgerId: '',
			what: '',
			sac: '',
			taxable: '',
			gstRatePct: 18,
			credit: 'claim',
			blockedClause: '',
		});
	});

	it('trims and reads the line, keeps a clause only on blocked credit, and blocks every line of a composition bill', () => {
		expect(expenseLineWrite(line({ what: ' Rent ', sac: ' 997212 ', blockedClause: '17(5)(b)' }), false)).toEqual({
			expenseLedgerId: 'rent',
			what: 'Rent',
			sac: '997212',
			taxableINR: 50_000,
			gstRatePct: 18,
			credit: 'claim',
			blockedClause: '',
		});
		expect(expenseLineWrite(line({ credit: 'blocked', blockedClause: ' 17(5)(b) ' }), false)).toMatchObject({
			credit: 'blocked',
			blockedClause: '17(5)(b)',
		});
		expect(expenseLineWrite(line({ blockedClause: ' 10(4) ' }), true)).toMatchObject({
			credit: 'blocked',
			blockedClause: '10(4)',
		});
		expect(expenseLineWrite(line({ taxable: 'fifty' }), false).taxableINR).toBe(0);
	});
});

describe('a new expense bill (EB1)', () => {
	it('opens empty on today at draft, with the locations, ledgers and active suppliers to pick from', async () => {
		const { fixture, page, gateway } = await opened();
		expect(gateway['get']).not.toHaveBeenCalled();
		expect([page.id(), page.status(), page.readOnly(), page.billDate()]).toEqual(['', 'draft', false, page.today]);
		expect(page.lines()).toEqual([blankExpenseLine()]);
		expect(page.supplierOptions()).toEqual([
			{ value: 'sup_wb', label: 'Bose' },
			{ value: 'sup_ka', label: 'Supplier sup_ka' },
			{ value: 'sup_none', label: 'Supplier sup_none' },
		]);
		expect(
			[...(el<HTMLSelectElement>(fixture, '#eb_location')?.options ?? [])].map((o) => o.textContent?.trim()),
		).toContain('Counter · eb_no_gstin');
		expect([...(el<HTMLSelectElement>(fixture, '#eb_ledger_0')?.options ?? [])].map((o) => o.value)).toEqual([
			'',
			'rent',
			'power',
		]);
		expect(el(fixture, 'h5.mb-1')?.textContent).toContain('eb_new');
		expect(el<HTMLButtonElement>(fixture, '#eb_save')?.disabled).toBe(true);
		expect(el(fixture, '#eb_cancel')).toBeNull();
	});

	it('takes the supplier picked and the search typed, keeping a chosen supplier listed though inactive', async () => {
		const { fixture, page } = await opened();
		page.searchSuppliers({ search: 'old' } as never);
		expect(page.supplierSearch()).toBe('old');
		page.searchSuppliers({} as never);
		expect(page.supplierSearch()).toBe('');
		page.chooseSupplier({ value: 'sup_old' } as never);
		await settle(fixture);
		expect(page.supplier()?.id).toBe('sup_old');
		expect(page.supplierOptions()).toContainEqual({ value: 'sup_old', label: 'Supplier sup_old' });
		expect(el(fixture, '.help-text')?.textContent).toContain('19AAPFU0939F1ZV · West Bengal');
		page.chooseSupplier({ value: ['sup_wb'] } as never);
		expect(page.supplierId()).toBe('');
	});

	it('works out CGST and SGST within the State, IGST from another, and blocked tax into the expense', async () => {
		const { fixture, page } = await filled();
		expect(page.interState()).toBe(false);
		expect(page.lineTax(0)).toBe(`18%: CGST ${page.inr(4_500)} · SGST ${page.inr(4_500)}`);
		expect(el(fixture, '#eb_total')?.textContent?.trim()).toBe(page.inr(59_000));
		page.chooseSupplier({ value: 'sup_ka' } as never);
		await settle(fixture);
		expect(page.interState()).toBe(true);
		expect(page.lineTax(0)).toBe(`18%: IGST ${page.inr(9_000)}`);
		expect(fixture.nativeElement.textContent).toContain('eb_input_igst');
		await enter(fixture, el(fixture, '#eb_credit_0'), 'blocked');
		expect(el(fixture, '#eb_clause_0')).not.toBeNull();
		await enter(fixture, el(fixture, '#eb_clause_0'), '17(5)(b)');
		expect(page.totals()).toMatchObject({ igstINR: 0, blockedTaxINR: 9_000, totalINR: 59_000 });
		const rate = el<HTMLSelectElement>(fixture, '#eb_rate_0') as HTMLSelectElement;
		rate.selectedIndex = 0;
		rate.dispatchEvent(new Event('change'));
		await settle(fixture);
		expect(page.lineTax(0)).toBe('—');
		expect(page.lineTax(5)).toBe('—');
	});

	it('blocks the credit of every line billed to a composition location, with a word on why', async () => {
		const { fixture, page } = await filled();
		await enter(fixture, el(fixture, '#eb_location'), 'loc_c');
		expect(page.composition()).toBe(true);
		expect(fixture.nativeElement.textContent).toContain('eb_composition_help');
		expect(el<HTMLSelectElement>(fixture, '#eb_credit_0')?.disabled).toBe(true);
		expect(page.writeLines()[0]?.credit).toBe('blocked');
		expect(page.totals().blockedTaxINR).toBe(9_000);
	});

	it('sends a supplier without a GSTIN charging GST to a self-invoice, and holds the bill', async () => {
		const { fixture, page } = await filled();
		page.chooseSupplier({ value: 'sup_none' } as never);
		await settle(fixture);
		expect(page.needsSelfInvoice()).toBe(true);
		expect(el(fixture, '#eb_self_invoice a')?.getAttribute('href')).toBe('/accounts/self-invoices/new');
		expect(page.ready()).toBe(false);
		page.setLine(0, { gstRatePct: 0 });
		await settle(fixture);
		expect([page.needsSelfInvoice(), page.ready()]).toEqual([false, true]);
		expect(el(fixture, '#eb_self_invoice')).toBeNull();
	});

	it('is ready only with a supplier, a bill number, a day not after today, a location and every line complete', async () => {
		const { page } = await filled();
		expect(page.ready()).toBe(true);
		const holds: [() => void, () => void][] = [
			[() => page.supplierId.set(''), () => page.supplierId.set('sup_wb')],
			[() => page.billNumber.set('  '), () => page.billNumber.set('BP-77')],
			[() => page.billDate.set(''), () => page.billDate.set('2026-11-20')],
			[() => page.billDate.set('2999-01-01'), () => page.billDate.set('2026-11-20')],
			[() => page.locationId.set('gone'), () => page.locationId.set('loc_b')],
			[() => page.setLine(0, { expenseLedgerId: '' }), () => page.setLine(0, { expenseLedgerId: 'rent' })],
			[() => page.setLine(0, { what: ' ' }), () => page.setLine(0, { what: 'Shop rent' })],
			[() => page.setLine(0, { taxable: '12.345' }), () => page.setLine(0, { taxable: '50000' })],
		];
		for (const [hold, release] of holds) {
			hold();
			expect(page.ready()).toBe(false);
			release();
			expect(page.ready()).toBe(true);
		}
		page.busy.set(true);
		expect(page.ready()).toBe(false);
	});

	it('adds and removes lines, never below one, and edits each line’s fields', async () => {
		const { fixture, page } = await filled();
		(el(fixture, '#eb_add_line') as HTMLButtonElement).click();
		await settle(fixture);
		expect(page.lines()).toHaveLength(2);
		await enter(fixture, el(fixture, '#eb_ledger_1'), 'power');
		await enter(fixture, el(fixture, '#eb_what_1'), 'Electricity');
		await enter(fixture, el(fixture, '#eb_sac_1'), '996912');
		await enter(fixture, el(fixture, '#eb_taxable_1'), '1,200.50');
		expect(page.lines()[1]).toMatchObject({
			expenseLedgerId: 'power',
			what: 'Electricity',
			sac: '996912',
			taxable: '1,200.50',
		});
		expect(page.lines()[0]?.what).toBe('Shop rent');
		(fixture.nativeElement.querySelector('#actions a, #actions button') as HTMLElement).click();
		await settle(fixture);
		expect(page.lines().map((l) => l.what)).toEqual(['Electricity']);
		expect(fixture.nativeElement.querySelector('#actions')).toBeNull();
		page.removeLine(0);
		expect(page.lines()).toHaveLength(1);
	});

	it('saves a new draft, keeps it in the cache and opens it at its own address', async () => {
		const { fixture, page, gateway, notifier, invalidate, navigate, queries } = await filled();
		(el(fixture, '#eb_save') as HTMLButtonElement).click();
		await settle(fixture);
		expect(gateway['create']).toHaveBeenCalledWith({
			supplierId: 'sup_wb',
			billNumber: 'BP-77',
			billDate: '2026-11-20',
			locationId: 'loc_b',
			lines: [expenseLineWrite(line({ sac: '997212' }), false)],
			note: 'November',
		});
		expect(queries.getQueryData(['expense-bills', 'eb_9'])).toMatchObject({ id: 'eb_9' });
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['expense-bills'] });
		expect(notifier.showSuccess).toHaveBeenCalledWith('eb_saved');
		expect(navigate).toHaveBeenCalledWith(['/expense-bills', 'eb_9']);
		expect(page.busy()).toBe(false);
	});

	it('posts a new bill: saves it, posts it with its number, and opens it', async () => {
		const { fixture, gateway, notifier, navigate } = await filled();
		(el(fixture, '#eb_post') as HTMLButtonElement).click();
		await settle(fixture);
		expect(gateway['create']).toHaveBeenCalled();
		expect(gateway['post']).toHaveBeenCalledWith('eb_9');
		expect(notifier.showSuccess).toHaveBeenCalledWith('eb_posted');
		expect(navigate).toHaveBeenCalledWith(['/expense-bills', 'eb_9']);
	});

	it('names the bill’s own refusals and the books’, shows any other message as it came, or says it failed', async () => {
		const create = vi
			.fn()
			.mockReturnValueOnce(throwError(() => refusal('use_self_invoice')))
			.mockReturnValueOnce(throwError(() => refusal('voucher_problem:period_locked')))
			.mockReturnValueOnce(throwError(() => refusal('Bill number taken')))
			.mockReturnValueOnce(throwError(() => new Error('down')));
		const { page, notifier } = await opened({ gateway: { create } });
		await page.save();
		expect(notifier.showError).toHaveBeenLastCalledWith('eb_problem_use_self_invoice');
		await page.save();
		expect(notifier.showError).toHaveBeenLastCalledWith('accounts_problem_period_locked');
		await page.save();
		expect(notifier.showError).toHaveBeenLastCalledWith('Bill number taken');
		await page.save();
		expect(notifier.showError).toHaveBeenLastCalledWith('purchasing_action_failed');
		expect(page.busy()).toBe(false);
	});

	it('offers neither Post nor Cancel to someone who may not post, and is not ready for someone who may not edit', async () => {
		const editor = await opened({ permissions: ['accounts.index', 'accounts.edit'] });
		expect(el(editor.fixture, '#eb_post')).toBeNull();
		expect(el(editor.fixture, '#eb_save')).not.toBeNull();
		const reader = await opened({ permissions: ['accounts.index'] });
		reader.page.chooseSupplier({ value: 'sup_wb' } as never);
		reader.page.billNumber.set('BP-77');
		reader.page.locationId.set('loc_b');
		reader.page.lines.set([line()]);
		expect(reader.page.ready()).toBe(false);
	});
});

describe('a saved expense bill (EB1)', () => {
	it('fills the form from the bill once, and saves the change over the version read, staying on the page', async () => {
		const { fixture, page, gateway, navigate } = await opened({ id: 'eb_1' });
		expect(gateway['get']).toHaveBeenCalledWith('eb_1');
		expect([page.supplierId(), page.supplierSearch(), page.billNumber(), page.locationId(), page.note()]).toEqual([
			'sup_wb',
			'Bose',
			'BP-77',
			'loc_b',
			'November',
		]);
		expect(page.lines()).toEqual([
			{
				expenseLedgerId: 'rent',
				what: 'Shop rent',
				sac: '997212',
				taxable: '50000',
				gstRatePct: 18,
				credit: 'claim',
				blockedClause: '',
			},
		]);
		page.billNumber.set('BP-78');
		await page.save();
		expect(gateway['update']).toHaveBeenCalledWith('eb_1', expect.objectContaining({ billNumber: 'BP-78' }), 2);
		expect(navigate).not.toHaveBeenCalled();
		await settle(fixture);
		expect(page.billNumber()).toBe('BP-78');
		await page.post();
		expect(gateway['update']).toHaveBeenLastCalledWith('eb_1', expect.anything(), 3);
		expect(gateway['post']).toHaveBeenCalledWith('eb_1');
		expect(navigate).not.toHaveBeenCalled();
	});

	it('shows a posted bill read-only with its number, with Cancel and no Save or Post', async () => {
		const { fixture, page } = await opened({
			id: 'eb_1',
			bill: saved({ number: 'EB/26-27/000007', status: 'posted' }),
		});
		expect(page.readOnly()).toBe(true);
		expect(el(fixture, 'h5.mb-1')?.textContent).toContain('EB/26-27/000007');
		expect(el(fixture, 'h5.mb-1 .status-success')).not.toBeNull();
		expect([el(fixture, '#eb_save'), el(fixture, '#eb_post'), el(fixture, '#eb_add_line')]).toEqual([
			null,
			null,
			null,
		]);
		expect(el<HTMLInputElement>(fixture, '#eb_bill_no')?.disabled).toBe(true);
		expect(el(fixture, '#eb_cancel')).not.toBeNull();
	});

	it('cancels a posted bill with a reason, books the opposite, and says so', async () => {
		const { fixture, page, gateway, notifier, asked } = await opened({
			id: 'eb_1',
			bill: saved({ number: 'EB/26-27/000007', status: 'posted' }),
		});
		(el(fixture, '#eb_cancel') as HTMLButtonElement).click();
		await settle(fixture);
		expect(asked[0]).toMatchObject({
			title: 'eb_cancel_title',
			body: 'eb_cancel_body_posted',
			params: { number: 'EB/26-27/000007' },
			confirm: 'eb_cancel',
			confirmClass: 'btn-danger',
		});
		expect(gateway['cancel']).toHaveBeenCalledWith('eb_1', 'Entered twice');
		expect(notifier.showSuccess).toHaveBeenCalledWith('eb_cancelled');
		expect(page.bill.data()?.status).toBe('cancelled');
		expect(el(fixture, '#eb_cancel')).toBeNull();
	});

	it('cancels a draft under its bill number, and hands a refusal to the pop-up in words', async () => {
		const cancel = vi.fn(() => throwError(() => refusal('expense_bill_not_draft')));
		const { page, asked, notifier, answer } = await opened({ id: 'eb_1', gateway: { cancel } });
		answer.value = null;
		await page.cancel();
		await expect((asked[0] as ReasonAsk).act('Entered twice')).rejects.toEqual({
			error: { message: 'eb_problem_expense_bill_not_draft' },
		});
		expect(asked[0]).toMatchObject({ body: 'eb_cancel_body_draft', params: { number: 'BP-77' } });
		expect(notifier.showSuccess).not.toHaveBeenCalled();
	});

	it('does nothing when the pop-up is closed, or before the bill is read', async () => {
		const closed = await opened({ id: 'eb_1' });
		closed.answer.value = null;
		await closed.page.cancel();
		expect(closed.gateway['cancel']).not.toHaveBeenCalled();
		expect(closed.notifier.showSuccess).not.toHaveBeenCalled();
		const unread = mount({ id: 'eb_9', bill: null });
		await unread.page.cancel();
		expect(unread.asked).toEqual([]);
		expect(unread.page.status()).toBe('draft');
	});
});

describe('a new bill whose posting is refused (EB1)', () => {
	it('opens the draft it made, says why, and changes that draft on the next save instead of making another', async () => {
		const post = vi.fn(() => throwError(() => refusal('voucher_problem:period_locked')));
		const { page, gateway, notifier, navigate } = await opened({ gateway: { post } });
		page.chooseSupplier({ value: 'sup_wb' } as never);
		page.billNumber.set('BP-77');
		page.locationId.set('loc_b');
		page.lines.set([line()]);
		await page.post();
		expect(gateway['create']).toHaveBeenCalledTimes(1);
		expect(notifier.showError).toHaveBeenCalledWith('accounts_problem_period_locked');
		expect(navigate).toHaveBeenCalledWith(['/expense-bills', 'eb_9']);
		await page.save();
		expect(gateway['create']).toHaveBeenCalledTimes(1);
		expect(gateway['update']).toHaveBeenCalledWith('eb_9', expect.anything(), 0);
	});

	it('stays put when a saved bill’s step is refused', async () => {
		const post = vi.fn(() => throwError(() => refusal('expense_bill_changed')));
		const { page, notifier, navigate } = await opened({ id: 'eb_1', gateway: { post } });
		await page.post();
		expect(notifier.showError).toHaveBeenCalledWith('eb_problem_expense_bill_changed');
		expect(navigate).not.toHaveBeenCalled();
	});
});
