import { type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PurchasingGateway } from '@core/purchasing/purchasing.gateway';

import { LineSearch, exactMatch } from './line-search';
import { ReasonPopup } from './reason-popup';
import { ScanPopup } from './scan-popup';
import { exportSupplierStatement, recordSupplierPayment } from './supplier-actions';
import { VariantGrid } from './variant-grid';

import type { PurchaseItemOption, SupplierSummary } from '@saha-textile/contracts';

const csv = vi.hoisted(() => ({ files: [] as Array<{ name: string; rows: unknown[][] }> }));
vi.mock('@core/purchasing/purchasing-format', async (original) => ({
	...(await original<typeof import('@core/purchasing/purchasing-format')>()),
	downloadCsv: (name: string, _header: string[], rows: unknown[][]) => void csv.files.push({ name, rows }),
}));

const transloco = { translate: (key: string) => key, getActiveLang: () => 'en', getTranslation: () => ({}) };

function render<T>(type: Type<T>, gateway: Partial<Record<keyof PurchasingGateway, unknown>> = {}) {
	const active = { close: vi.fn(), dismiss: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: PurchasingGateway, useValue: gateway },
			{ provide: TranslocoService, useValue: transloco },
			{ provide: NgbActiveModal, useValue: active },
		],
	});
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(type);
	TestBed.tick();
	return { page: fixture.componentInstance, fixture, active };
}

const option = (over: Partial<PurchaseItemOption> = {}) =>
	({
		variantId: 'var_1',
		productId: 'prd_1',
		sku: 'ST-1',
		supplierItemCode: null,
		blocked: null,
		variantCount: 1,
		soldBy: 'piece',
		lastCostINR: null,
		...over,
	}) as PurchaseItemOption;
const blocked = option({ variantId: 'var_x', sku: 'ST-X', blocked: 'discontinued' } as never);
const key = (name: string) => ({ key: name, preventDefault: vi.fn() }) as unknown as KeyboardEvent;

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('exactMatch', () => {
	it('picks one exact code or the only result, never a blocked one', () => {
		const coded = option({ variantId: 'var_c', sku: 'ST-2', supplierItemCode: 'ab-1' });
		expect(exactMatch([option()], '   ')).toBeNull();
		expect(exactMatch([option(), coded], ' st-1 ')?.variantId).toBe('var_1');
		expect(exactMatch([option(), coded], 'AB-1')?.variantId).toBe('var_c');
		expect(exactMatch([blocked], 'ST-X')).toBeNull();
		expect(exactMatch([option(), coded], 'silk')).toBeNull();
		expect(exactMatch([coded], 'silk')?.variantId).toBe('var_c');
	});
});

