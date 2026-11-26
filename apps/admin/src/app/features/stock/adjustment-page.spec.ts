import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StockGateway } from '@core/purchasing/stock.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

import { AdjustPopup } from './adjust-popup';
import { AdjustmentPage, adjustmentLog, layerCost, signedQuantity } from './adjustment-page';
import { StockItem, documentLink, movementPill } from './stock-item';

import type { AdjustmentDetail, AdjustmentRequest, StockListRow } from '@saha-textile/contracts';

/** A posted stock adjustment's page (accounts brief D5, E3) and E1's "What happens to it" in Adjust stock. */

const request = (over: Partial<AdjustmentRequest> = {}): AdjustmentRequest => ({
	id: 'adj_1',
	kind: 'adjustment',
	variantId: 'var_1',
	productId: 'prd_1',
	sku: 'PTC-CRM-M',
	title: 'Cotton petticoat · cream · M',
	imageUrl: null,
	soldBy: 'piece',
	action: 'remove',
	quantity: 2,
	reasonCode: 'damage',
	holdId: null,
	note: 'Two stained in the store-room leak.',
	photoAssetIds: [],
	valueAtCostINR: 620,
	costBreakdown: '2 at ₹310',
	countId: null,
	countNumber: null,
	countSummary: null,
	status: 'applied',
	requestedBy: 'usr_2',
	requestedByName: 'Store manager',
	requestedAt: '2026-11-22T05:32:00.000Z',
	decidedBy: 'adm_1',
	decidedByName: 'Owner',
	decidedAt: '2026-11-22T06:00:00.000Z',
	rejectReason: null,
	selfApproved: false,
	number: 'SA/26-27/0004',
	outcome: 'writtenOff',
	itcReversedINR: 31,
	journalNumber: 'JV/26-27/000013',
	reverses: null,
	reversedBy: null,
	reversedAt: null,
	applied: {
		onHandBefore: 14,
		onHandAfter: 12,
		layers: [{ quantity: 2, unitCostINR: 310, source: 'OS/26-27/000001' }],
	},
	...over,
});
const detail = (over: Partial<AdjustmentDetail> = {}, r: Partial<AdjustmentRequest> = {}): AdjustmentDetail => ({
	request: request(r),
	whatChanged: {
		ledger: { change: -2, onHandBefore: 14, onHandAfter: 12 },
		layers: [{ quantity: 2, unitCostINR: 310, source: 'OS/26-27/000001' }],
		valueINR: 620,
		itc: { amountINR: 31, journalNumber: 'JV/26-27/000013' },
	},
	reverses: null,
	reversedBy: null,
	canReverse: true,
	reverseNumber: 'SA/26-27/0005',
	...over,
});
const words = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key);

