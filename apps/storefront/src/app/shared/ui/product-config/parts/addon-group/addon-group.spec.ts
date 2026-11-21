import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { describe, expect, it, vi } from 'vitest';

import { AddonGroup } from './addon-group';

import type { ConfiguratorState } from '@data-access/interfaces/product-detail.interface';

const product = {
	price: 1000,
	addon_groups: [
		{
			code: 'tailoring',
			default_term_code: 'none',
			terms: [
				{ code: 'none', label: 'None' },
				{ code: 'stitched', label: 'Stitched', price_delta: 500, requires_measurements: true },
			],
		},
		{ code: 'fall', terms: [{ code: 'yes', label: 'Yes', price_delta: 50 }] },
		{ code: 'empty', terms: [] },
	],
} as never;

const modals = { open: vi.fn() };
const render = (inputs: Record<string, unknown> = {}) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbModal, useValue: modals },
			{
				provide: TranslocoService,
				useValue: { translate: (key: string, params?: { name?: string }) => `${key}:${params?.name ?? ''}` },
			},
		],
	});
	TestBed.overrideComponent(AddonGroup, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(AddonGroup);
	const states: ConfiguratorState[] = [];
	fixture.componentInstance.stateChange.subscribe((state) => states.push(state));
	fixture.componentRef.setInput('product', product);
	for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
	fixture.detectChanges();
	return { group: fixture.componentInstance, states, fixture };
};

describe('AddonGroup', () => {
	it('starts on each default, adds the deltas to the product price and needs no measurements', () => {
		const { group, states } = render();
		expect(group.groups().map((g) => group.selectedCode(g))).toEqual(['none', 'yes', '']);
		expect(states.at(-1)).toMatchObject({ total: 1050, delta: 50, valid: true });
	});

	it('uses the selected variant price when one is given', () => {
		expect(render({ basePrice: 2000 }).group.total()).toBe(2050);
	});

	it('blocks Add to Cart until the measurements a term requires are valid', () => {
		const { group, states } = render();
		group.select(group.groups()[0]!, 'stitched');
		expect(states.at(-1)).toMatchObject({ total: 1550, valid: false, selections: { tailoring: 'stitched' } });
		group.onMeasurementsValue({ chest: 34 });
		group.onMeasurementsValid(true);
		expect(states.at(-1)).toMatchObject({ valid: true, measurements: { chest: 34 } });
	});

	it('prefills a saved line and treats its measurements as valid', () => {
		const { group } = render({
			initialSelections: { tailoring: 'stitched' },
			initialMeasurements: { chest: 34 },
		});
		expect(group.needsMeasurements()).toBe(true);
		expect(group.valid()).toBe(true);
	});

	it('ignores empty prefills and a product without add-ons', () => {
		const { group } = render({ initialSelections: {}, initialMeasurements: {} });
		expect(group.selectedCode(group.groups()[0]!)).toBe('none');
		const bare = render({ product: { price: 10 } });
		expect(bare.group.groups()).toEqual([]);
		expect(bare.group.total()).toBe(10);
	});

	it('counts a selection that no longer matches a term as no delta', () => {
		const { group } = render({ initialSelections: { tailoring: 'gone' } });
		expect(group.delta()).toBe(50);
		expect(group.needsMeasurements()).toBe(false);
	});
});

describe('AddonGroup measurement title', () => {
	it('names the chosen add-on that needs measurements, and nothing while none does', () => {
		const { group } = render();
		expect(group.measuredLabel()).toBe('');
		group.select(group.groups()[0], 'stitched');
		expect(group.measuredLabel()).toBe('Stitched');
	});

	describe('measurements as a row (brief P7)', () => {
		const field = (code: string) => ({ code, label: code, unit: 'in' });
		const withFields = (count: number, extra: Record<string, unknown> = {}) => ({
			...(product as object),
			measurement_fields: Array.from({ length: count }, (_, index) => field(`f${index}`)),
			...extra,
		});

		it('keeps up to four fields on the page and moves more behind the row, or always when asked', () => {
			expect(render({ product: withFields(4) }).group.asRow()).toBe(false);
			expect(render({ product: withFields(5) }).group.asRow()).toBe(true);
			expect(render({ product: withFields(2), measureAs: 'row' }).group.asRow()).toBe(true);
		});

		it('names the row after the template, else after the chosen add-on', () => {
			const { group } = render({ product: withFields(5, { measurement_title: 'Suit measurements' }) });
			expect(group.rowTitle()).toBe('Suit measurements');
			const plain = render({ product: withFields(5) }).group;
			plain.select(plain.groups()[0]!, 'stitched');
			expect(plain.rowTitle()).toBe('measurements_for:Stitched');
		});

		it('opens the form in the pop-up and takes back only what is saved', async () => {
			const start = vi.fn();
			const { group, states } = render({ product: withFields(5, { size_guide: { fields: [], rows: [] } }) });
			group.select(group.groups()[0]!, 'stitched');
			modals.open.mockReturnValueOnce({ componentInstance: { start }, result: Promise.reject('closed') });
			await group.openMeasurements();
			expect(start).toHaveBeenCalledWith(
				expect.objectContaining({ forName: 'Stitched', sizeGuide: true, values: {} }),
			);
			expect(group.measured()).toBe(false);
			modals.open.mockReturnValueOnce({ componentInstance: { start }, result: Promise.resolve({ f0: 36 }) });
			await group.openMeasurements();
			expect(group.measured()).toBe(true);
			expect(states.at(-1)).toMatchObject({ valid: true, measurements: { f0: 36 } });
			expect(modals.open.mock.lastCall?.[1]).toMatchObject({ windowClass: 'theme-modal st-sheet' });
		});
	});
});