describe('LineSearch', () => {
	it('searches after a pause, highlights the first result that can take stock, and moves round it', async () => {
		vi.useFakeTimers();
		const searchItems = vi
			.fn()
			.mockReturnValueOnce(of([blocked, option(), option({ variantId: 'var_2', sku: 'ST-2' })]))
			.mockReturnValueOnce(throwError(() => new Error('down')));
		const { page, fixture } = render(LineSearch, { searchItems });
		fixture.componentRef.setInput('supplierId', 'sup_1');
		page.onInput('s');
		vi.advanceTimersByTime(250);
		expect(searchItems).not.toHaveBeenCalled();
		page.onKey(key('ArrowDown'));
		page.onInput('st');
		vi.advanceTimersByTime(250);
		expect(searchItems).toHaveBeenCalledWith('st', 'sup_1', false);
		expect(page.active()).toBe(1);
		expect(page.open()).toBe(true);
		page.onKey(key('ArrowDown'));
		expect(page.active()).toBe(2);
		page.onKey(key('ArrowDown'));
		expect(page.active()).toBe(1);
		page.onKey(key('ArrowUp'));
		expect(page.active()).toBe(2);
		page.onKey(key('Escape'));
		expect(page.open()).toBe(false);
		page.onKey(key('Tab'));
		page.onInput('sti');
		vi.advanceTimersByTime(250);
		expect(page.results()).toEqual([]);
	});

	it('picks with Enter: the highlighted result, an exact code, or the answer still coming from a scanner', () => {
		vi.useFakeTimers();
		const searchItems = vi
			.fn()
			.mockReturnValueOnce(of([option(), option({ variantId: 'var_2', sku: 'ST-2' })]))
			.mockReturnValueOnce(of([option({ variantId: 'var_2', sku: 'ST-2' })]))
			.mockReturnValueOnce(of([option(), option({ variantId: 'var_3', sku: 'ST-3' })]));
		const { page } = render(LineSearch, { searchItems });
		const picked: string[] = [];
		page.picked.subscribe((choice) => picked.push(choice.variantId));
		page.onInput('st');
		vi.advanceTimersByTime(250);
		page.onKey(key('Enter'));
		expect(picked).toEqual(['var_1']);
		// A scanner presses Enter before the answer comes back: picked when it arrives.
		page.onInput('ST-2');
		page.onKey(key('Enter'));
		vi.advanceTimersByTime(250);
		expect(picked).toEqual(['var_1', 'var_2']);
		page.onInput('silk');
		page.onKey(key('Enter'));
		vi.advanceTimersByTime(250);
		expect(picked).toEqual(['var_1', 'var_2']);
		page.open.set(false);
		page.text.set('ST-3');
		page.onKey(key('Enter'));
		expect(picked).toEqual(['var_1', 'var_2', 'var_3']);
	});

	it('sends a product with variants to its grid, refuses a blocked one, offers a draft, and closes after a moment', () => {
		vi.useFakeTimers();
		const { page } = render(LineSearch, { searchItems: () => of([]) });
		const products: string[] = [];
		const drafts: string[] = [];
		page.pickedProduct.subscribe((choice) => products.push(choice.productId));
		page.makeDraft.subscribe((text) => drafts.push(text));
		page.choose(option({ variantCount: 4 }));
		page.choose(blocked);
		expect(products).toEqual(['prd_1']);
		page.text.set('  New silk  ');
		page.draft();
		expect(drafts).toEqual(['New silk']);
		page.open.set(true);
		page.blur();
		vi.advanceTimersByTime(200);
		expect(page.open()).toBe(false);
	});
});

describe('ReasonPopup', () => {
	it('needs a reason of three letters, closes with what the action answers, and keeps a refusal open', async () => {
		const { page, active } = render(ReasonPopup);
		await page.confirm();
		const act = vi
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce({ id: 'po_1' })
			.mockRejectedValueOnce(new Error('down'));
		page.start({ title: 't', label: 'l', confirm: 'c', act });
		page.reason.set(' ab ');
		expect(page.canConfirm()).toBe(false);
		await page.confirm();
		page.reason.set('  Supplier closed  ');
		await page.confirm();
		expect(act).toHaveBeenCalledWith('Supplier closed');
		expect(active.close).toHaveBeenLastCalledWith(true);
		await page.confirm();
		expect(active.close).toHaveBeenLastCalledWith({ id: 'po_1' });
		await page.confirm();
		expect(page.error()).toBe('purchasing_action_failed');
	});
});