describe('E3 helpers', () => {
	it('says the change with its sign and a layer’s cost per piece or per metre', () => {
		expect(signedQuantity({ action: 'remove', quantity: 2, soldBy: 'piece' })).toBe('−2');
		expect(signedQuantity({ action: 'add', quantity: 15, soldBy: 'metre' })).toBe('+1.5 m');
		expect(layerCost({ quantity: 2, unitCostINR: 310, source: null }, 'piece')).toBe('₹310');
		expect(layerCost({ quantity: 20, unitCostINR: 31, source: null }, 'metre')).toBe('₹310 / m');
	});

	it('writes the edit log: asked, approved, the system’s voucher, and the reversal', () => {
		const rows = adjustmentLog(
			detail(
				{ reversedBy: { id: 'adj_2', number: 'SA/26-27/0005', byName: 'Owner' } },
				{ reversedAt: '2026-11-24T05:00:00.000Z' },
			),
			words,
		);
		expect(rows.map((row) => [row.who, row.key])).toEqual([
			['Store manager', 'sa_log_asked'],
			['Owner', 'sa_log_approved'],
			['sa_system', 'sa_log_journal_itc'],
			['Owner', 'sa_log_reversed'],
		]);
		expect(rows[0]?.params).toEqual({ change: '−2', reason: 'reason_code_damage' });
		expect(rows[2]?.params).toEqual({ journal: 'JV/26-27/000013', amount: '₹31' });
		expect(rows[3]).toMatchObject({ at: '2026-11-24T05:00:00.000Z', params: { number: 'SA/26-27/0005' } });
	});

	it('writes a rejection, one waiting, one made and posted at once, and a reversal, with dashes for what is missing', () => {
		const rejected = adjustmentLog(
			detail(
				{},
				{
					status: 'rejected',
					rejectReason: 'No photo',
					number: null,
					journalNumber: null,
					decidedByName: null,
				},
			),
			words,
		);
		expect(rejected.map((row) => [row.who, row.key])).toEqual([
			['Store manager', 'sa_log_asked'],
			['—', 'sa_log_rejected'],
		]);
		expect(rejected[1]?.params).toEqual({ number: '—', why: 'No photo' });
		const waiting = adjustmentLog(
			detail(
				{},
				{ status: 'pending', decidedAt: null, journalNumber: null, reasonCode: null, requestedByName: null },
			),
			words,
		);
		expect(waiting).toEqual([
			{ at: '2026-11-22T05:32:00.000Z', who: '—', key: 'sa_log_asked', params: { change: '−2', reason: '—' } },
		]);
		const made = adjustmentLog(
			detail({}, { selfApproved: true, requestedByName: null, itcReversedINR: null, decidedAt: null }),
			words,
		);
		expect(made.map((row) => [row.who, row.key, row.at])).toEqual([
			['—', 'sa_log_made', '2026-11-22T05:32:00.000Z'],
			['sa_system', 'sa_log_journal', '2026-11-22T05:32:00.000Z'],
		]);
		const reversal = adjustmentLog(
			detail(
				{ reverses: { id: 'adj_0', number: null }, reversedBy: { id: 'adj_9', number: null, byName: null } },
				{ requestedByName: null, note: 'Found', number: null, journalNumber: null, reversedAt: null },
			),
			words,
		);
		expect(reversal).toEqual([
			{ at: '2026-11-22T05:32:00.000Z', who: '—', key: 'sa_log_reverses', params: { number: '—', why: 'Found' } },
			{ at: '2026-11-22T05:32:00.000Z', who: '—', key: 'sa_log_reversed', params: { number: '—' } },
		]);
		const named = adjustmentLog(detail({ reverses: { id: 'adj_0', number: 'SA/26-27/0003' } }), words);
		expect(named[0]).toMatchObject({ who: 'Store manager', params: { number: 'SA/26-27/0003' } });
	});

	it('links a write-off or addition in Stock history to its page, never a hold', () => {
		expect(
			documentLink({ documentType: 'stock_adjustment', documentId: 'adj_1', source: 'manual_adjustment' }),
		).toEqual(['/stock/adjustments', 'adj_1']);
		expect(documentLink({ documentType: 'stock_adjustment', documentId: 'adj_1', source: 'hold' })).toBeNull();
		expect(documentLink({ documentType: 'stock_adjustment', documentId: 'adj_1' })).toBeNull();
		expect(documentLink({ documentType: 'purchase_return', documentId: 'r1' })).toEqual([
			'/purchase-returns',
			'r1',
		]);
		expect(documentLink({ documentType: 'stock_count', documentId: 'c1' })).toEqual(['/stock-counts', 'c1']);
		expect(documentLink({ documentType: 'order', documentId: 'o1' })).toEqual(['/order', 'details', 'o1']);
		expect(documentLink({ documentType: 'opening_stock', documentId: 'os1' })).toBeNull();
		expect(documentLink({ documentType: 'order', documentId: null })).toBeNull();
		expect(movementPill({ source: 'stock_count', quantityDelta: 2, heldDelta: 0 })).toBe('processing');
	});

	it('reads Stock history again after Adjust, and not when the popup is closed', async () => {
		const opened: Array<{ result: Promise<unknown> }> = [];
		const modals = {
			open: vi.fn(() => {
				const popup = {
					componentInstance: { start: vi.fn(async () => undefined) },
					result: opened.length ? Promise.reject(new Error('closed')) : Promise.resolve({ id: 'adj_1' }),
				};
				opened.push(popup);
				return popup;
			}),
		};
		const queryClient = new QueryClient();
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			imports: [
				StockItem,
				TranslocoTestingModule.forRoot({
					langs: { en: {} },
					translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
					preloadLangs: true,
				}),
			],
			providers: [
				provideRouter([]),
				provideTanStackQuery(queryClient),
				{ provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'var_1' }) } } },
				{ provide: StockGateway, useValue: { detail: vi.fn(() => of({ row: { variantId: 'var_1' } })) } },
				{ provide: NgbModal, useValue: modals },
				{ provide: AuthStore, useValue: { permissions: signal([]) } },
			],
		});
		const item = TestBed.createComponent(StockItem).componentInstance;
		await vi.waitFor(() => expect(item.detail()).toBeTruthy());
		const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
		await item.adjust();
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['stock'] });
		invalidate.mockClear();
		await item.adjust();
		expect(invalidate).not.toHaveBeenCalled();
	});
});

