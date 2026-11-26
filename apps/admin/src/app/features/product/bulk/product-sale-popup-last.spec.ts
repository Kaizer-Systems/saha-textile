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

const make = (answer: (body: ProductSaleWrite) => unknown, listed: unknown[] | Error = sales) => {
	const modal = { close: vi.fn(), dismiss: vi.fn() };
	const products = { addToSale: vi.fn((body: ProductSaleWrite) => answer(body)) };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbActiveModal, useValue: modal },
			{ provide: ProductService, useValue: products },
			{
				provide: ShopEventService,
				useValue: {
					list: vi.fn(() =>
						listed instanceof Error ? throwError(() => listed) : of({ data: listed, total: listed.length }),
					),
				},
			},
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
			if (line.productId === 'p3')
				return row('p3', [], { outcome: 'refused', reason: 'overlap', detail: 'Clash · Puja' });
			const skus =
				line.productId === 'p2'
					? [price('G', 2600, null, 'Green'), price('R', 2600, null, 'Rust')]
					: [price('S1', 2500)];
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

describe('ProductSalePopup: the last cases', () => {
	it('reads the chosen sale, still reads prices when the sales cannot be listed, and words rupees', async () => {
		const listed = make(engine);
		listed.popup.start(picks);
		await flush();
		expect(listed.popup.chosenSale()?.id).toBe('evt_run');
		listed.popup.eventId.set('gone');
		expect(listed.popup.chosenSale()).toBeNull();
		const unlisted = make(engine, new Error('down'));
		unlisted.popup.start(picks);
		await flush();
		expect(unlisted.popup.sales()).toEqual([]);
		expect(unlisted.popup.rows()).toHaveLength(3);
		expect(listed.popup.inr(null)).toBe('—');
		expect(listed.popup.inr(2500)).toBe('₹2,500');
	});

	it('a product the first dry run does not answer has no prices, and a check with nothing to send clears every result', async () => {
		vi.useFakeTimers();
		const partial = (body: ProductSaleWrite) =>
			of({ dryRun: true, eventId: body.eventId, eventStatus: null, rows: [row('p1', [price('S1', 2500)])] });
		const { popup, products } = make(partial);
		popup.start(picks.slice(0, 2));
		await flush();
		const second = popup.rows()[1] as never;
		expect(popup.nowINR(second)).toBeNull();
		expect(popup.saleFrom(second)).toBeNull();
		popup.setKind('fixed');
		expect(popup.problem(second)).toBe('empty');
		const asked = products.addToSale.mock.calls.length;
		await vi.advanceTimersByTimeAsync(300);
		expect(products.addToSale).toHaveBeenCalledTimes(asked);
		expect(popup.rows().map((entry) => entry.result)).toEqual([null, null]);
	});

	it('keeps a standing refusal through a later check, and a failed check counts as no answer', async () => {
		vi.useFakeTimers();
		let fail = false;
		const answer = (body: ProductSaleWrite) => (fail ? throwError(() => new Error('down')) : engine(body));
		const { popup } = make(answer);
		popup.start(picks);
		await flush();
		fail = true;
		popup.setValue('10');
		await vi.advanceTimersByTimeAsync(300);
		expect(popup.checking()).toBe(false);
		expect(popup.rows()[2]?.result?.reason).toBe('overlap');
		expect(popup.rows()[0]?.result).toBeNull();
	});

	it('reads only whole prices, and a confirm that cannot go yet or fails says so', async () => {
		vi.useFakeTimers();
		const { popup, products, modal } = make(engine);
		popup.start(picks);
		await flush();
		popup.setKind('fixed');
		popup.setProductPrice('p1', '-5');
		expect(popup.problem(popup.rows()[0] as never)).toBe('empty');
		popup.setProductPrice('p1', 'abc');
		expect(popup.problem(popup.rows()[0] as never)).toBe('empty');
		const asked = products.addToSale.mock.calls.length;
		await popup.confirm();
		expect(products.addToSale).toHaveBeenCalledTimes(asked);
		popup.setKind('percent');
		popup.setValue('10');
		await vi.advanceTimersByTimeAsync(300);
		products.addToSale.mockReturnValueOnce(throwError(() => new Error('down')) as never);
		await popup.confirm();
		expect(popup.failed()).toBe(true);
		expect(modal.close).not.toHaveBeenCalled();
	});
});