describe('ScanPopup', () => {
	it('works by typing where the browser has no barcode reader', async () => {
		const { page, active } = render(ScanPopup);
		expect(page.camera()).toBe(false);
		await page.startCamera();
		page.done('   ');
		expect(active.close).not.toHaveBeenCalled();
		page.done(' ST-1 ');
		expect(active.close).toHaveBeenCalledWith('ST-1');
		page.ngOnDestroy();
	});

	it('reads a label with the camera, skipping frames it cannot read, and stops the camera when done', async () => {
		vi.useFakeTimers();
		const track = { stop: vi.fn() };
		const detect = vi
			.fn()
			.mockResolvedValueOnce([])
			.mockRejectedValueOnce(new Error('blurred'))
			.mockResolvedValueOnce([{ rawValue: 'ST-9' }]);
		vi.stubGlobal(
			'BarcodeDetector',
			class {
				detect = detect;
			},
		);
		vi.stubGlobal('navigator', {
			...navigator,
			mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) },
		});
		const { page, active } = render(ScanPopup);
		expect(page.camera()).toBe(true);
		// No video element yet: nothing to read from.
		await page.startCamera();
		const video = { srcObject: null as unknown, play: vi.fn(async () => undefined) };
		Object.assign(page, { video: () => ({ nativeElement: video }) });
		await page.startCamera();
		await vi.advanceTimersByTimeAsync(600);
		expect(active.close).toHaveBeenCalledWith('ST-9');
		expect(track.stop).toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(600);
		expect(detect).toHaveBeenCalledTimes(3);
	});

	it('stops looking at the camera once a code is typed', async () => {
		vi.useFakeTimers();
		const detect = vi.fn(async () => []);
		vi.stubGlobal(
			'BarcodeDetector',
			class {
				detect = detect;
			},
		);
		vi.stubGlobal('navigator', {
			...navigator,
			mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
		});
		const { page, active } = render(ScanPopup);
		Object.assign(page, { video: () => ({ nativeElement: { play: async () => undefined } }) });
		await page.startCamera();
		await vi.advanceTimersByTimeAsync(10);
		page.done('ST-5');
		await vi.advanceTimersByTimeAsync(1000);
		expect(active.close).toHaveBeenCalledWith('ST-5');
		expect(detect).toHaveBeenCalledTimes(1);
	});

	it('falls back to typing when the camera is refused', async () => {
		vi.stubGlobal('BarcodeDetector', class {});
		vi.stubGlobal('navigator', {
			...navigator,
			mediaDevices: { getUserMedia: vi.fn(async () => Promise.reject(new Error('denied'))) },
		});
		const { page } = render(ScanPopup);
		await page.startCamera();
		expect(page.cameraError()).toBe(true);
		expect(page.camera()).toBe(false);
	});
});

