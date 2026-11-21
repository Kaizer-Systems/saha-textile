import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { describe, expect, it, vi } from 'vitest';

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

const modals = { open: vi.fn() };
const render = (product: unknown = bundle(), inputs: Record<string, unknown> = {}) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbModal, useValue: modals },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key, getActiveLang: () => 'en' } },
		],
	});
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

	describe('piece rows (brief P8)', () => {
		it('opens one row at a time, all closed at first', () => {
			const { box: component } = render();
			expect(component.open()).toBeNull();
			component.toggle('a');
			component.toggle('b');
			expect(component.open()).toBe('b');
			component.toggle('b');
			expect(component.open()).toBeNull();
		});

		it('marks each piece: red out of stock, amber while its measurements are missing, else green', () => {
			const { box: component } = render();
			// The set's own piece is in it; a piece it does not hold shows no mark.
			const piece = (over: Record<string, unknown>) => ({ code: 'saree', ...over }) as never;
			expect(component.mark(piece({ stock_status: 'out_of_stock' }))).toBe('bad');
			expect(component.mark(piece({ stock_status: 'in_stock', requires_measurements: true }))).toBe('warn');
			expect(component.mark(piece({ stock_status: 'in_stock' }))).toBe('ok');
			expect(component.mark({ code: 'other', stock_status: 'in_stock' } as never)).toBe('off');
			component.apply({}, { chest: 36 }, true);
			expect(component.mark(piece({ stock_status: 'in_stock', requires_measurements: true }))).toBe('ok');
		});

		it('opens the set’s form in the pop-up and keeps only what is saved', async () => {
			const start = vi.fn();
			const { box: component } = render();
			modals.open.mockReturnValueOnce({ componentInstance: { start }, result: Promise.reject('closed') });
			await component.openMeasurements();
			expect(component.measured()).toBe(false);
			modals.open.mockReturnValueOnce({ componentInstance: { start }, result: Promise.resolve({ chest: 38 }) });
			await component.openMeasurements();
			expect(component.measured()).toBe(true);
			expect(start).toHaveBeenCalledTimes(2);
		});
	});

	describe('choice groups and optional pieces (owner, 21 Nov 2026: each set follows its price setting)', () => {
		const piece = (code: string, group: string, over: Record<string, unknown> = {}) => ({
			code,
			name: code,
			group,
			stock_status: 'in_stock',
			price: 1000,
			quantity: 1,
			...over,
		});
		const set = (policy = 'fixed-bundle-price') =>
			bundle({
				price_policy: policy,
				bundle_price: 7300,
				option_groups: [],
				groups: [
					{ code: 'saree', label: 'Saree', min: 1, max: 1 },
					{ code: 'more', label: 'More', min: 1, max: 2 },
				],
				components: [
					piece('peacock', 'saree', { included: true, set_price: 35800, price_change: 0 }),
					piece('maroon', 'saree', { set_price: 36600, price_change: 800 }),
					piece('gold', 'saree', { set_price: 30000, price_change: 0, stock_status: 'out_of_stock' }),
					piece('arni', 'more', { required: true, set_price: 12600 }),
					piece('petticoat', 'more', { required: false, set_price: 1000, price_change: 1000 }),
				],
			});

		it('draws a choice group as one row and other pieces as their own, the optional one marked', () => {
			const { box } = render(set());
			expect(box.rows().map((row) => [row.kind, row.code])).toEqual([
				['group', 'group:saree'],
				['piece', 'arni'],
				['piece', 'petticoat'],
			]);
			expect(box.rows().map((row) => (row.kind === 'piece' ? row.optional : row.max))).toEqual([1, false, true]);
			expect([box.hasChoice(), box.optionalCount(), box.countLabel()]).toEqual([true, 1, '2 plus_optional']);
			expect(render().box.countLabel()).toBe('1');
			expect([...box.chosen()]).toEqual(['peacock', 'arni']);
		});

		it("prices picks and the optional piece by the set's setting, and reports what the set holds", () => {
			const { box, states } = render(set());
			expect(states.at(-1)).toMatchObject({ total: 7300, delta: 0, pieces: ['peacock', 'arni'] });
			box.pick('saree', 1, 'maroon');
			expect(states.at(-1)).toMatchObject({ total: 8100, delta: 800, picks: { saree: ['maroon'] } });
			box.pick('saree', 1, 'maroon');
			expect(states).toHaveLength(2);
			box.toggleExtra('petticoat');
			expect(states.at(-1)).toMatchObject({
				total: 9100,
				extras: ['petticoat'],
				pieces: ['maroon', 'arni', 'petticoat'],
			});
			box.toggleExtra('petticoat');
			expect(states.at(-1)).toMatchObject({ total: 8100, extras: [] });
			const summed = render(set('sum-components'));
			expect(summed.states.at(-1)).toMatchObject({ total: 35800 + 12600 });
		});

		it("takes up to the group's limit, dropping the oldest pick", () => {
			const { box } = render(set());
			box.pick('more', 2, 'petticoat');
			expect(box.chosen().has('petticoat')).toBe(false);
		});

		it('marks a group by its picks: green, amber when a pick is out but another is in, red when none is', () => {
			const { box } = render(set());
			const saree = box.rows()[0];
			if (saree?.kind !== 'group') throw new Error('expected the saree group');
			expect(box.groupMark(saree.pieces)).toBe('ok');
			box.apply({}, {}, false, { picks: { saree: ['gold'] } });
			expect(box.groupMark(saree.pieces)).toBe('warn');
			expect(box.available()).toBe(false);
			const none = saree.pieces.map((one) => ({ ...one, stock_status: 'out_of_stock' }));
			expect(box.groupMark(none as never)).toBe('bad');
			const measured = saree.pieces.map((one) => ({ ...one, requires_measurements: true }));
			box.apply({}, {}, false, { picks: { saree: ['peacock'] } });
			expect(box.groupMark(measured as never)).toBe('warn');
		});

		it("starts from the sheet's picks and hands them back", () => {
			const { box } = render(set(), { initialPicks: { saree: ['maroon'] }, initialExtras: ['petticoat'] });
			expect(box.snapshot()).toMatchObject({ picks: { saree: ['maroon'] }, extras: ['petticoat'] });
			expect(box.setPrice()).toBe(9100);
			box.apply({}, {}, false);
			expect(box.snapshot()).toMatchObject({ picks: {}, extras: [] });
		});
	});
});