function page(
	options: {
		data?: AdjustmentDetail;
		pdfFails?: boolean;
		reverseFails?: unknown;
		popup?: unknown;
		noId?: boolean;
	} = {},
) {
	const gateway = {
		adjustment: vi.fn(() => of(options.data ?? detail())),
		adjustmentPdf: vi.fn(() =>
			options.pdfFails ? throwError(() => new Error('offline')) : of(new Blob(['%PDF'])),
		),
		reverseAdjustment: vi.fn(() =>
			options.reverseFails ? throwError(() => options.reverseFails) : of(request({ id: 'adj_2' })),
		),
	};
	const started: unknown[] = [];
	const modals = {
		open: vi.fn(() => ({
			componentInstance: { start: (ask: unknown) => started.push(ask) },
			result:
				options.popup === 'dismiss'
					? Promise.reject(new Error('dismissed'))
					: Promise.resolve(options.popup ?? true),
		})),
	};
	const notifier = { showError: vi.fn(), showSuccess: vi.fn() };
	const queryClient = new QueryClient();
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			AdjustmentPage,
			TranslocoTestingModule.forRoot({
				langs: { en: { sa_problem_reason_required: 'Say why.', purchasing_action_failed: 'Failed.' } },
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideRouter([]),
			provideTanStackQuery(queryClient),
			{
				provide: ActivatedRoute,
				useValue: { paramMap: of(convertToParamMap(options.noId ? {} : { id: 'adj_1' })) },
			},
			{ provide: StockGateway, useValue: gateway },
			{ provide: NgbModal, useValue: modals },
			{ provide: NotificationService, useValue: notifier },
		],
	});
	const fixture = TestBed.createComponent(AdjustmentPage);
	return { fixture, page: fixture.componentInstance, gateway, modals, started, notifier, queryClient };
}

async function loaded(options: Parameters<typeof page>[0] = {}) {
	const ready = page(options);
	ready.fixture.detectChanges();
	await vi.waitFor(() => expect(ready.page.detail.data()).toBeTruthy());
	ready.fixture.detectChanges();
	return ready;
}

