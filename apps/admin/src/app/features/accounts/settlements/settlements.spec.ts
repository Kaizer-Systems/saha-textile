import { signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { BanksGateway } from '@core/accounts/banks.gateway';
import { SettlementsGateway } from '@core/accounts/settlements.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { accountsRange } from '@features/accounts/accounts-period';

import { SettlementImportPopup } from './settlement-import-popup';
import { SettlementView } from './settlement-view';
import { SETTLEMENT_TABS, SettlementsPage } from './settlements-page';

/** Settlements (accounts brief Q10): the page, a payout's view and importing a payout file. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};

const payoutRow = (over: Record<string, unknown> = {}) => ({
	reference: 'T1',
	orderId: 'ord_1',
	orderNumber: 'SO-1',
	paymentId: 'pay_1',
	grossPaise: 118_000,
	chargesPaise: 2_360,
	gstPaise: 425,
	...over,
});
const UNMATCHED = payoutRow({ reference: 'T2', orderId: null, orderNumber: null, paymentId: null });
const settlement = (over: Record<string, unknown> = {}) => ({
	id: 'stl_1',
	kind: 'gateway',
	provider: 'CCAvenue',
	payoutReference: 'UTR1',
	date: '2026-11-24',
	bankAccountId: 'bank_1',
	rows: [payoutRow(), UNMATCHED],
	grossPaise: 236_000,
	chargesPaise: 4_720,
	gstPaise: 850,
	netPaise: 230_430,
	matched: 1,
	voucherId: 'jv_1',
	fileName: 'payout.csv',
	createdAt: '2026-11-25T06:00:00.000Z',
	createdBy: null,
	...over,
});
const LIST = {
	items: [settlement(), settlement({ id: 'stl_2', payoutReference: 'UTR2', rows: [payoutRow()], matched: 1 })],
	total: 45,
	counts: { gateway: 2, cod: 1 },
	unsettled: [
		{
			paymentId: 'pay_9',
			orderId: 'ord_9',
			gateway: 'CCAvenue',
			reference: null,
			receivedOn: '2026-11-10',
			amountINR: 1_500,
		},
		{
			paymentId: 'pay_8',
			orderId: 'ord_8',
			gateway: 'CCAvenue',
			reference: 'CC-778',
			receivedOn: '2026-11-11',
			amountINR: 990,
		},
	],
};
const EMPTY = { items: [], total: 0, counts: {}, unsettled: [] };

function mount<T>(component: Type<T>, settlements: Record<string, unknown>) {
	TestBed.resetTestingModule();
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const active = { close: vi.fn(), dismiss: vi.fn() };
	const queries = new QueryClient();
	const invalidate = vi.spyOn(queries, 'invalidateQueries');
	const opened: { componentInstance: { start: ReturnType<typeof vi.fn> } }[] = [];
	let result: Promise<unknown> = Promise.resolve(true);
	TestBed.configureTestingModule({
		imports: [
			component,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(queries),
			provideRouter([]),
			{ provide: SettlementsGateway, useValue: settlements },
			{
				provide: BanksGateway,
				useValue: { list: vi.fn(() => of({ items: [{ id: 'bank_1', shortName: 'HDFC 1234' }] })) },
			},
			{ provide: NotificationService, useValue: notifier },
			{ provide: AuthStore, useValue: { permissions: signal(['accounts.index', 'accounts.edit']) } },
			{ provide: NgbActiveModal, useValue: active },
			{
				provide: NgbModal,
				useValue: {
					open: vi.fn(() => {
						const ref = { componentInstance: { start: vi.fn() }, result };
						opened.push(ref);
						return ref;
					}),
				},
			},
		],
	});
	const fixture = TestBed.createComponent(component);
	fixture.detectChanges();
	return {
		fixture,
		page: fixture.componentInstance,
		notifier,
		active,
		invalidate,
		opened,
		closeWith: (value: Promise<unknown>): void => {
			result = value;
		},
	};
}

const element = (fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as HTMLElement | null;

describe('the Settlements page', () => {
	it('lists the period’s payouts, flags unpaid gateway payments and opens a payout to see or print', async () => {
		const list = vi.fn(() => of(LIST));
		const { fixture, page, opened } = mount(SettlementsPage, { list });
		await settle(fixture);
		expect([...SETTLEMENT_TABS]).toEqual(['gateway', 'cod']);
		expect(list).toHaveBeenCalledWith({
			kind: 'gateway',
			...accountsRange({ period: 'this_month' }),
			page: 1,
			pageSize: 20,
		});
		expect(page.rows()).toHaveLength(2);
		const unsettled = element(fixture, '#stl_unsettled')?.textContent ?? '';
		expect(unsettled).toContain('—');
		expect(unsettled).toContain('CC-778');
		expect(page.allMatched(LIST.items[0] as never)).toBe(false);
		expect(page.allMatched(LIST.items[1] as never)).toBe(true);
		expect(fixture.nativeElement.querySelectorAll('.status-pending')).toHaveLength(1);
		expect(fixture.nativeElement.querySelectorAll('.status-success')).toHaveLength(1);
		expect(element(fixture, 'app-pagination')).not.toBeNull();
		expect(element(fixture, '#stl_tab_cod')?.textContent).toContain('1');

		(element(fixture, 'button[title="view"]') as HTMLButtonElement).click();
		expect(opened[0]?.componentInstance.start).toHaveBeenCalledWith(LIST.items[0], false);
		(element(fixture, 'button[title="stl_print"]') as HTMLButtonElement).click();
		expect(opened[1]?.componentInstance.start).toHaveBeenCalledWith(LIST.items[0], true);
		expect(page.rupees(118_000)).toContain('1,180');
		expect(page.day('2026-11-24')).toBeTruthy();
	});

	it('goes back to the first page on a new kind or period', async () => {
		const list = vi.fn(() => of(LIST));
		const { fixture, page } = mount(SettlementsPage, { list });
		await settle(fixture);
		page.page.set(3);
		(element(fixture, '#stl_tab_cod') as HTMLButtonElement).click();
		await settle(fixture);
		expect(page.kind()).toBe('cod');
		expect(page.page()).toBe(1);
		expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'cod', page: 1 }));
		page.page.set(2);
		page.setPeriod({ period: 'custom', from: '2026-10-01', to: '2026-10-31' });
		await settle(fixture);
		expect(page.page()).toBe(1);
		expect(list).toHaveBeenLastCalledWith(
			expect.objectContaining({ kind: 'cod', from: '2026-10-01', to: '2026-10-31', page: 1 }),
		);
	});

	it('says so when a period has no payouts, with no warning and no pages', async () => {
		const { fixture, page } = mount(SettlementsPage, { list: vi.fn(() => of(EMPTY)) });
		expect(page.rows()).toEqual([]);
		await settle(fixture);
		expect(element(fixture, '#stl_unsettled')).toBeNull();
		expect(element(fixture, 'app-pagination')).toBeNull();
		expect(fixture.nativeElement.textContent).toContain('stl_empty');
		expect(element(fixture, '#stl_tab_gateway')?.textContent).toContain('0');
	});

	it('imports a payout file for the kind shown, and reads the list again only once something was saved', async () => {
		const harness = mount(SettlementsPage, { list: vi.fn(() => of(EMPTY)) });
		await settle(harness.fixture);
		harness.page.setKind('cod');
		(element(harness.fixture, '#stl_import') as HTMLButtonElement).click();
		await settle(harness.fixture);
		expect(harness.opened[0]?.componentInstance.start).toHaveBeenCalledWith('cod');
		expect(harness.invalidate).toHaveBeenCalledWith({ queryKey: ['settlements'] });
		harness.invalidate.mockClear();

		harness.closeWith(Promise.resolve(false));
		await harness.page.importFile();
		const closed = Promise.reject(new Error('dismissed'));
		void closed.catch(() => undefined);
		harness.closeWith(closed);
		await harness.page.importFile();
		expect(harness.opened).toHaveLength(3);
		expect(harness.invalidate).not.toHaveBeenCalled();
	});
});

describe('a payout’s view', () => {
	it('shows the payout’s money and rows, an unmatched row in red, and prints', () => {
		const { fixture, page } = mount(SettlementView, {});
		expect(element(fixture, '#stl_view_title')).toBeNull();
		page.start(settlement() as never, false);
		fixture.detectChanges();
		expect(element(fixture, '#stl_view_title')).not.toBeNull();
		const cells = [...fixture.nativeElement.querySelectorAll('tbody td')] as HTMLElement[];
		expect(cells[1]?.textContent).toContain('SO-1');
		expect(cells[1]?.classList.contains('text-danger')).toBe(false);
		expect(cells[5]?.textContent).toContain('stl_not_matched');
		expect(cells[5]?.classList.contains('text-danger')).toBe(true);
		const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
		(element(fixture, '#stl_view_print') as HTMLButtonElement).click();
		expect(print).toHaveBeenCalledTimes(1);
		print.mockRestore();
	});

	it('prints by itself once the rows are drawn when opened to print', async () => {
		const { page } = mount(SettlementView, {});
		const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
		page.start(settlement() as never, true);
		expect(print).not.toHaveBeenCalled();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(print).toHaveBeenCalledTimes(1);
		print.mockRestore();
	});
});

const csv = (name: string, text: string) => ({ name, text: async () => text }) as unknown as File;
const CCAVENUE_FILE = [
	'CCAvenue settlement report,,',
	'Settlement Date,UTR No,Tracking ID,Order No,Txn Amount,TDR,GST',
	'2026-11-24,UTR1,T1,SO-1,"1,180.00",23.60,4.25',
	'2026-11-24,UTR1,T2,SO-2,500.00,10.00,1.80',
	'2026-11-24,,T3,SO-3,100.00,2.00,0.36',
].join('\n');
const PREVIEW = {
	payouts: [
		{ ...settlement(), already: false },
		{ ...settlement({ payoutReference: 'UTR0' }), already: true },
	],
};

describe('importing a payout file', () => {
	it('starts on the kind it is opened for, with that kind’s usual provider', async () => {
		const { fixture, page } = mount(SettlementImportPopup, {});
		await settle(fixture);
		page.start('cod');
		expect([page.kind(), page.provider()]).toEqual(['cod', 'Shiprocket']);
		(element(fixture, '#stl_kind_gateway') as HTMLInputElement).dispatchEvent(new Event('change'));
		expect([page.kind(), page.provider()]).toEqual(['gateway', 'CCAvenue']);
		fixture.detectChanges();
		expect(fixture.nativeElement.querySelectorAll('#stl_bank option')).toHaveLength(2);
	});

	it('refuses a file that is not CSV and an empty one, and does nothing with no file', async () => {
		const { page } = mount(SettlementImportPopup, {});
		await page.readFile(null);
		await page.readFile(undefined);
		expect(page.fileName()).toBe('');
		await page.readFile(csv('payout.pdf', 'x'));
		expect([page.fileName(), page.problem(), page.table()]).toEqual(['payout.pdf', 'import_csv_only', []]);
		await page.readFile(csv('empty.csv', ''));
		expect(page.problem()).toBe('bank_import_empty');
	});

	it('reads a CCAvenue file: the heading, each column, the date format and the rows it cannot read', async () => {
		const { fixture, page } = mount(SettlementImportPopup, {});
		await page.readFile(csv('ccavenue.CSV', CCAVENUE_FILE));
		fixture.detectChanges();
		expect(page.problem()).toBeNull();
		expect(page.headingAt()).toBe(1);
		expect(page.heading()).toHaveLength(7);
		expect(page.columns()).toEqual({ payoutReference: 1, date: 0, reference: 2, gross: 4, charges: 5, gst: 6 });
		expect(page.dateFormat()).toBe('YYYY-MM-DD');
		expect(page.read().rows).toHaveLength(2);
		expect(page.read().problems).toEqual([5]);
		expect(fixture.nativeElement.textContent).toContain('stl_rows_skipped');
		const gst = element(fixture, '#stl_col_gst') as HTMLSelectElement;
		expect([...gst.options].map((option) => option.value)).toEqual(['', '0', '1', '2', '3', '4', '5', '6']);

		page.setColumn('gst', '');
		expect(page.columns().gst).toBeNull();
		page.setColumn('gst', '6');
		expect(page.columns().gst).toBe(6);
	});

	it('falls back to the short date format with no date column, or no row under the heading', async () => {
		const { page } = mount(SettlementImportPopup, {});
		await page.readFile(csv('cod.tsv', 'UTR,Order No,Amount\nRM-1,SO-1,100'));
		expect(page.columns().date).toBeNull();
		expect(page.dateFormat()).toBe('DD/MM/YY');
		await page.readFile(csv('heading.txt', 'Settlement Date,UTR No,Tracking ID'));
		expect(page.columns().date).toBe(0);
		expect(page.dateFormat()).toBe('DD/MM/YY');
		expect(page.read().rows).toEqual([]);
	});

	it('is ready with a bank account, a provider and a row read, and checks the file with the API', async () => {
		const preview = vi.fn(() => of(PREVIEW));
		const { fixture, page } = mount(SettlementImportPopup, { preview });
		await settle(fixture);
		await page.readFile(csv('ccavenue.csv', CCAVENUE_FILE));
		expect(page.ready()).toBe(false);
		await page.check();
		expect(preview).not.toHaveBeenCalled();
		page.bankAccountId.set('bank_1');
		page.provider.set(' C ');
		expect(page.ready()).toBe(false);
		page.provider.set('  CCAvenue  ');
		expect(page.ready()).toBe(true);
		fixture.detectChanges();
		(element(fixture, '#stl_check') as HTMLButtonElement).click();
		await settle(fixture);
		expect(preview).toHaveBeenCalledWith({
			kind: 'gateway',
			provider: 'CCAvenue',
			bankAccountId: 'bank_1',
			fileName: 'ccavenue.csv',
			rows: page.read().rows,
		});
		expect(page.step()).toBe('check');
		expect(page.preview()).toEqual(PREVIEW);
		expect(page.fresh()).toBe(1);
		expect(page.busy()).toBe(false);
		expect(fixture.nativeElement.textContent).toContain('stl_already');
		expect((element(fixture, '#stl_save') as HTMLButtonElement).disabled).toBe(false);

		(element(fixture, '#stl_back') as HTMLButtonElement).click();
		expect(page.step()).toBe('map');
	});

	it('names the API’s refusal by its code, or says it failed', async () => {
		const preview = vi
			.fn()
			.mockReturnValueOnce(throwError(() => ({ error: { message: 'settlement_net_negative:UTR1' } })))
			.mockReturnValueOnce(throwError(() => new Error('down')));
		const { page } = mount(SettlementImportPopup, { preview });
		await page.readFile(csv('ccavenue.csv', CCAVENUE_FILE));
		page.bankAccountId.set('bank_1');
		await page.check();
		expect([page.problem(), page.step(), page.busy()]).toEqual([
			'stl_problem_settlement_net_negative',
			'map',
			false,
		]);
		await page.check();
		expect(page.problem()).toBe('stl_problem_failed');
	});

	it('saves the new payouts, says how many, and closes', async () => {
		const imported = vi.fn(() => of({ saved: [settlement()], skipped: ['UTR0'] }));
		const harness = mount(SettlementImportPopup, { preview: vi.fn(() => of(PREVIEW)), import: imported });
		await settle(harness.fixture);
		await harness.page.readFile(csv('ccavenue.csv', CCAVENUE_FILE));
		harness.page.bankAccountId.set('bank_1');
		await harness.page.check();
		harness.fixture.detectChanges();
		(element(harness.fixture, '#stl_save') as HTMLButtonElement).click();
		await settle(harness.fixture);
		expect(imported).toHaveBeenCalledWith(
			expect.objectContaining({ bankAccountId: 'bank_1', fileName: 'ccavenue.csv' }),
		);
		expect(harness.notifier.showSuccess).toHaveBeenCalledWith('stl_saved');
		expect(harness.active.close).toHaveBeenCalledWith(true);
	});

	it('keeps the popup open with the reason when saving is refused, and offers no save when every payout is in', async () => {
		const harness = mount(SettlementImportPopup, {
			preview: vi.fn(() => of({ payouts: [{ ...settlement(), already: true }] })),
			import: vi.fn(() => throwError(() => ({ error: { message: 'settlement_bank_missing' } }))),
		});
		await harness.page.readFile(csv('ccavenue.csv', CCAVENUE_FILE));
		harness.page.bankAccountId.set('bank_1');
		await harness.page.check();
		harness.fixture.detectChanges();
		expect(harness.page.fresh()).toBe(0);
		expect((element(harness.fixture, '#stl_save') as HTMLButtonElement).disabled).toBe(true);
		await harness.page.save();
		expect(harness.page.problem()).toBe('stl_problem_settlement_bank_missing');
		expect(harness.active.close).not.toHaveBeenCalled();
		expect(harness.page.rupees(50_000)).toContain('500');
		expect(harness.page.day('2026-11-24')).toBeTruthy();
	});

	it('counts no fresh payout before a check', () => {
		const { page } = mount(SettlementImportPopup, {});
		expect(page.fresh()).toBe(0);
		expect(page.heading()).toEqual([]);
	});
});
