import { HttpErrorResponse } from '@angular/common/http';
import { signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { PurchasingGateway } from '@core/purchasing/purchasing.gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { ReturnForm } from './return-form';
import { ReturnList, toReturnRow, type ReturnTableRow } from './return-list';
import { ReturnSend } from './return-send';
import { ReturnView } from './return-view';
import { SettlePopup } from './settle-popup';

import type { PurchaseReturn, ReturnableLine } from '@saha-textile/contracts';

const client = vi.hoisted(() => ({ invalidateQueries: vi.fn() }));
const files = vi.hoisted(() => ({ saved: [] as string[] }));
const returnsPage = signal<unknown>(undefined);
const viewDoc = signal<unknown>(undefined);

vi.mock('@core/purchasing/purchasing.gateway', async (original) => ({
	...(await original<typeof import('@core/purchasing/purchasing.gateway')>()),
	injectReturnsQuery: (query: () => unknown) => (query(), { data: returnsPage }),
}));
vi.mock('@core/purchasing/purchasing-format', async (original) => ({
	...(await original<typeof import('@core/purchasing/purchasing-format')>()),
	saveBlob: (name: string) => void files.saved.push(name),
}));
vi.mock('@tanstack/angular-query-experimental', async (original) => ({
	...(await original<typeof import('@tanstack/angular-query-experimental')>()),
	// The return page's two reads: the return itself, and its activity once that tab opens.
	injectQuery: (options: () => { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
		const read = options();
		void read.queryFn().catch(() => null);
		return { data: read.queryKey.includes('one') ? viewDoc : () => [] };
	},
}));

const translate = (key: string, params?: Record<string, unknown>) =>
	params ? `${key} ${JSON.stringify(params)}` : key;
const transloco = { translate, getActiveLang: () => 'en', getTranslation: () => ({}) };

interface Modal {
	componentInstance: { start: ReturnType<typeof vi.fn> };
	result: Promise<unknown>;
}
const answer = (result: unknown): Modal => ({
	componentInstance: { start: vi.fn() },
	result: result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
});

function render<T>(
	type: Type<T>,
	gateway: Partial<Record<keyof PurchasingGateway, unknown>>,
	route: { id?: string; query?: Record<string, string> } = {},
	modalAnswers: unknown[] = [],
) {
	const router = { navigate: vi.fn(), navigateByUrl: vi.fn() };
	const toasts = { showError: vi.fn(), showSuccess: vi.fn() };
	const modals = { open: vi.fn(() => answer(modalAnswers.length ? modalAnswers.shift() : new Error('closed'))) };
	const active = { close: vi.fn(), dismiss: vi.fn() };
	client.invalidateQueries.mockClear();
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: Router, useValue: router },
			{
				provide: ActivatedRoute,
				useValue: {
					snapshot: {
						paramMap: convertToParamMap(route.id ? { id: route.id } : {}),
						queryParamMap: convertToParamMap(route.query ?? {}),
					},
				},
			},
			{ provide: PurchasingGateway, useValue: gateway },
			{ provide: QueryClient, useValue: client },
			{ provide: NotificationService, useValue: toasts },
			{ provide: TranslocoService, useValue: transloco },
			{ provide: NgbModal, useValue: modals },
			{ provide: NgbActiveModal, useValue: active },
		],
	});
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(type);
	TestBed.tick();
	return { page: fixture.componentInstance, router, toasts, modals, active };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const pieceLine = (over: Partial<ReturnableLine> = {}) =>
	({
		entryLineId: 'l1',
		soldBy: 'piece',
		freeToReturn: 3,
		unitCostINR: 940,
		gstRatePct: 5,
		...over,
	}) as ReturnableLine;
const metreLine = pieceLine({ entryLineId: 'l2', soldBy: 'metre', freeToReturn: 25, unitCostINR: 310 });
const entry = { id: 'pe_1', number: 'PE/1', taxType: 'intra_state' };
const draft = (over: Partial<PurchaseReturn> = {}) =>
	({
		id: 'pr_1',
		number: null,
		kind: 'return_goods',
		status: 'draft',
		supplierName: 'Banaras Silk Weavers',
		purchaseEntryId: 'pe_1',
		purchaseEntryNumber: 'PE/1',
		reason: 'damaged_on_arrival',
		origin: 'manual',
		noteToSupplier: null,
		photoAssetIds: ['med_1'],
		holdId: null,
		lines: [{ entryLineId: 'l2', quantity: 15, soldBy: 'metre' }],
		totalINR: 1000,
		settledINR: 0,
		settlements: [],
		challanNumber: null,
		version: 3,
		...over,
	}) as unknown as PurchaseReturn;