describe('supplier actions', () => {
	const summary = (over: Record<string, unknown> = {}) =>
		({
			supplier: { shortName: '', legalName: 'Banaras Silk Weavers Co-op' },
			statement: [
				{
					date: '2026-11-01',
					documentNumber: 'PE/1',
					details: 'Bill',
					billINR: 1000,
					paidOrCreditedINR: 0,
					balanceINR: 1000,
				},
				{
					date: '2026-11-05',
					documentNumber: 'PAY/1',
					details: 'Paid',
					billINR: 0,
					paidOrCreditedINR: 400,
					balanceINR: 600,
				},
			],
			...over,
		}) as unknown as SupplierSummary;

	it('exports the statement under the short name, or the legal name when there is none', () => {
		exportSupplierStatement(summary(), (k) => k);
		exportSupplierStatement(summary({ supplier: { shortName: 'Banaras Co-op', legalName: 'x' } }), (k) => k);
		expect(csv.files.map((file) => file.name).slice(-2)).toEqual([
			'statement-banaras-silk-weavers-co-op.csv',
			'statement-banaras-co-op.csv',
		]);
		expect(csv.files.at(-1)?.rows).toEqual([
			['1 Nov 2026', 'PE/1', 'Bill', 1000, null, 1000],
			['5 Nov 2026', 'PAY/1', 'Paid', null, 400, 600],
		]);
	});

	it('records a payment against the oldest unpaid bills, or says there is nothing to pay', async () => {
		const bill = (id: string, dueOn: string, leftINR: number, status = 'posted') => ({
			id,
			number: id === 'pe_2' ? null : `PE/${id}`,
			billNumber: 'B1',
			totalINR: 1000,
			paidINR: 1000 - leftINR,
			leftINR,
			dueOn,
			status,
		});
		const entries = vi
			.fn()
			.mockReturnValueOnce(throwError(() => new Error('down')))
			.mockReturnValueOnce(of({ items: [bill('pe_0', '2026-11-01', 0)] }))
			.mockReturnValueOnce(
				of({
					items: [
						bill('pe_1', '2026-11-20', 500),
						bill('pe_2', '2026-11-05', 200),
						bill('pe_3', '2026-11-01', 300, 'draft'),
					],
				}),
			)
			.mockReturnValueOnce(of({ items: [bill('pe_1', '2026-11-20', 500)] }));
		const started: unknown[] = [];
		const results = [Promise.resolve({ saved: true }), Promise.reject(new Error('closed'))];
		const deps = {
			gateway: { entries } as never,
			expenseBills: { list: () => of([]) } as never,
			modals: {
				open: () => ({
					componentInstance: { start: (bills: unknown) => started.push(bills) },
					result: results.shift(),
				}),
			} as never,
			notifier: { showSuccess: vi.fn(), showError: vi.fn() } as never,
			queryClient: { invalidateQueries: vi.fn() } as never,
			t: (k: string) => k,
		};
		await recordSupplierPayment('sup_1', deps);
		await recordSupplierPayment('sup_1', deps);
		expect((deps.notifier as { showSuccess: ReturnType<typeof vi.fn> }).showSuccess).toHaveBeenCalledWith(
			'supplier_nothing_to_pay',
		);
		await recordSupplierPayment('sup_1', deps);
		expect(started[0]).toEqual([
			expect.objectContaining({ id: 'pe_2', number: '' }),
			expect.objectContaining({ id: 'pe_1', number: 'PE/pe_1' }),
		]);
		expect((deps.notifier as { showSuccess: ReturnType<typeof vi.fn> }).showSuccess).toHaveBeenCalledWith(
			'payment_saved',
		);
		await recordSupplierPayment('sup_1', deps);
		// Suppliers, purchase entries and expense bills are read again after a saved payment.
		expect(
			(deps.queryClient as { invalidateQueries: ReturnType<typeof vi.fn> }).invalidateQueries,
		).toHaveBeenCalledTimes(3);
	});

	it("lists the supplier's posted expense bills with something left beside the purchase entries, oldest due first", async () => {
		const entry = {
			id: 'pe_1',
			number: 'PE/1',
			billNumber: 'B1',
			totalINR: 500,
			paidINR: 0,
			leftINR: 500,
			dueOn: '2026-11-20',
			status: 'posted',
		};
		const expense = (id: string, over: Record<string, unknown> = {}) => ({
			id,
			supplierId: 'sup_1',
			number: `EB/${id}`,
			billNumber: `R-${id}`,
			billDate: '2026-11-01',
			dueOn: '2026-11-10',
			totalINR: 680,
			paidINR: 0,
			version: 3,
			...over,
		});
		const list = vi.fn(() =>
			of([
				expense('eb_1'),
				// No due date kept: the bill date stands in.
				expense('eb_2', { dueOn: null, billDate: '2026-11-15', number: null }),
				expense('eb_paid', { paidINR: 680 }),
				expense('eb_other', { supplierId: 'sup_2' }),
			]),
		);
		const started: unknown[] = [];
		await recordSupplierPayment('sup_1', {
			gateway: { entries: () => of({ items: [entry] }) } as never,
			expenseBills: { list } as never,
			modals: {
				open: () => ({
					componentInstance: { start: (bills: unknown) => started.push(bills) },
					result: Promise.reject(new Error('closed')),
				}),
			} as never,
			notifier: { showSuccess: vi.fn(), showError: vi.fn() } as never,
			queryClient: { invalidateQueries: vi.fn() } as never,
			t: (k: string) => k,
		});
		expect(list).toHaveBeenCalledWith({ status: 'posted', supplierId: 'sup_1' });
		expect(started[0]).toEqual([
			expect.objectContaining({ id: 'eb_1', number: 'EB/eb_1', leftINR: 680, expenseBillVersion: 3 }),
			expect.objectContaining({ id: 'eb_2', number: '', expenseBillVersion: 3 }),
			{ id: 'pe_1', number: 'PE/1', billNumber: 'B1', totalINR: 500, paidINR: 0, leftINR: 500 },
		]);
	});
});