describe('the adjustment page (E3)', () => {
	afterEach(() => vi.restoreAllMocks());

	it('shows a posted write-off: details, edit log, what it changed and the Reverse note', async () => {
		const { fixture, page: p } = await loaded();
		const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
		expect(text).toContain('SA/26-27/0004');
		expect(text).toContain('sa_changed_layer_taken');
		expect(text).toContain('JV/26-27/000013');
		expect(p.status(p.detail.data() as AdjustmentDetail)).toBe('posted');
		expect(p.log()).toHaveLength(3);
		expect((fixture.nativeElement as HTMLElement).querySelector('#sa_reverse_open')).not.toBeNull();
	});

	it('draws a reversed addition, a reversal, one waiting and one rejected', async () => {
		const reversed = await loaded({
			data: detail(
				{
					reversedBy: { id: 'adj_2', number: null, byName: 'Owner' },
					canReverse: false,
					reverseNumber: null,
					whatChanged: {
						ledger: null,
						layers: [{ quantity: 2, unitCostINR: 310, source: null }],
						valueINR: null,
						itc: { amountINR: null, journalNumber: 'JV/26-27/000013' },
					},
				},
				{
					action: 'add',
					number: null,
					variantId: null,
					note: '',
					outcome: null,
					reasonCode: null,
					selfApproved: true,
				},
			),
		});
		expect(reversed.page.status(reversed.page.detail.data() as AdjustmentDetail)).toBe('reversed');
		const reversal = await loaded({
			data: detail(
				{
					reverses: { id: 'adj_0', number: null },
					canReverse: false,
					reverseNumber: null,
					whatChanged: { ledger: null, layers: [], valueINR: 620, itc: null },
				},
				{ action: 'add' },
			),
		});
		expect((reversal.fixture.nativeElement as HTMLElement).textContent).toContain('sa_reverses_note');
		const waiting = await loaded({
			data: detail({ canReverse: false }, { status: 'pending', decidedByName: null }),
		});
		expect(waiting.page.status(waiting.page.detail.data() as AdjustmentDetail)).toBe('pending');
		const rejected = await loaded({ data: detail({ canReverse: false }, { status: 'rejected' }) });
		expect(rejected.page.status(rejected.page.detail.data() as AdjustmentDetail)).toBe('rejected');
		expect(rejected.page.opposite(request({ action: 'add' }))).toBe('−2');
	});

	it('prints the adjustment, says when printing failed, and never prints twice at once', async () => {
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:sa');
		const { page: p, gateway } = await loaded();
		await p.print();
		expect(gateway.adjustmentPdf).toHaveBeenCalledWith('adj_1');
		expect(open).toHaveBeenCalledWith('blob:sa', '_blank', 'noopener');
		p.busy.set(true);
		await p.print();
		expect(gateway.adjustmentPdf).toHaveBeenCalledTimes(1);
		const failing = await loaded({ pdfFails: true });
		await failing.page.print();
		expect(failing.notifier.showError).toHaveBeenCalledWith('Failed.');
		expect(failing.page.busy()).toBe(false);
	});

	it('reverses with a reason: the popup names the numbers, a refusal is said in words, the stock reads again', async () => {
		const { page: p, started, gateway, notifier, queryClient } = await loaded();
		const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
		await p.reverse(p.detail.data() as AdjustmentDetail);
		const ask = started[0] as { params: unknown; act: (reason: string) => Promise<unknown> };
		expect(ask.params).toEqual({
			number: 'SA/26-27/0004',
			next: 'SA/26-27/0005',
			change: '+2',
			journal: 'JV/26-27/000013',
		});
		await ask.act('Counted wrong');
		expect(gateway.reverseAdjustment).toHaveBeenCalledWith('adj_1', 'Counted wrong');
		expect(invalidate).toHaveBeenCalledWith({ queryKey: ['stock'] });
		expect(notifier.showSuccess).toHaveBeenCalledWith('sa_reversed_done');
		const refused = await loaded({
			reverseFails: {
				error: { message: 'reason_required', issues: [{ code: 'reason_required', message: 'x' }] },
			},
			popup: 'dismiss',
		});
		await refused.page.reverse(detail({}, { journalNumber: null }));
		const refusedAsk = refused.started[0] as {
			params: { journal: string };
			act: (reason: string) => Promise<unknown>;
		};
		expect(refusedAsk.params.journal).toBe('—');
		await expect(refusedAsk.act('no')).rejects.toEqual({ error: { message: 'Say why.' } });
		expect(refused.notifier.showSuccess).not.toHaveBeenCalled();
		expect(refused.page.problem(new Error('offline'))).toBe('Failed.');
		expect(refused.page.problem({ error: { issues: [{ code: 'db_down', message: 'Database down' }] } })).toBe(
			'Database down',
		);
	});

	it('waits for an id before asking', () => {
		const { page: p, gateway, fixture } = page({ noId: true });
		fixture.detectChanges();
		expect([p.id(), p.log()]).toEqual(['', []]);
		expect(gateway.adjustment).not.toHaveBeenCalled();
	});
});

describe('the stock gateway for adjustments', () => {
	it('reads, reverses and prints an adjustment', () => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), StockGateway] });
		const gateway = TestBed.inject(StockGateway);
		const http = TestBed.inject(HttpTestingController);
		gateway.adjustment('adj/1').subscribe();
		http.expectOne((req) => req.url.endsWith('/stock/adjustments/adj%2F1') && req.method === 'GET').flush({});
		gateway.reverseAdjustment('adj_1', 'Counted wrong').subscribe();
		const reverse = http.expectOne((req) => req.url.endsWith('/stock/adjustments/adj_1/reverse'));
		expect(reverse.request.body).toEqual({ reason: 'Counted wrong' });
		reverse.flush({});
		gateway.adjustmentPdf('adj_1').subscribe();
		const pdf = http.expectOne((req) => req.url.endsWith('/stock/adjustments/adj_1/pdf'));
		expect(pdf.request.responseType).toBe('blob');
		pdf.flush(new Blob());
		http.verify();
	});
});