const conflict = new HttpErrorResponse({
	status: 409,
	error: {
		error: {
			code: 'stale',
			message: 'Stale',
			issues: [{ code: 'stale', message: 'Saved by someone else', path: [] }],
		},
	},
});

describe('ReturnForm', () => {
	const gateway = (over: Partial<Record<keyof PurchasingGateway, unknown>> = {}) => ({
		entries: vi.fn(() =>
			of({
				items: [
					{ id: 'pe_1', number: 'PE/1', supplierName: 'Weavers', billDate: '2026-11-01', status: 'posted' },
					{ id: 'pe_2', number: null, supplierName: 'Weavers', billDate: '2026-11-02', status: 'draft' },
					{ id: 'pe_3', number: null, supplierName: 'Weavers', billDate: '2026-11-03', status: 'posted' },
				],
			}),
		),
		entry: vi.fn(() => of(entry)),
		returnable: vi.fn(() => of([pieceLine(), metreLine])),
		returnDoc: vi.fn(() => of(draft())),
		saveReturn: vi.fn(() => of(draft({ id: 'pr_9' }))),
		...over,
	});

	it('starts from an entry with the reason in the address, and checks each typed quantity', async () => {
		const { page } = render(ReturnForm, gateway(), { query: { entry: 'pe_1', reason: 'short_supplied' } });
		// Before the entry has loaded: no tax type yet.
		expect(page.totals().totalINR).toBe(0);
		await settle();
		expect(page.reason()).toBe('short_supplied');
		expect(page.kind()).toBe('short_supply');
		expect(page.rows().map((row) => row.quantity)).toEqual(['', '']);
		expect(page.canSave()).toBe(false);
		page.setQuantity(0, '2');
		page.setQuantity(1, '1.5');
		expect(page.picked()).toHaveLength(2);
		expect(page.canSave()).toBe(true);
		expect(page.valueOf(page.rows()[0] as never)).toBe(1880);
		expect(page.totals().totalINR).toBeGreaterThan(0);
		page.setQuantity(0, 'x');
		page.setQuantity(1, '2.55');
		expect(page.problems()).toEqual(['qty_whole_pieces', 'qty_metres_step']);
		page.setQuantity(0, '9');
		page.setQuantity(1, '   ');
		expect(page.problems()).toEqual(['pr_more_than_free', null]);
		page.setQuantity(1, 'm');
		expect(page.problems()[1]).toBeNull();
	});

	it('offers the free amount for more than is free, by pieces and by metres, and keeps it when declined', async () => {
		const { page } = render(ReturnForm, gateway(), { query: { entry: 'pe_1' } }, [
			'take',
			'take',
			'keep',
			new Error('closed'),
		]);
		await settle();
		await page.checkCap(5);
		page.setQuantity(0, '1');
		await page.checkCap(0);
		page.setQuantity(0, '9');
		await page.checkCap(0);
		expect(page.rows()[0]?.quantity).toBe('3');
		page.setQuantity(1, '9');
		await page.checkCap(1);
		expect(page.rows()[1]?.quantity).toBe('2.5');
		page.setQuantity(1, '9');
		await page.checkCap(1);
		expect(page.rows()[1]?.quantity).toBe('9');
		await page.checkCap(1);
		expect(page.rows()[1]?.quantity).toBe('9');
	});

	it('reads the lines again only when the reason changes the kind of return', async () => {
		const g = gateway();
		const { page } = render(ReturnForm, g, { query: { entry: 'pe_1', reason: 'not_a_reason' } });
		await settle();
		expect(page.reason()).toBe('quality_after_accepting');
		await page.setReason('wrong_item');
		expect(g.returnable).toHaveBeenCalledTimes(1);
		await page.setReason('short_supplied');
		expect(g.returnable).toHaveBeenCalledTimes(2);
	});

	it('adds picked photos up to ten, and nothing when the picker closes or brings none', async () => {
		const many = Array.from({ length: 12 }, (_, i) => ({ assetId: `med_${i}`, name: `Photo ${i}` }));
		const { page } = render(ReturnForm, gateway(), { query: { entry: 'pe_1' } }, [many, [], new Error('x')]);
		await settle();
		await page.addPhotos();
		expect(page.photos()).toHaveLength(10);
		await page.addPhotos();
		await page.addPhotos();
		expect(page.photos()).toHaveLength(10);
	});

	it('saves a new draft and opens it, or quietly; names a clash and shows other failures', async () => {
		const save = vi
			.fn()
			.mockReturnValueOnce(of(draft({ id: 'pr_9' })))
			.mockReturnValueOnce(of(draft({ id: 'pr_9' })))
			.mockReturnValueOnce(throwError(() => conflict))
			.mockReturnValueOnce(throwError(() => new Error('down')));
		const { page, router, toasts } = render(ReturnForm, gateway({ saveReturn: save }), {
			query: { entry: 'pe_1' },
		});
		await settle();
		expect(await page.save()).toBeNull();
		page.setQuantity(0, '1');
		page.note.set('  Torn pallu  ');
		page.photos.set([{ assetId: 'med_torn', name: 'Torn pallu' }]);
		expect((await page.save())?.id).toBe('pr_9');
		expect(save.mock.calls[0]?.[0]).toBeNull();
		expect(save.mock.calls[0]?.[1]).toMatchObject({
			noteToSupplier: 'Torn pallu',
			kind: 'return_goods',
			photoAssetIds: ['med_torn'],
		});
		expect(router.navigate).toHaveBeenCalledWith(['/purchase-returns', 'pr_9']);
		// Saved once, it saves over itself with the version it read.
		expect((await page.save(true))?.id).toBe('pr_9');
		expect(save.mock.calls[1]?.[0]).toBe('pr_9');
		expect(save.mock.calls[1]?.[1]).toMatchObject({ version: 3 });
		expect(await page.save()).toBeNull();
		expect(page.conflict()).toBe('Saved by someone else');
		expect(await page.save()).toBeNull();
		expect(toasts.showError).toHaveBeenCalledWith('purchasing_action_failed');
	});

	it('sends after saving, thanking for a sent return; stays put when the save fails', async () => {
		const { page, router, toasts } = render(ReturnForm, gateway(), { query: { entry: 'pe_1' } }, [
			draft({ number: 'DN/1', status: 'sent' }),
			draft({ number: null, status: 'sent' }),
			new Error('dismissed'),
		]);
		await settle();
		await page.send();
		expect(router.navigate).not.toHaveBeenCalled();
		page.setQuantity(0, '1');
		await page.send();
		await page.send();
		await page.send();
		expect(toasts.showSuccess).toHaveBeenCalledWith('pr_sent {"number":"DN/1"}');
		expect(toasts.showSuccess).toHaveBeenCalledWith('pr_sent {"number":""}');
		expect(router.navigate).toHaveBeenCalledWith(['/purchase-returns', 'pr_9']);
	});

	it('picks a posted entry to start from, and searches by what was typed', async () => {
		const g = gateway();
		const { page } = render(ReturnForm, g);
		await settle();
		expect(page.entryOptions().map((row) => row.id)).toEqual(['pe_1', 'pe_3']);
		expect(page.entrySelect()[1]?.label).toContain(' · Weavers · ');
		expect(page.entrySelect()[0]).toMatchObject({ value: 'pe_1' });
		await page.searchEntries({ search: ' PE ' } as never);
		expect(g.entries).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'PE' }));
		await page.searchEntries({} as never);
		page.chooseEntry({ value: 'pe_1' } as never);
		await settle();
		page.chooseEntry({ value: 'pe_1' } as never);
		page.chooseEntry({ value: ['pe_1'] } as never);
		expect(g.entry).toHaveBeenCalledTimes(1);
		const failing = render(ReturnForm, gateway({ entries: () => throwError(() => new Error('down')) }));
		await settle();
		expect(failing.page.entryOptions()).toEqual([]);
	});

	it('opens a draft with its typed quantities, and sends a sent one to its page', async () => {
		const { page } = render(ReturnForm, gateway(), { id: 'pr_1' });
		await settle();
		expect(page.existing()?.id).toBe('pr_1');
		expect(page.note()).toBe('');
		expect(page.photos()).toEqual([{ assetId: 'med_1', name: 'med_1' }]);
		expect(page.rows().map((row) => row.quantity)).toEqual(['', '1.5']);
		const sent = render(ReturnForm, gateway({ returnDoc: () => of(draft({ status: 'sent' })) }), { id: 'pr_1' });
		await settle();
		expect(sent.router.navigate).toHaveBeenCalledWith(['/purchase-returns', 'pr_1'], { replaceUrl: true });
		const noted = render(ReturnForm, gateway({ returnDoc: () => of(draft({ noteToSupplier: 'Torn' })) }), {
			id: 'pr_1',
		});
		await settle();
		expect(noted.page.note()).toBe('Torn');
		const failing = render(ReturnForm, gateway({ returnDoc: () => throwError(() => new Error('down')) }), {
			id: 'pr_1',
		});
		await settle();
		expect(failing.toasts.showError).toHaveBeenCalled();
	});

	it('starts from held stock with everything free typed in, and from a hold without an SKU', async () => {
		const g = gateway();
		const { page } = render(ReturnForm, g, { query: { hold: 'hold_1', sku: 'ST-1' } });
		await settle();
		expect(g.entries).toHaveBeenCalledWith(expect.objectContaining({ q: 'ST-1' }));
		await page.useEntry('pe_1');
		expect(page.rows().map((row) => row.quantity)).toEqual(['3', '2.5']);
		const bare = render(ReturnForm, gateway(), { query: { hold: 'hold_1' } });
		await settle();
		expect(bare.page.holdId()).toBe('hold_1');
		const failing = render(ReturnForm, gateway({ entry: () => throwError(() => new Error('down')) }), {
			query: { entry: 'pe_1' },
		});
		await settle();
		expect(failing.toasts.showError).toHaveBeenCalled();
	});
});

