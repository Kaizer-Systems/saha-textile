import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { BuyBar } from './buy-bar';

const colour = { id: 1, name: 'Colour', style: 'color', attribute_values: [{ id: 11 }, { id: 12 }] };
const size = { id: 2, name: 'Size', style: 'rectangle', attribute_values: [{ id: 21 }, { id: 22 }] };
const variations = [
	{ attribute_values: [{ id: 11 }, { id: 21 }], quantity: 3, stock_status: 'in_stock' },
	{ attribute_values: [{ id: 12 }, { id: 22 }], quantity: 5, stock_status: 'in_stock' },
];

const axes = (summary: unknown) => {
	TestBed.resetTestingModule();
	TestBed.overrideComponent(BuyBar, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(BuyBar);
	fixture.componentRef.setInput('host', {
		product: signal({ attributes: [colour, size], variations }),
		summary: signal(summary),
	});
	return fixture.componentInstance.axes();
};

describe('BuyBar: option rows before and after a choice', () => {
	it('picks nothing before the configurator reports', () => {
		expect(axes(null).map((axis) => axis.pick)).toEqual([null, null]);
	});

	it('counts each size against the colour chosen, and none where no variation has the pair', () => {
		const [, sizes] = axes({ variation: { attribute_values: [{ id: 11, attribute_id: 1 }] } });
		expect(sizes?.pick).toBeNull();
		expect(sizes?.values.map((value) => [value.value.id, value.quantity, value.soldOut])).toEqual([
			[21, 3, false],
			[22, 0, true],
		]);
	});
});
