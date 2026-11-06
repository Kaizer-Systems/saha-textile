import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { DeliveryBlock } from './delivery-block';

const render = (setting?: unknown) => {
	TestBed.resetTestingModule();
	TestBed.overrideComponent(DeliveryBlock, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(DeliveryBlock);
	if (setting) fixture.componentRef.setInput('setting', setting);
	const block = fixture.componentInstance;
	const seen: unknown[] = [];
	block.selectDelivery.subscribe((value) => seen.push(value));
	fixture.detectChanges();
	return { block, seen };
};

describe('DeliveryBlock', () => {
	it('emits the default delivery on start', () => {
		const { seen } = render({ delivery: { default: { title: 'Standard', description: '3 days' } } });
		expect(seen).toEqual([{ delivery_description: 'Standard | 3 days', delivery_interval: null }]);
	});

	it('emits nothing without delivery settings', () => {
		expect(render().seen).toEqual([]);
		expect(render({}).seen).toEqual([]);
		expect(render({ delivery: {} }).seen).toEqual([
			{ delivery_description: 'undefined | undefined', delivery_interval: null },
		]);
	});

	it('emits a chosen description and interval together', () => {
		const { block, seen } = render();
		block.setDeliveryDescription('Express', 'same_day');
		block.setDeliveryInterval('9-12', 1);
		expect(block.deliveryType).toBe('same_day');
		expect(block.selectedIndex).toBe(1);
		expect(seen.at(-1)).toEqual({ delivery_description: 'Express', delivery_interval: '9-12' });
	});
});