describe('ReturnList', () => {
	it('draws each page, filters back to page 1, and opens a return', () => {
		returnsPage.set(undefined);
		const { page, router } = render(ReturnList, {});
		expect(page.counts()).toEqual({});
		expect(page.tableConfig().data).toEqual([]);
		returnsPage.set({ items: [draft({ number: 'DN/1', status: 'sent' })], total: 1, counts: { all: 1 } });
		TestBed.tick();
		expect(page.tableConfig().total).toBe(1);
		expect(page.counts()).toEqual({ all: 1 });
		page.setFilter('sent');
		const table = { tableData: { page: 4 } };
		Object.assign(page, { table: () => table });
		page.setFilter('draft');
		expect(table.tableData.page).toBe(1);
		page.onTableChange({ page: 2 });
		page.onTableChange();
		page.onAction({ actionToPerform: 'view', data: { id: 'pr_1' } as ReturnTableRow } as never);
		page.onAction({ actionToPerform: 'edit', data: { id: 'pr_1' } as ReturnTableRow } as never);
		page.onAction({ actionToPerform: 'view' } as never);
		expect(router.navigate).toHaveBeenCalledTimes(1);
		expect(router.navigate).toHaveBeenCalledWith(['/purchase-returns', 'pr_1']);
	});

	it('names a numbered return, and a goods return still waiting for its number', () => {
		const numbered = toReturnRow(draft({ number: 'DN/7', purchaseEntryNumber: null }), translate);
		expect(numbered.number).toContain('DN/7');
		expect(numbered.entry).toBe('—');
		expect(toReturnRow(draft(), translate).number).toContain('pr_number_on_sending');
	});
});

