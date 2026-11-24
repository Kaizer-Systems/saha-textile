import { signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { StatementDateFormat } from '@saha-textile/contracts';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { BanksGateway } from '@core/accounts/banks.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { BankPage } from './bank-page';
import {
	DATE_FORMATS,
	columnsFrom,
	guessDateFormat,
	guessLayout,
	guessRoles,
	linesNet,
	rolesFrom,
	statementEnds,
} from './statement-columns';
import { StatementImportPage, statementProblem } from './statement-import';
import { StatementImportPopup, StatementImportState } from './statement-import-popup';

/** Importing a bank statement (accounts brief BA4–BA6) and the bank page's lines. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};

const HDFC_ROWS = [
	['HDFC BANK Ltd.', 'Statement of account'],
	['Date', 'Narration', 'Chq./Ref.No.', 'Value Dt', 'Withdrawal Amt.', 'Deposit Amt.', 'Closing Balance'],
	['25/11/26', 'NEFT CR CCAVENUE 251126', 'CCAV98240', '25/11/26', '', '98,240.00', '5,32,569.00'],
	['26/11/26', 'SMS ALERT CHG', '', '26/11/26', '59.00', '', '5,32,510.00'],
];

const layout = (patch: Record<string, unknown> = {}) => ({
	id: 'lay_1',
	name: 'HDFC Bank CSV',
	skipRows: 2,
	dateFormat: 'DD/MM/YY',
	money: 'split',
	columns: {
		date: 0,
		description: 1,
		reference: 2,
		withdrawal: 4,
		deposit: 5,
		amount: null,
		drcr: null,
		balance: 6,
		valueDate: 3,
	},
	updatedAt: '2026-11-25T06:00:00.000Z',
	...patch,
});

const previewLine = (patch: Record<string, unknown> = {}) => ({
	row: 3,
	date: '2026-11-25',
	description: 'NEFT CR CCAVENUE 251126',
	reference: 'CCAV98240',
	outPaise: 0,
	inPaise: 9_824_000,
	balancePaise: 53_256_900,
	already: false,
	...patch,
});

describe('matching a statement’s columns (BA5)', () => {
	it('guesses each column from the bank’s headings, once each, and the date format from a sample', () => {
		expect([...DATE_FORMATS]).toEqual([...StatementDateFormat.options]);
		expect(guessRoles(HDFC_ROWS[1]!)).toEqual([
			'date',
			'description',
			'reference',
			'valueDate',
			'withdrawal',
			'deposit',
			'balance',
		]);
		expect(guessRoles(['Txn Date', 'Date', 'Amount', 'Dr/Cr', 'Remarks'])).toEqual([
			'date',
			'skip',
			'amount',
			'drcr',
			'description',
		]);
		expect(['2026-11-25', '25 Nov 2026', '25-11-2026', '25/11/2026', '25/11/26'].map(guessDateFormat)).toEqual([
			'YYYY-MM-DD',
			'DD MMM YYYY',
			'DD-MM-YYYY',
			'DD/MM/YYYY',
			'DD/MM/YY',
		]);
		const guessed = guessLayout(HDFC_ROWS);
		expect(guessed).toMatchObject({ skipRows: 2, dateFormat: 'DD/MM/YY', money: 'split' });
		expect(guessed.columns).toMatchObject({ date: 0, withdrawal: 4, deposit: 5, amount: null, valueDate: 3 });
		const signed = guessLayout([
			['Txn Date', 'Particulars', 'Amount', 'Dr/Cr'],
			['2026-11-25', 'RENT', '60000', 'DR'],
		]);
		expect([signed.skipRows, signed.money, signed.dateFormat]).toEqual([1, 'signed_drcr', 'YYYY-MM-DD']);
		const none = guessLayout([['just', 'words']]);
		expect([none.skipRows, none.columns.date, none.dateFormat]).toEqual([0, null, 'DD/MM/YY']);
		expect(
			guessLayout([
				['Description', 'Amount', 'Date'],
				['RENT', '10'],
			]).dateFormat,
		).toBe('DD/MM/YY');
		expect(guessLayout([['Date', 'Narration', 'Amount']]).skipRows).toBe(1);
	});

	it('turns roles into the layout’s columns and back', () => {
		const columns = columnsFrom(['date', 'skip', 'deposit', 'date']);
		expect(columns).toMatchObject({ date: 0, deposit: 2, withdrawal: null });
		expect(rolesFrom(columns, 4)).toEqual(['date', 'skip', 'deposit', 'skip']);
	});

	it('takes the opening and closing from the balance column, whichever way the bank sorts', () => {
		const older = { date: '2026-11-25', outPaise: 0, inPaise: 1_000, balancePaise: 11_000 };
		const newer = { date: '2026-11-26', outPaise: 500, inPaise: 0, balancePaise: 10_500 };
		expect(statementEnds([])).toEqual({ openingPaise: 0, closingPaise: 0 });
		expect(statementEnds([older, newer])).toEqual({ openingPaise: 10_000, closingPaise: 10_500 });
		expect(statementEnds([newer, older])).toEqual({ openingPaise: 10_000, closingPaise: 10_500 });
		expect(
			statementEnds([
				{ ...older, balancePaise: null },
				{ ...newer, balancePaise: null },
			]),
		).toEqual({
			openingPaise: 0,
			closingPaise: 500,
		});
		expect(linesNet([older, newer])).toBe(500);
	});
});

describe('the import popup (BA4)', () => {
	function popup() {
		TestBed.resetTestingModule();
		const close = vi.fn();
		TestBed.configureTestingModule({
			imports: [StatementImportPopup, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
			providers: [provideRouter([]), { provide: NgbActiveModal, useValue: { close, dismiss: vi.fn() } }],
		});
		const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
		const fixture = TestBed.createComponent(StatementImportPopup);
		fixture.detectChanges();
		return { fixture, page: fixture.componentInstance, close, navigate };
	}
	const file = (name: string, text: string) => ({ name, text: async () => text }) as unknown as File;

	it('reads a CSV in the browser, asks for CSV in place of Excel, and carries the file to the next step', async () => {
		const { fixture, page, close, navigate } = popup();
		page.start({ accounts: [{ id: 'bank_1', shortName: 'HDFC' }] as never, bankAccountId: 'bank_1', layouts: [] });
		expect(page.layoutId()).toBe('');
		page.go();
		expect(close).not.toHaveBeenCalled();
		await page.read(null);
		await page.read(file('Acct_Statement.xlsx', ''));
		expect(page.problem()).toBe('import_csv_only');
		await page.read(file('empty.csv', '\n\n'));
		expect(page.problem()).toBe('bank_import_empty');
		await page.read(file('hdfc.csv', 'Date,Narration\n25/11/26,UPI'));
		expect([page.problem(), page.rows().length, page.ready()]).toEqual([null, 2, true]);
		fixture.detectChanges();
		page.go();
		expect(TestBed.inject(StatementImportState).read()).toEqual({
			bankAccountId: 'bank_1',
			fileName: 'hdfc.csv',
			rows: [
				['Date', 'Narration'],
				['25/11/26', 'UPI'],
			],
			layoutId: null,
		});
		expect(close).toHaveBeenCalledWith(true);
		expect(navigate).toHaveBeenCalledWith(['/accounts/banks', 'bank_1', 'import']);
		page.start({ accounts: [], bankAccountId: 'bank_1', layouts: [layout()] as never });
		expect(page.layoutId()).toBe('lay_1');
	});
});

function mountPage<T>(component: Type<T>, gateway: Record<string, unknown>, id = 'bank_1') {
	TestBed.resetTestingModule();
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const opened: { componentInstance: { start: ReturnType<typeof vi.fn> } }[] = [];
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
			provideTanStackQuery(new QueryClient()),
			provideRouter([]),
			{ provide: BanksGateway, useValue: gateway },
			{ provide: NotificationService, useValue: notifier },
			{ provide: AuthStore, useValue: { permissions: signal(['accounts.index', 'accounts.edit']) } },
			{
				provide: NgbModal,
				useValue: {
					open: vi.fn(() => {
						const ref = { componentInstance: { start: vi.fn() } };
						opened.push(ref);
						return ref;
					}),
				},
			},
			{
				provide: ActivatedRoute,
				useValue: { paramMap: of(convertToParamMap(id ? { id } : {})) },
			},
		],
	});
	const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
	return {
		notifier,
		navigate,
		opened,
		create: () => {
			const fixture = TestBed.createComponent(component);
			fixture.detectChanges();
			return { fixture, page: fixture.componentInstance };
		},
	};
}

describe('matching the columns and checking the lines (BA5, BA6)', () => {
	it('says there is nothing to check after a reload, and goes back to the account', async () => {
		const harness = mountPage(StatementImportPage, {
			one: vi.fn(() => of({ bankName: 'HDFC Bank' })),
			layouts: vi.fn(() => of([])),
		});
		TestBed.inject(StatementImportState).read.set({
			bankAccountId: 'bank_9',
			fileName: 'x.csv',
			rows: [],
			layoutId: null,
		});
		const { fixture, page } = harness.create();
		await settle(fixture);
		expect(page.read()).toBeNull();
		expect(fixture.nativeElement.textContent).toContain('bank_import_nothing');
		await page.next();
		await page.save();
		await page.review();
		expect([page.step(), page.fileColumns()]).toEqual(['columns', []]);
		const noId = mountPage(StatementImportPage, { one: vi.fn(), layouts: vi.fn(() => of([])) }, '');
		expect(noId.create().page.id()).toBe('');
	});

	it('guesses a new file, saves the layout, checks the lines, corrects them and saves', async () => {
		const saveLayout = vi.fn((write: Record<string, unknown>) => of({ ...layout(), ...write, id: 'lay_9' }));
		const preview = vi.fn(() =>
			of({
				lines: [
					previewLine(),
					previewLine({
						row: 4,
						date: '2026-11-26',
						description: 'SMS',
						outPaise: 5_900,
						inPaise: 0,
						balancePaise: 53_251_000,
						already: true,
					}),
				],
				problems: [{ row: 5, problem: 'date_unreadable' }],
			}),
		);
		const saveLines = vi
			.fn()
			.mockReturnValueOnce(throwError(() => ({ error: { message: 'statement_totals_differ:53251000' } })))
			.mockReturnValueOnce(of({ saved: 1, skipped: 1 }));
		const harness = mountPage(StatementImportPage, {
			one: vi.fn(() => of({ bankName: 'HDFC Bank' })),
			layouts: vi.fn(() => of([layout()])),
			saveLayout,
			preview,
			saveLines,
		});
		const state = TestBed.inject(StatementImportState);
		state.read.set({ bankAccountId: 'bank_1', fileName: 'hdfc.csv', rows: HDFC_ROWS, layoutId: null });
		const { fixture, page } = harness.create();
		await settle(fixture);
		expect(page.step()).toBe('columns');
		expect(page.fileColumns().map((c) => [c.heading, c.example, c.role])).toEqual([
			['Date', '25/11/26', 'date'],
			['Narration', 'NEFT CR CCAVENUE 251126', 'description'],
			['Chq./Ref.No.', 'CCAV98240', 'reference'],
			['Value Dt', '25/11/26', 'valueDate'],
			['Withdrawal Amt.', '', 'withdrawal'],
			['Deposit Amt.', '98,240.00', 'deposit'],
			['Closing Balance', '5,32,569.00', 'balance'],
		]);
		page.setRole(3, 'date');
		expect(page.roles().slice(0, 4)).toEqual(['skip', 'description', 'reference', 'date']);
		page.setRole(0, 'date');
		page.setRole(3, 'valueDate');
		page.setRole(6, 'skip');
		page.setRole(6, 'balance');
		page.skipRows.set(0);
		expect(page.fileColumns()[0]?.heading).toBe('');
		fixture.detectChanges();
		expect(fixture.nativeElement.textContent).toContain('bank_column_n');
		page.skipRows.set(10);
		expect(page.fileColumns()[0]).toMatchObject({ heading: '', example: '' });
		page.skipRows.set(2);
		(fixture.nativeElement.querySelector('#bank_columns_next') as HTMLButtonElement).click();
		await settle(fixture);
		expect(saveLayout).toHaveBeenCalledWith(
			expect.objectContaining({ id: null, name: 'HDFC Bank CSV', skipRows: 2 }),
		);
		expect(preview).toHaveBeenCalledWith('bank_1', { layoutId: 'lay_9', rows: HDFC_ROWS });
		expect([page.step(), page.openingPaise(), page.closingPaise(), page.already()]).toEqual([
			'review',
			43_432_900,
			53_251_000,
			1,
		]);
		expect(page.matches()).toBe(true);
		expect(fixture.nativeElement.textContent).toContain('bank_review_lines_n');
		expect(fixture.nativeElement.textContent).toContain('bank_line_problem_date_unreadable');
		const firstRow = fixture.nativeElement.querySelector('tbody tr') as HTMLTableRowElement;
		firstRow.click();
		fixture.detectChanges();
		expect(page.editing()).toBe(0);
		page.setCell(0, 'date', '2026-11-24');
		page.setCell(0, 'description', 'NEFT CR CCAVENUE');
		page.setCell(0, 'reference', 'CCAV1');
		page.setCell(0, 'out', -5);
		page.setCell(0, 'in', '98240');
		page.setCell(1, 'in', 'x');
		expect(page.lines()[0]).toMatchObject({
			date: '2026-11-24',
			reference: 'CCAV1',
			outPaise: 0,
			inPaise: 9_824_000,
		});
		page.setEnd('opening', 'x');
		expect(page.matches()).toBe(false);
		page.setEnd('opening', 434_329);
		page.setEnd('closing', 532_510);
		expect(page.matches()).toBe(true);
		await page.save();
		expect(page.problem()).toEqual({
			key: 'bank_problem_statement_totals_differ',
			params: { amount: '₹5,32,510.00' },
		});
		(fixture.nativeElement.querySelector('#bank_review_save') as HTMLButtonElement).click();
		await settle(fixture);
		expect(saveLines.mock.lastCall).toEqual([
			'bank_1',
			expect.objectContaining({ fileName: 'hdfc.csv', openingPaise: 43_432_900, closingPaise: 53_251_000 }),
		]);
		expect((saveLines.mock.lastCall as [string, { lines: unknown[] }])[1].lines).toHaveLength(2);
		expect(harness.notifier.showSuccess).toHaveBeenCalledWith('bank_lines_saved');
		expect(state.read()).toBeNull();
		expect(harness.navigate).toHaveBeenLastCalledWith(['/accounts/banks', 'bank_1']);
	});

	it('goes straight to the lines with a saved layout, steps back, and words what was refused', async () => {
		const harness = mountPage(StatementImportPage, {
			one: vi.fn(() => of(undefined)),
			layouts: vi.fn(() => of([layout()])),
			saveLayout: vi.fn(() => throwError(() => ({ error: { message: 'bank_layout_incomplete' } }))),
			preview: vi
				.fn()
				.mockReturnValueOnce(of({ lines: [], problems: [] }))
				.mockReturnValueOnce(throwError(() => new Error('down'))),
		});
		TestBed.inject(StatementImportState).read.set({
			bankAccountId: 'bank_1',
			fileName: 'statement',
			rows: HDFC_ROWS,
			layoutId: 'lay_1',
		});
		const { fixture, page } = harness.create();
		await settle(fixture);
		expect([page.step(), page.layoutName(), page.lines().length]).toEqual(['review', 'HDFC Bank CSV', 0]);
		expect(fixture.nativeElement.textContent).toContain('bank_review_none');
		await page.save();
		page.back();
		expect(page.step()).toBe('columns');
		page.layoutName.set('');
		await page.next();
		expect(page.problem()).toEqual({ key: 'bank_problem_bank_layout_incomplete', params: {} });
		await page.review();
		expect(page.problem()).toEqual({ key: 'bank_problem_failed', params: {} });
		page.back();
		expect(harness.navigate).toHaveBeenLastCalledWith(['/accounts/banks', 'bank_1']);
		page.busy.set(true);
		await page.next();
		expect(statementProblem('statement_totals_differ:x')).toEqual({
			key: 'bank_problem_statement_totals_differ',
			params: { amount: '₹0.00' },
		});
		expect(page.day('2026-11-25')).toBe('25 Nov 2026');
	});

	it('names an unsaved file’s layout after its type, and a file with no account name plainly', async () => {
		const saveLayout = vi.fn((write: Record<string, unknown>) => of({ ...layout(), ...write }));
		const harness = mountPage(StatementImportPage, {
			one: vi.fn(() => of(undefined)),
			layouts: vi.fn(() => of([])),
			saveLayout,
			preview: vi.fn(() => of({ lines: [], problems: [] })),
		});
		TestBed.inject(StatementImportState).read.set({
			bankAccountId: 'bank_1',
			fileName: 'export',
			rows: HDFC_ROWS,
			layoutId: null,
		});
		const { fixture, page } = harness.create();
		await settle(fixture);
		await page.next();
		expect(saveLayout).toHaveBeenCalledWith(expect.objectContaining({ name: 'CSV' }));
		page.layoutName.set('My layout');
		await page.next();
		expect(saveLayout).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'My layout' }));
	});
});

describe('a bank account’s lines (BA3)', () => {
	it('lists the imported lines by status and period, and opens Import a statement', async () => {
		const lines = vi.fn(() =>
			of({
				items: [
					{
						id: 'bl_1',
						date: '2026-11-25',
						description: 'NEFT CR',
						reference: '',
						outPaise: 0,
						inPaise: 9_824_000,
						balancePaise: null,
						status: 'unmatched',
					},
					{
						id: 'bl_2',
						date: '2026-11-26',
						description: 'SMS',
						reference: 'X',
						outPaise: 5_900,
						inPaise: 0,
						balancePaise: 53_251_000,
						status: 'accepted',
					},
				],
				total: 120,
				counts: { unmatched: 1, accepted: 1 },
			}),
		);
		const harness = mountPage(BankPage, {
			one: vi.fn(() =>
				of({
					id: 'bank_1',
					shortName: 'HDFC',
					kind: 'current',
					numberShown: 'XX',
					balancePaise: 0,
					lands: [],
					upiIds: [],
				}),
			),
			lines,
			list: vi.fn(() => of({ items: [{ id: 'bank_1' }] })),
			layouts: vi.fn(() => of([layout()])),
		});
		const { fixture, page } = harness.create();
		await settle(fixture);
		const text = fixture.nativeElement.textContent as string;
		expect(text).toContain('NEFT CR');
		expect(text).toContain('₹98,240.00');
		expect(text).toContain('bank_line_status_accepted');
		expect(lines).toHaveBeenCalledWith('bank_1', expect.objectContaining({ page: 1, pageSize: 50 }));
		page.page.set(2);
		page.setChip('suggested');
		await settle(fixture);
		expect(lines).toHaveBeenLastCalledWith('bank_1', expect.objectContaining({ status: 'suggested', page: 1 }));
		page.setPeriod({ period: 'this_month' });
		expect(page.page()).toBe(1);
		expect([page.paise(0), page.paise(100), page.day('2026-11-26')]).toEqual(['', '₹1.00', '26 Nov 2026']);
		(fixture.nativeElement.querySelector('#bank_import') as HTMLButtonElement).click();
		await settle(fixture);
		expect(harness.opened[0]?.componentInstance.start).toHaveBeenCalledWith({
			accounts: [{ id: 'bank_1' }],
			bankAccountId: 'bank_1',
			layouts: [layout()],
		});
		page.tab.set('details');
		fixture.detectChanges();
		expect(fixture.nativeElement.textContent).toContain('bank_bank');
	});
});
