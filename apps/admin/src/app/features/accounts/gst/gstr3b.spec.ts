import { ApplicationRef, TemplateRef, signal, type EmbeddedViewRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { BanksGateway } from '@core/accounts/banks.gateway';
import { GstReturnsGateway } from '@core/accounts/gst-returns.gateway';
import { saveBlob } from '@core/purchasing/purchasing-format';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { Gstr3bPage, gstr3bRows, setOffRows, signedPaise, tableKey } from './gstr3b-page';
import { MarkFiledPopup } from './mark-filed-popup';

vi.mock('@core/purchasing/purchasing-format', async (original) => ({
	...(await original<typeof import('@core/purchasing/purchasing-format')>()),
	saveBlob: vi.fn(),
}));

/** GSTR-3B (accounts brief G6, Q7): its tables, the accountant's changes, the set-off and the steps to filing. */

const settle = async (fixture: { whenStable: () => Promise<unknown>; detectChanges: () => void }) => {
	for (let i = 0; i < 6; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();
	}
};
const refusal = (code: string) => ({ error: { message: code } });
const ALL = ['accounts.index', 'accounts.edit', 'accounts.post', 'accounts.lock'];
const heads = (igst: number, cgst: number, sgst: number) => ({ igst, cgst, sgst });

const SET_OFF = {
	liability: heads(10_000, 45_000, 45_000),
	credit: heads(20_000, 30_000, 30_000),
	igstUsed: heads(10_000, 5_000, 5_000),
	cgstUsed: { cgst: 25_000, igst: 0 },
	sgstUsed: { sgst: 25_000, igst: 0 },
	cash: heads(0, 15_000, 15_000),
	carried: heads(0, 0, 0),
	reverseChargeCash: heads(0, 1_800, 1_800),
};
const CHANGES = [
	{ table: '4A', igst: 0, cgst: -150_000, sgst: -150_000, reason: 'Bill entered twice' },
	{ table: '3.1d', igst: 0, cgst: 9_000, sgst: 9_000, reason: 'Advocate fee, reverse charge' },
];
const draft = (over: Record<string, unknown> = {}) => ({
	id: 'd3',
	gstRegistrationId: 'r1',
	gstin: '19ABCDE1234F1Z5',
	returnType: 'GSTR-3B',
	month: '2026-10',
	status: 'prepared',
	summary: [
		// Amounts in rupees, as the return holds them.
		{ table: '3.1a', records: 40, taxable: 500_000, tax: 90_000 },
		{ table: '3.1b', records: 0, taxable: 0, tax: 0 },
		{ table: '3.1d', records: 1, taxable: 10_000, tax: 1_800 },
		{ table: '4A', records: 12, taxable: 300_000, tax: 54_000 },
		{ table: '4B', records: 2, taxable: 5_000, tax: -900 },
		{ table: '6', records: 1, taxable: 0, tax: 37_800 },
	],
	problems: [],
	portal: { gstin: '19ABCDE1234F1Z5', ret_period: '102026' },
	preparedBy: 'u1',
	preparedAt: '2026-11-18T05:30:00.000Z',
	preparedByName: 'Asha',
	checkedByName: '',
	approvedByName: '',
	arn: null,
	filedOn: null,
	version: 4,
	setOff: SET_OFF,
	adjustments: CHANGES,
	...over,
});

interface Opened {
	content: unknown;
	close: ReturnType<typeof vi.fn>;
	dismiss: ReturnType<typeof vi.fn>;
	componentInstance: { start: ReturnType<typeof vi.fn> };
	view: EmbeddedViewRef<unknown> | null;
}

function mount(gst: Record<string, unknown>, options: { permissions?: string[]; id?: string | null } = {}) {
	TestBed.resetTestingModule();
	document.body.querySelectorAll('.gst-test-modal').forEach((node) => node.remove());
	const notifier = { showSuccess: vi.fn(), showError: vi.fn() };
	const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const invalidate = vi.spyOn(queries, 'invalidateQueries');
	const opened: Opened[] = [];
	TestBed.configureTestingModule({
		imports: [
			Gstr3bPage,
			TranslocoTestingModule.forRoot({
				langs: { en: {} },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideTanStackQuery(queries),
			provideRouter([]),
			{ provide: GstReturnsGateway, useValue: gst },
			// The bank accounts a set-off is paid from.
			{ provide: BanksGateway, useValue: { list: vi.fn(() => of({ items: [] })) } },
			{ provide: NotificationService, useValue: notifier },
			{ provide: AuthStore, useValue: { permissions: signal(options.permissions ?? ALL) } },
			{
				provide: ActivatedRoute,
				useValue: { paramMap: of(convertToParamMap(options.id === null ? {} : { id: options.id ?? 'd3' })) },
			},
			{
				provide: NgbModal,
				useValue: {
					open: vi.fn((content: unknown) => {
						const ref: Opened = {
							content,
							close: vi.fn(),
							dismiss: vi.fn(),
							componentInstance: { start: vi.fn() },
							view: null,
						};
						if (content instanceof TemplateRef) {
							const view = content.createEmbeddedView({ $implicit: ref });
							TestBed.inject(ApplicationRef).attachView(view);
							view.detectChanges();
							const holder = document.createElement('div');
							holder.className = 'gst-test-modal';
							holder.append(...(view.rootNodes as Node[]));
							document.body.append(holder);
							ref.view = view;
						}
						opened.push(ref);
						return ref;
					}),
				},
			},
		],
	});
	const fixture = TestBed.createComponent(Gstr3bPage);
	fixture.detectChanges();
	return { fixture, page: fixture.componentInstance, notifier, invalidate, opened };
}

async function gstr3b(over: Record<string, unknown> = {}, gst: Record<string, unknown> = {}, permissions = ALL) {
	const calls = {
		one: vi.fn(() => of(draft(over))),
		step: vi.fn(() => of(draft())),
		prepare: vi.fn(() => of(draft())),
		...gst,
	};
	const harness = mount(calls, { permissions });
	await settle(harness.fixture);
	return { ...harness, calls };
}

const el = (fixture: { nativeElement: HTMLElement }, selector: string) =>
	fixture.nativeElement.querySelector(selector) as HTMLElement | null;
const all = (fixture: { nativeElement: HTMLElement }, selector: string) =>
	[...fixture.nativeElement.querySelectorAll(selector)] as HTMLElement[];
const modal = (selector: string) => document.querySelector(`.gst-test-modal ${selector}`) as HTMLElement | null;
const type = (control: HTMLElement | null, value: string) => {
	(control as HTMLInputElement).value = value;
	(control as HTMLInputElement).dispatchEvent(new Event('input'));
};

describe('a GSTR-3B’s figures', () => {
	it('reads a typed change in paise, keeping a minus, and junk as nothing', () => {
		expect(signedPaise('−1,500')).toBe(-150_000);
		expect(signedPaise('-1500')).toBe(-150_000);
		expect(signedPaise('₹2,000.50')).toBe(200_050);
		expect(signedPaise(' 12 ')).toBe(1_200);
		expect(signedPaise('twelve')).toBe(0);
		expect(signedPaise('')).toBe(0);
		expect(tableKey('3.1a')).toBe('31a');
		expect(tableKey('4A')).toBe('4A');
	});

	it('draws G6’s rows: exports only when there were any, and a missing table as nothing', () => {
		expect(gstr3bRows(draft() as never).map((row) => [row.table, row.tax, row.adjustable])).toEqual([
			['3.1a', 90_000, null],
			['3.1d', 1_800, '3.1d'],
			['4A', 54_000, '4A'],
			['4B', -900, '4B'],
			['6', 37_800, null],
		]);
		const exports = (records: number, taxable: number) =>
			gstr3bRows({ summary: [{ table: '3.1b', records, taxable, tax: 0 }] } as never).map((row) => row.table);
		expect(exports(2, 0)).toContain('3.1b');
		expect(exports(0, 75_000)).toContain('3.1b');
		expect(gstr3bRows({ summary: [] } as never)).toEqual([
			{ table: '3.1a', tax: 0, adjustable: null },
			{ table: '3.1d', tax: 0, adjustable: '3.1d' },
			{ table: '4A', tax: 0, adjustable: '4A' },
			{ table: '4B', tax: 0, adjustable: '4B' },
			{ table: '6', tax: 0, adjustable: null },
		]);
	});

	it('lays out Q7’s set-off: eight rows, a dash where a credit can’t be used, and the cash in bold', () => {
		const rows = setOffRows({
			...SET_OFF,
			cgstUsed: { cgst: 25_000, igst: 3_000 },
			sgstUsed: { sgst: 25_000, igst: 2_000 },
		} as never);
		expect(rows.map((row) => row.key)).toEqual([
			'output',
			'credit',
			'igst_used',
			'own_used',
			'own_to_igst',
			'cash',
			'reverse_charge',
			'carried',
		]);
		expect(rows[3]).toEqual({ key: 'own_used', igst: null, cgst: 25_000, sgst: 25_000 });
		expect(rows[4]).toEqual({ key: 'own_to_igst', igst: 5_000, cgst: null, sgst: null });
		expect(rows[5]).toEqual({ key: 'cash', igst: 0, cgst: 15_000, sgst: 15_000, bold: true });
		expect(rows.filter((row) => row.bold)).toHaveLength(1);
	});
});

describe('the GSTR-3B page (G6)', () => {
	it('shows a prepared return: its tables, where 4A comes from, the changes, the set-off and what finalising needs', async () => {
		const { fixture, page, calls } = await gstr3b({
			problems: [{ table: '4A', problem: 'gstr1_not_filed', document: 'GSTR-1 2026-10' }],
		});
		expect(calls.one).toHaveBeenCalledWith('d3');
		expect([page.monthName(), page.open()]).toEqual(['October 2026', true]);
		expect(el(fixture, '.alert-warning')?.textContent).toContain('gstr3b_check_gstr1_not_filed');
		const rows = all(fixture, 'tbody')[0]?.querySelectorAll('tr') as NodeListOf<HTMLElement>;
		expect(rows).toHaveLength(5);
		expect(rows[0]?.textContent).toContain('gstr3b_table_31a');
		expect(rows[2]?.querySelector('a')?.getAttribute('href')).toBe('/accounts/gst/2b');
		expect(rows[3]?.textContent).toContain('−₹900.00');
		expect(all(fixture, 'button[title="gstr3b_change"]')).toHaveLength(3);
		expect(all(fixture, 'button[title="gstr3b_remove_change"]')).toHaveLength(2);
		expect(fixture.nativeElement.textContent).toContain('Bill entered twice');
		expect(fixture.nativeElement.textContent).toContain('CGST ₹1,500.00');
		const setOff = el(fixture, '#gst_setoff') as HTMLElement;
		const setOffRowsDrawn = [...setOff.querySelectorAll('tbody tr')] as HTMLElement[];
		expect(setOffRowsDrawn).toHaveLength(8);
		expect(setOffRowsDrawn[3]?.textContent).toContain('—');
		expect(setOffRowsDrawn[5]?.querySelectorAll('.fw-bold')).toHaveLength(4);
		expect(setOffRowsDrawn[0]?.querySelectorAll('.fw-bold')).toHaveLength(0);
		expect(fixture.nativeElement.textContent).toContain('gstr3b_final_three_years_body');
		expect(fixture.nativeElement.textContent).toContain('gstr3b_enter_arn_body');
		expect(el(fixture, '#gst_prepare_again')).not.toBeNull();
		expect(el(fixture, '#gst_checked')?.textContent).toContain('gstr3b_send_for_approval');
		expect(el(fixture, '#gst_approve')).toBeNull();
		expect(el(fixture, '#gst_open_file')).toBeNull();
		expect(page.day('2026-11-18T05:30:00.000Z')).toBeTruthy();
	});

	it('downloads the portal’s file, and scrolls to the set-off when there is one', async () => {
		const { fixture, page } = await gstr3b();
		(el(fixture, '#gst_download') as HTMLButtonElement).click();
		const [name, blob] = vi.mocked(saveBlob).mock.lastCall as [string, Blob];
		expect(name).toBe('GSTR3B_19ABCDE1234F1Z5_102026.json');
		expect(JSON.parse(await blob.text())).toEqual(draft().portal);
		const scroll = vi.fn();
		const setOff = el(fixture, '#gst_setoff') as HTMLElement;
		Object.assign(setOff, { scrollIntoView: scroll });
		(el(fixture, '#gst_to_setoff') as HTMLButtonElement).click();
		expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth' });
		setOff.remove();
		expect(() => page.toSetOff()).not.toThrow();
	});

	it('sends a prepared return for approval and prepares it again with its changes, and names a refusal', async () => {
		const { fixture, page, calls, notifier, invalidate } = await gstr3b();
		(el(fixture, '#gst_checked') as HTMLButtonElement).click();
		await settle(fixture);
		expect(calls.step).toHaveBeenCalledWith('d3', { to: 'checked', version: 4 });
		expect(notifier.showSuccess).toHaveBeenLastCalledWith('gst_done_checked');
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['gst-returns'] });
		(el(fixture, '#gst_prepare_again') as HTMLButtonElement).click();
		await settle(fixture);
		expect(calls.prepare).toHaveBeenCalledWith({
			gstRegistrationId: 'r1',
			returnType: 'GSTR-3B',
			month: '2026-10',
			adjustments: CHANGES,
		});
		expect(notifier.showSuccess).toHaveBeenLastCalledWith('gst_done_prepared');

		calls.step.mockReturnValueOnce(throwError(() => refusal('gst_gstr1_not_filed')));
		await expect(page.step(page.draft.data() as never, 'checked')).resolves.toBe(false);
		expect(notifier.showError).toHaveBeenLastCalledWith('gst_problem_gstr1_not_filed');
		calls.prepare.mockReturnValueOnce(throwError(() => new Error('down')));
		await expect(page.prepareAgain(page.draft.data() as never)).resolves.toBe(false);
		expect(notifier.showError).toHaveBeenLastCalledWith('gst_problem_failed');
		expect(page.busy()).toBe(false);
	});

	it('offers Approve once sent, not while it has problems, and only to those who may lock', async () => {
		const checked = await gstr3b({ status: 'checked' });
		expect(el(checked.fixture, '#gst_checked')).toBeNull();
		expect(el(checked.fixture, '#gst_prepare_again')).not.toBeNull();
		const approve = el(checked.fixture, '#gst_approve') as HTMLButtonElement;
		expect(approve.disabled).toBe(false);
		approve.click();
		await settle(checked.fixture);
		expect(checked.calls.step).toHaveBeenCalledWith('d3', { to: 'approved', version: 4 });

		const blocked = await gstr3b({
			status: 'checked',
			problems: [{ table: '6', problem: 'cash_short', document: '' }],
		});
		expect((el(blocked.fixture, '#gst_approve') as HTMLButtonElement).disabled).toBe(true);

		const accountant = await gstr3b({ status: 'checked' }, {}, ['accounts.index', 'accounts.edit']);
		expect(el(accountant.fixture, '#gst_approve')).toBeNull();
		expect(el(accountant.fixture, '#gst_prepare_again')).not.toBeNull();
	});

	it('takes no more changes once approved, and opens Mark filed with the return’s details', async () => {
		const { fixture, page, opened } = await gstr3b({ status: 'approved' });
		expect(page.open()).toBe(false);
		expect(all(fixture, 'button[title="gstr3b_change"]')).toHaveLength(0);
		expect(all(fixture, 'button[title="gstr3b_remove_change"]')).toHaveLength(0);
		expect(el(fixture, '#gst_prepare_again')).toBeNull();
		(el(fixture, '#gst_open_file') as HTMLButtonElement).click();
		expect(opened[0]?.content).toBe(MarkFiledPopup);
		expect(opened[0]?.componentInstance.start).toHaveBeenCalledWith({
			gstRegistrationId: 'r1',
			gstin: '19ABCDE1234F1Z5',
			returnType: 'GSTR-3B',
			month: '2026-10',
			monthName: 'October 2026',
		});
	});

	it('shows the ARN once filed, and no set-off or changes when there are none', async () => {
		const { fixture } = await gstr3b({
			status: 'filed',
			arn: 'AA191126054321Z',
			filedOn: '2026-11-20',
			setOff: null,
			adjustments: [],
			summary: [{ table: '3.1b', records: 3, taxable: 75_000, tax: 0 }],
		});
		const text = fixture.nativeElement.textContent as string;
		expect(text).toContain('gstr3b_filed_with');
		expect(text).not.toContain('gstr3b_changes');
		expect(text).toContain('gstr3b_table_31b');
		expect(el(fixture, '#gst_setoff')).toBeNull();
		expect(el(fixture, '#gst_to_setoff')).toBeNull();
		expect(el(fixture, '#gst_open_file')).toBeNull();
		expect(el(fixture, '.alert-warning')).toBeNull();
	});

	it('shows no change buttons to someone who may not edit', async () => {
		const { fixture } = await gstr3b({}, {}, ['accounts.index']);
		expect(all(fixture, 'button[title="gstr3b_change"]')).toHaveLength(0);
		expect(all(fixture, 'button[title="gstr3b_remove_change"]')).toHaveLength(0);
		expect(el(fixture, '#gst_checked')).toBeNull();
	});

	it('reads nothing with no return named', async () => {
		for (const id of ['', null]) {
			const one = vi.fn(() => of(draft()));
			const { fixture, page } = mount({ one }, { id });
			await settle(fixture);
			expect(one).not.toHaveBeenCalled();
			expect([page.id(), page.monthName(), page.open()]).toEqual(['', '', false]);
		}
	});
});

describe('changing a GSTR-3B table (G6 “Can change here”)', () => {
	it('opens a fresh change for the row, needs a reason and an amount, and saves it with the others', async () => {
		const { fixture, page, opened, calls } = await gstr3b();
		page.changeIgst.set('5');
		page.changeReason.set('left over');
		(all(fixture, 'button[title="gstr3b_change"]')[1] as HTMLButtonElement).click();
		const popup = opened[0] as Opened;
		expect(popup.content).toBeInstanceOf(TemplateRef);
		expect(page.changeTable()).toBe('4A');
		expect([page.changeIgst(), page.changeCgst(), page.changeSgst(), page.changeReason()]).toEqual([
			'',
			'',
			'',
			'',
		]);
		const redraw = () => popup.view?.detectChanges();
		const save = modal('#gst_change_save') as HTMLButtonElement;
		expect(save.disabled).toBe(true);
		expect(modal('.modal-title')?.textContent).toContain('gstr3b_change_title');
		expect(document.querySelector('.gst-test-modal')?.textContent).toContain('gstr3b_change_help_4A');

		type(modal('#gst_change_reason'), '  Bill posted to the wrong month  ');
		redraw();
		expect(page.changeReady()).toBe(false);
		type(modal('#gst_change_cgst'), '−1,500');
		type(modal('#gst_change_sgst'), '-1500');
		type(modal('#gst_change_igst'), 'abc');
		redraw();
		expect(page.changeReady()).toBe(true);
		expect(save.disabled).toBe(false);
		save.click();
		await settle(fixture);
		expect(calls.prepare).toHaveBeenCalledWith(
			expect.objectContaining({
				adjustments: [
					...CHANGES,
					{ table: '4A', igst: 0, cgst: -150_000, sgst: -150_000, reason: 'Bill posted to the wrong month' },
				],
			}),
		);
		expect(popup.close).toHaveBeenCalled();
		(modal('.btn-close') as HTMLButtonElement).click();
		expect(popup.dismiss).toHaveBeenCalled();
	});

	it('needs a reason even with an amount, keeps the pop-up open when refused, and saves with none open', async () => {
		const prepare = vi
			.fn()
			.mockReturnValueOnce(throwError(() => refusal('gst_return_approved')))
			.mockReturnValueOnce(of(draft()));
		const { fixture, page, opened, notifier } = await gstr3b({}, { prepare });
		page.changeReason.set('');
		page.changeIgst.set('100');
		expect(page.changeReady()).toBe(false);
		(all(fixture, 'button[title="gstr3b_change"]')[0] as HTMLButtonElement).click();
		expect(page.changeTable()).toBe('3.1d');
		page.changeIgst.set('100');
		page.changeReason.set('Fee');
		const data = page.draft.data() as never;
		await page.saveChange(data);
		expect(notifier.showError).toHaveBeenLastCalledWith('gst_problem_return_approved');
		expect(opened[0]?.close).not.toHaveBeenCalled();

		const fresh = await gstr3b();
		fresh.page.changeIgst.set('100');
		fresh.page.changeReason.set('Fee');
		await fresh.page.saveChange(fresh.page.draft.data() as never);
		expect(fresh.notifier.showSuccess).toHaveBeenLastCalledWith('gst_done_prepared');
	});

	it('removes one change and prepares the return again without it', async () => {
		const { fixture, calls } = await gstr3b();
		(all(fixture, 'button[title="gstr3b_remove_change"]')[0] as HTMLButtonElement).click();
		await settle(fixture);
		expect(calls.prepare).toHaveBeenCalledWith(expect.objectContaining({ adjustments: [CHANGES[1]] }));
	});
});