describe('ReturnSend', () => {
	it('sends with the courier and docket typed, nothing when blank, and says why it could not', async () => {
		const sendReturn = vi
			.fn()
			.mockReturnValueOnce(of(draft({ status: 'sent' })))
			.mockReturnValueOnce(of(draft({ status: 'sent' })))
			.mockReturnValueOnce(throwError(() => new Error('down')));
		const { page, active } = render(ReturnSend, { sendReturn });
		await page.send();
		expect(sendReturn).not.toHaveBeenCalled();
		page.start(draft());
		page.courier.set('  DTDC ');
		await page.send();
		expect(sendReturn.mock.calls[0]?.[1]).toMatchObject({ courier: 'DTDC', docket: null });
		expect(active.close).toHaveBeenCalled();
		page.courier.set('   ');
		page.docket.set(' AWB-1 ');
		await page.send();
		expect(sendReturn.mock.calls[1]?.[1]).toMatchObject({ courier: null, docket: 'AWB-1' });
		await page.send();
		expect(page.error()).toBe('purchasing_action_failed');
		page.busy.set(true);
		await page.send();
		expect(sendReturn).toHaveBeenCalledTimes(3);
	});
});

describe('ReturnView', () => {
	const gateway = (over: Partial<Record<keyof PurchasingGateway, unknown>> = {}) => ({
		returnDoc: vi.fn(() => of(draft())),
		returnActivity: vi.fn(() => of([])),
		deleteReturn: vi.fn(() => of(null)),
		returnPdf: vi.fn(() => of(new Blob(['%PDF']))),
		...over,
	});

	it('does nothing before the return has loaded', async () => {
		viewDoc.set(undefined);
		const { page, modals, router } = render(ReturnView, gateway());
		expect(page.id()).toBe('');
		expect(page.step()).toBe(0);
		expect(page.open()).toBe(0);
		await page.send();
		await page.settle();
		await page.remove();
		await page.pdf('challan');
		expect(modals.open).not.toHaveBeenCalled();
		expect(router.navigate).not.toHaveBeenCalled();
	});

	it('sends, settles, deletes and prints a loaded return, and says when one fails', async () => {
		viewDoc.set(draft({ number: 'DN/1', challanNumber: 'DC/2', status: 'sent', settledINR: 400 }));
		const failing = vi.fn(() => throwError(() => new Error('down')));
		const { page, toasts, router } = render(ReturnView, gateway(), { id: 'pr_1' }, [
			draft({ number: 'DN/1' }),
			draft({ number: null }),
			new Error('dismissed'),
			{ settled: true },
			null,
			new Error('dismissed'),
		]);
		expect(page.step()).toBe(1);
		expect(page.open()).toBe(600);
		page.tab.set('activity');
		TestBed.tick();
		page.edit();
		expect(router.navigate).toHaveBeenCalledWith(['/purchase-returns', 'pr_1', 'edit']);
		await page.send();
		await page.send();
		await page.send();
		expect(toasts.showSuccess).toHaveBeenCalledWith('pr_sent {"number":"DN/1"}');
		expect(toasts.showSuccess).toHaveBeenCalledWith('pr_sent {"number":""}');
		await page.settle();
		await page.settle();
		await page.settle();
		expect(toasts.showSuccess).toHaveBeenCalledWith('pr_settled_saved');
		await page.pdf('debit-note');
		await page.pdf('challan');
		expect(files.saved.slice(-2)).toEqual(['DN-1.pdf', 'DC-2.pdf']);
		viewDoc.set(draft());
		await page.pdf('challan');
		expect(files.saved.at(-1)).toBe('pr_1.pdf');
		await page.remove();
		expect(router.navigate).toHaveBeenCalledWith(['/purchase-returns']);
		const broken = render(ReturnView, gateway({ deleteReturn: failing, returnPdf: failing }), { id: 'pr_1' });
		await broken.page.remove();
		await broken.page.pdf('debit-note');
		expect(broken.toasts.showError).toHaveBeenCalledTimes(2);
	});
});