describe('Adjust stock: what happens to removed pieces (E1)', () => {
	const row = { variantId: 'var_1', soldBy: 'piece', onHand: 14, held: 0, freeToSell: 14 } as StockListRow;

	function popup(permissions = ['stock.adjust']) {
		const preview = {
			onHandAfter: 12,
			freeAfter: 12,
			valueAtCostINR: 620,
			costBreakdown: '2 at ₹310',
			refusal: null,
			posting: { number: 'SA/26-27/0004', itcINR: 31, journalNumber: 'JV/26-27/000013' },
		};
		const gateway = {
			holdsOf: vi.fn(() => of([])),
			preview: vi.fn(() => of(preview)),
			adjust: vi.fn(() => of({})),
		};
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			imports: [
				AdjustPopup,
				TranslocoTestingModule.forRoot({
					langs: { en: {} },
					translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
					preloadLangs: true,
				}),
			],
			providers: [
				{ provide: NgbActiveModal, useValue: { close: vi.fn(), dismiss: vi.fn() } },
				{ provide: NgbModal, useValue: { open: vi.fn() } },
				{ provide: StockGateway, useValue: gateway },
				{ provide: AuthStore, useValue: { permissions: signal(permissions) } },
			],
		});
		const fixture = TestBed.createComponent(AdjustPopup);
		return { fixture, popup: fixture.componentInstance, gateway, preview };
	}

	it('writes off by default, keeps pieces as damaged when chosen, and never asks that of held pieces', async () => {
		const { fixture, popup: p } = popup();
		await p.start(row);
		p.quantity.set('2');
		p.note.set('Two stained.');
		expect(p.body()).toMatchObject({ action: 'remove', outcome: 'writtenOff' });
		expect([p.effectiveAction(), p.needsApproval(), p.buttonKey()]).toEqual(['remove', true, 'ask_for_approval']);
		p.setOutcome('keptDamaged');
		expect(p.body()).toMatchObject({ outcome: 'keptDamaged' });
		expect([p.effectiveAction(), p.needsApproval(), p.buttonKey()]).toEqual(['hold', false, 'adjust_do_hold']);
		p.holdId.set('hold_1');
		expect(p.body()).toMatchObject({ outcome: 'writtenOff', holdId: 'hold_1' });
		expect(p.effectiveAction()).toBe('remove');
		p.setAction('add');
		expect(p.body()).not.toHaveProperty('outcome');
		fixture.detectChanges();
	});

	it('keeps the photos when the picker is closed', async () => {
		const { popup: p } = popup();
		const modals = TestBed.inject(NgbModal) as unknown as { open: ReturnType<typeof vi.fn> };
		modals.open.mockReturnValue({
			componentInstance: { start: vi.fn() },
			result: Promise.reject(new Error('closed')),
		});
		await p.addPhotos();
		expect(p.photos()).toEqual([]);
	});

	it('shows the number, voucher and input tax a write-off would take, or the voucher alone', async () => {
		const { fixture, popup: p, preview } = popup(['stock.approve']);
		await p.start(row);
		p.quantity.set('2');
		p.preview.set(preview as never);
		fixture.detectChanges();
		const note = () =>
			(fixture.nativeElement as HTMLElement).querySelector('#adjust_posting_note')?.textContent ?? '';
		expect(note()).toContain('adjust_posting_number');
		expect(note()).toContain('adjust_posting_itc');
		p.preview.set({ ...preview, posting: { ...preview.posting, itcINR: null } } as never);
		fixture.detectChanges();
		expect(note()).toContain('adjust_posting_journal');
		p.preview.set({ ...preview, posting: { ...preview.posting, itcINR: null, journalNumber: null } } as never);
		fixture.detectChanges();
		expect(note()).not.toContain('adjust_posting_journal');
		p.setOutcome('writtenOff');
		expect(p.buttonKey()).toBe('adjust_do_remove');
	});
});
