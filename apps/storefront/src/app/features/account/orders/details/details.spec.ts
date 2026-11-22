import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';

import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { OrderDetails } from './details';

const order = signal<unknown>(undefined);
vi.mock('@data-access/queries/order.queries', () => ({
	injectMyOrderQuery: (number: () => unknown) => (number(), { data: order, isError: () => false }),
}));

const line = (over: Record<string, unknown>) => ({
	parentLineId: null,
	role: 'product',
	title: 'Piece',
	details: [],
	quantity: 1,
	unitPrice: 0,
	lineTotal: 0,
	mrp: null,
	imageUrl: null,
	set: null,
	...over,
});

describe('one of my orders (bundle builder brief E05)', () => {
	it('draws the tree and the steps reached', () => {
		order.set({
			orderNumber: 'ST-1',
			status: 'shipped',
			lines: [
				line({ lineId: 's', role: 'bundle', set: { heading: 'components', saved: 3500 } }),
				line({ lineId: 's~a', role: 'piece', parentLineId: 's' }),
				line({ lineId: 's~a>f', role: 'free', parentLineId: 's~a' }),
				line({ lineId: 's~b', role: 'piece', parentLineId: 's' }),
				line({ lineId: 's~x', role: 'extra', parentLineId: 's' }),
				line({ lineId: 'p' }),
			],
		});
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [{ provide: ActivatedRoute, useValue: { params: new BehaviorSubject({ id: 'ST-1' }) } }],
		});
		TestBed.overrideComponent(OrderDetails, { set: { imports: [], template: '' } });
		const page = TestBed.createComponent(OrderDetails).componentInstance;
		const lines = page.order()!.lines;
		expect(lines.map((row) => page.depthOf(row))).toEqual([0, 1, 2, 1, 1, 0]);
		expect(page.pieceNumber(lines[3]!)).toBe(2);
		expect(page.childCounts(lines[0]!)).toEqual({ pieces: 2, extras: 1, free: 0 });
		expect(page.itemCount()).toBe(2);
		expect(['placed', 'shipped', 'delivered'].map((s) => page.reached(s as never))).toEqual([true, true, false]);
	});
});