describe('SettlePopup', () => {
	it('checks the amount against what is still open, and asks a credit note for its reference', async () => {
		const settleReturn = vi
			.fn()
			.mockReturnValueOnce(of(draft({ status: 'settled' })))
			.mockReturnValueOnce(throwError(() => new Error('down')));
		const { page, active } = render(SettlePopup, { settleReturn }, {}, [
			[{ assetId: 'med_cn', name: 'cn.pdf' }],
			new Error('closed'),
		]);
		expect(page.open()).toBe(0);
		await page.save();
		page.start(draft({ totalINR: 1000, settledINR: 400 }));
		expect(page.amount()).toBe('600');
		expect(page.problem()).toBeNull();
		expect(page.needsReference()).toBe(true);
		expect(page.canSave()).toBe(false);
		page.amount.set('');
		expect(page.problem()).toBeNull();
		page.amount.set('abc');
		expect(page.problem()).toBe('payment_amount_invalid');
		page.amount.set('0');
		expect(page.problem()).toBe('payment_amount_invalid');
		page.amount.set('900');
		expect(page.problem()).toBe('settle_more_than_open');
		page.amount.set('600');
		page.how.set('written_off');
		expect(page.canSave()).toBe(true);
		await page.pickCopy();
		await page.pickCopy();
		expect(page.copy()?.assetId).toBe('med_cn');
		await page.save();
		expect(settleReturn.mock.calls[0]?.[1]).toMatchObject({
			how: 'written_off',
			reference: null,
			amountINR: 600,
			attachmentAssetId: 'med_cn',
		});
		expect(active.close).toHaveBeenCalled();
		page.copy.set(null);
		page.reference.set(' CN/9 ');
		page.how.set('credit_note');
		await page.save();
		expect(settleReturn.mock.calls[1]?.[1]).toMatchObject({ reference: 'CN/9', attachmentAssetId: null });
		expect(page.error()).toBe('purchasing_action_failed');
		page.amount.set('');
		await page.save();
		expect(settleReturn).toHaveBeenCalledTimes(2);
	});
});
