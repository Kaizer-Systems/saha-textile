import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { BundleConfigurator } from './bundle-configurator';

import type { ConfiguratorState } from '@data-access/interfaces/product-detail.interface';

const bundle = (overrides: Record<string, unknown> = {}) =>
	({
		bundle: {
			bundle_price: 3000,
			components: [{ code: 'saree', stock_status: 'in_stock' }],
			option_groups: [
				{
					code: 'blouse',
					default_term_code: 'plain',
					terms: [
						{ code: 'plain', label: 'Plain' },
						{ code: 'stitched', label: 'Stitched', price_delta: 700, requires_measurements: true },
					],
				},
				{ code: 'fall', terms: [{ code: 'yes', label: 'Yes', price_delta: 50 }] },
				{ code: 'empty', terms: [] },
			],
			...overrides,
		},
	}) as never;

const render = (product: unknown = bundle(), inputs: Record<string, unknown> = {}) => {
	TestBed.resetTestingModule();
	TestBed.overrideComponent(BundleConfigurator, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(BundleConfigurator);
	const states: ConfiguratorState[] = [];
	fixture.componentInstance.stateChange.subscribe((state) => states.push(state));
	fixture.componentRef.setInput('product', product);
	for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
	fixture.detectChanges();
	return { box: fixture.componentInstance, states };
};

describe('BundleConfigurator', () => {
	it('prices the bundle with the default options', () => {
		const { box, states } = render();
		expect(box.optionGroups().map((g) => box.selectedCode(g))).toEqual(['plain', 'yes', '']);
		expect(box.optionGroups().map((g) => box.selectedTermLabel(g))).toEqual(['Plain', 'Yes', '']);
		expect(states.at(-1)).toMatchObject({ total: 3050, delta: 50, valid: true });
	});

	it('waits for measurements when an option needs them', () => {
		const { box, states } = render();
		box.select(box.optionGroups()[0]!, 'stitched');
		expect(states.at(-1)).toMatchObject({ total: 3750, valid: false });
		box.onMeasurementsValue({ waist: 30 });
		box.onMeasurementsValid(true);
		expect(states.at(-1)).toMatchObject({ valid: true, measurements: { waist: 30 } });
	});

	it('waits for measurements when a component needs them', () => {
		const { box } = render(
			bundle({ components: [{ code: 'blouse', stock_status: 'in_stock', requires_measurements: true }] }),
		);
		expect(box.needsMeasurements()).toBe(true);
		expect(box.valid()).toBe(false);
	});

	it('cannot be bought while a component is out of stock', () => {
		const { box } = render(bundle({ components: [{ code: 'saree', stock_status: 'out_of_stock' }] }));
		expect(box.available()).toBe(false);
		expect(box.valid()).toBe(false);
	});

	it('prefills a saved line and ignores empty prefills', () => {
		const saved = render(bundle(), {
			initialSelections: { blouse: 'stitched' },
			initialMeasurements: { waist: 30 },
		});
		expect(saved.box.total()).toBe(3750);
		expect(saved.box.valid()).toBe(true);
		const empty = render(bundle(), { initialSelections: {}, initialMeasurements: {} });
		expect(empty.box.selectedCode(empty.box.optionGroups()[0]!)).toBe('plain');
	});

	it('treats a bundle with no parts as available, and a stale selection as no delta', () => {
		const bare = render(bundle({ components: undefined, option_groups: undefined }));
		expect(bare.box.components()).toEqual([]);
		expect(bare.box.optionGroups()).toEqual([]);
		expect(bare.box.total()).toBe(3000);
		const stale = render(bundle(), { initialSelections: { blouse: 'gone' } });
		expect(stale.box.selectedTermLabel(stale.box.optionGroups()[0]!)).toBe('');
		expect(stale.box.optionDelta()).toBe(50);
	});
});