describe('VariantGrid', () => {
	const red = option({ variantId: 'var_r', sku: 'ST-R', lastCostINR: 900 });
	const blue = option({ variantId: 'var_b', sku: 'ST-B' });
	const metre = option({ variantId: 'var_m', sku: 'ST-M', soldBy: 'metre' } as never);

	it('fills each colour’s price from its last cost or the product’s, and one typed price fills the rest', async () => {
		const variantGrid = vi
			.fn()
			.mockReturnValueOnce(of([red, blue, metre, blocked]))
			.mockReturnValueOnce(of([red, blue, metre, option({ variantId: 'var_g', sku: 'ST-G' })]))
			.mockReturnValueOnce(throwError(() => new Error('down')));
		const { page, active } = render(VariantGrid, { variantGrid });
		page.onWindowFocus();
		expect(variantGrid).not.toHaveBeenCalled();
		expect(page.newVariantLink()).toBe('/product/edit/?tab=inventory');
		await page.start(option({ productId: 'prd 1', lastCostINR: 750 }), 'sup_1', 'unit_price_order');
		expect(page.rows().map((row) => row.price)).toEqual(['900', '750', '750']);
		expect(page.priceLabel()).toBe('unit_price_order');
		expect(page.newVariantLink()).toBe('/product/edit/prd%201?tab=inventory');
		page.setPrice(1, '800');
		expect(page.rows().map((row) => [row.price, row.ownPrice])).toEqual([
			['800', false],
			['800', true],
			['800', false],
		]);
		page.setPrice(0, '820');
		expect(page.rows()[1]?.price).toBe('800');
		page.add();
		page.setQuantity(0, '2');
		page.setQuantity(2, '1.5');
		// 2 pieces at 820, and 1.5 m at 820 too: the metre row follows the price typed last.
		expect(page.summary()).toEqual({ lines: 2, value: 2870 });
		// Back from the product's Variants tab: a colour added there shows up, typed rows stay.
		page.onWindowFocus();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(page.rows().map((row) => row.option.variantId)).toEqual(['var_r', 'var_b', 'var_m', 'var_g']);
		expect(page.rows()[3]?.price).toBe('820');
		expect(page.rows()[0]?.quantity).toBe('2');
		page.onWindowFocus();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(page.error()).toBe('purchasing_action_failed');
		page.add();
		expect(active.close).toHaveBeenCalledWith([
			expect.objectContaining({ units: 2, priceINR: 820 }),
			expect.objectContaining({ units: 15, priceINR: 820 }),
		]);
	});

	it('names a row’s problem, and adds nothing while one stands or nothing is typed', async () => {
		const { page, active } = render(VariantGrid, { variantGrid: () => of([red, blue]) });
		await page.start(option({ lastCostINR: null }), null);
		expect(page.rows().map((row) => row.price)).toEqual(['900', '']);
		expect(page.problemOf(9)).toBeNull();
		page.setQuantity(0, '1.5');
		expect(page.problemOf(0)).toBe('qty_whole_pieces');
		page.setQuantity(0, '1');
		page.setPrice(0, 'abc');
		expect(page.problemOf(0)).toBe('payment_amount_invalid');
		expect(page.hasProblem()).toBe(true);
		page.add();
		page.setPrice(0, '900');
		expect(page.problemOf(0)).toBeNull();
		page.setQuantity(0, '');
		page.add();
		expect(active.close).not.toHaveBeenCalled();
	});
});
