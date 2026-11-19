import { TestBed } from '@angular/core/testing';

import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProductService } from '@data-access/services/product.service';
import { ShopEventService } from '@data-access/services/shop-event.service';

import { ProductSalePopup } from './product-sale-popup';

import type { ProductSaleWrite } from '@saha-textile/contracts';

const price = (sku: string, normalINR: number, saleINR: number | null = null, label = '') => ({
	sku,
	label,
	normalINR,
	saleINR,
	refused: false,
	warning: false,
});
const row = (productId: string, prices: ReturnType<typeof price>[], over: Record<string, unknown> = {}) => ({
	productId,
	title: productId,
	sku: productId,
	status: 'live',
	thumbnailUrl: null,
	outcome: 'done',
	reason: null,
	detail: '',
	viaCategory: false,
	prices,
	...over,
});
const sales = [
	{ id: 'evt_d', status: 'draft', name: 'Poila' },
	{ id: 'evt_end', status: 'ended', name: 'Old' },
	{ id: 'evt_run', status: 'live', name: 'Winter', endsAt: '2026-11-30T18:29:00.000Z' },
];

const flush = async () => {
	for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

const make = (answer: (body: ProductSaleWrite) => unknown, listed: unknown[] = sales) => {
	const modal = { close: vi.fn(), dismiss: vi.fn() };
	const products = { addToSale: vi.fn((body: ProductSaleWrite) => answer(body)) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbActiveModal, useValue: modal },
			{ provide: ProductService, useValue: products },
			{ provide: ShopEventService, useValue: { list: vi.fn(() => of({ data: listed, total: listed.length })) } },
		],
	});
	TestBed.overrideComponent(ProductSalePopup, { set: { imports: [], template: '' } });
	const popup = TestBed.createComponent(ProductSalePopup).componentInstance;
	return { popup, modal, products };
};

const picks = [
	{ id: 'p1', title: 'Maroon', thumbnailUrl: null },
	{ id: 'p2', title: 'Mango Buti', thumbnailUrl: null },
	{ id: 'p3', title: 'Clash', thumbnailUrl: null },
];

/** The sale engine, roughly: % off, ₹ off or the typed price, and p3 in another sale. */
const engine = (body: ProductSaleWrite) =>
	of({
		dryRun: body.dryRun,
		eventId: body.eventId,
		eventStatus: body.eventId ? 'live' : null,
		rows: body.lines.map((line) => {
			if (line.productId === 'p3') return row('p3', [], { outcome: 'refused', reason: 'overlap', detail: 'Clash · Puja' });
			const skus = line.productId === 'p2' ? [price('G', 2600, null, 'Green'), price('R', 2600, null, 'Rust')] : [price('S1', 2500)];
			return row(
				line.productId,
				skus.map((sku) => ({
					...sku,
					saleINR:
						line.rule.kind === 'percent'
							? Math.floor((sku.normalINR * (100 - line.rule.value)) / 100)
							: line.rule.kind === 'amount'
								? sku.normalINR - line.rule.value
								: (line.rule.skuPrices[sku.sku] ?? line.rule.value),
				})),
			);
		}),
	});

afterEach(() => vi.useRealTimers());

describe('ProductSalePopup', () => {
	it('offers open sales, running first, and reads every product’s prices', async () => {
		const { popup } = make(engine);
		popup.start(picks);
		await flush();
		expect(popup.sales().map((sale) => sale.id)).toEqual(['evt_run', 'evt_d']);
		expect(popup.eventId()).toBe('evt_run');
		expect(popup.rows().map((row) => row.skus.length)).toEqual([1, 2, 0]);
		expect(popup.usable(popup.rows()[2] as never)).toBe(false);
		expect(popup.hasColours(popup.rows()[1] as never)).toBe(true);
		expect(popup.nowINR(popup.rows()[0] as never)).toBe(2500);
	});

	it('puts % off on every product and shows the engine’s prices', async () => {
		vi.useFakeTimers();
		const { popup, modal, products } = make(engine);
		popup.start(picks);
		await flush();
		popup.setValue('10');
		vi.advanceTimersByTime(300);
		await flush();
		expect(popup.saleFrom(popup.rows()[0] as never)).toBe(2250);
		expect(popup.joining()).toBe(2);
		expect(popup.canConfirm()).toBe(true);
		await popup.confirm();
		const sent = products.addToSale.mock.calls.at(-1)?.[0] as ProductSaleWrite;
		expect(sent).toMatchObject({ eventId: 'evt_run', dryRun: false });
		expect(sent.lines.map((line) => line.productId)).toEqual(['p1', 'p2']);
		expect(modal.close).toHaveBeenCalledWith(expect.objectContaining({ created: false }));
	});

	it('takes a fixed price per product, or per colour, and waits for every box', async () => {
		const { popup } = make(engine);
		popup.start(picks);
		await flush();
		popup.setKind('fixed');
		const [first, second] = popup.rows() as never[];
		expect(popup.problem(first)).toBe('empty');
		expect(popup.toFix()).toBe(2);
		popup.setProductPrice('p1', '2,700');
		expect(popup.problem(first)).toBe('above');
		expect(popup.priceAbove(2500, '2700')).toBe(true);
		popup.setProductPrice('p1', '1999');
		expect(popup.offPercent(2500, '1999')).toBe(20);
		expect(popup.offPercent(null, '1')).toBeNull();
		expect(popup.overWarning(61)).toBe(true);
		popup.togglePerColour('p2');
		popup.setSkuPrice('G', '2199');
		expect(popup.problem(second)).toBe('empty');
		popup.fillAll.set('1999');
		popup.fillEmpty();
		expect(popup.skuPrice()).toEqual({ G: '2199', R: '1999', S1: '1999' });
		expect(popup.problem(second)).toBeNull();
		expect(popup.lines()).toEqual([
			{ productId: 'p1', rule: { kind: 'fixed', value: 1999, skuPrices: {} } },
			{ productId: 'p2', rule: { kind: 'fixed', value: 1999, skuPrices: { G: 2199, R: 1999 } } },
		]);
		popup.togglePerColour('p2');
		expect(popup.perColour().has('p2')).toBe(false);
		popup.fillAll.set('');
		popup.fillEmpty();
	});

	it('makes a new draft sale, and says when the dry run fails', async () => {
		const { popup, modal } = make(engine, []);
		popup.start(picks.slice(0, 1));
		await flush();
		expect(popup.saleId()).toBeNull();
		popup.setKind('amount');
		popup.setValue('300');
		expect(popup.lines()).toEqual([{ productId: 'p1', rule: { kind: 'amount', value: 300, skuPrices: {} } }]);
		popup.setValue('-1');
		expect(popup.lines()).toEqual([]);
		popup.setKind('nonsense');
		expect(popup.kind()).toBe('percent');
		popup.pickSale('new');
		await flush();
		const broken = make(() => throwError(() => new Error('down')));
		broken.popup.start(picks);
		await flush();
		expect(broken.popup.failed()).toBe(true);
		popup.rows.update((rows) => rows.map((row) => ({ ...row, result: { ...(row.result ?? {}), outcome: 'done' } as never })));
		popup.setValue('5');
		await popup.confirm();
		expect(modal.close).toHaveBeenCalledWith(expect.objectContaining({ created: true }));
	});
});
