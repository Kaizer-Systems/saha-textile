import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BundleConfigurator } from './bundle-configurator';
import { freeWith, setBundle, setItem, setLevel } from '../../set-test-data';
import { MeasurementsSheet } from '../measurements-sheet/measurements-sheet';

import type {
	ConfiguratorState,
	IBundle,
	IBundleOptionGroup,
	IFreeItem,
} from '@data-access/interfaces/product-detail.interface';

const modals = { open: vi.fn() };
let lang = 'en';
const render = (bundle: IBundle, inputs: Record<string, unknown> = {}, product: Record<string, unknown> = {}) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbModal, useValue: modals },
			{
				provide: TranslocoService,
				useValue: { translate: (key: string) => key, getActiveLang: () => lang },
			},
		],
	});
	TestBed.overrideComponent(BundleConfigurator, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(BundleConfigurator);
	const states: ConfiguratorState[] = [];
	fixture.componentInstance.stateChange.subscribe((state) => states.push(state));
	fixture.componentRef.setInput('product', { bundle, ...product });
	for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
	fixture.detectChanges();
	return { box: fixture.componentInstance, states, last: () => states.at(-1) };
};

const group = (code: string, over: Partial<IBundleOptionGroup> = {}): IBundleOptionGroup => ({
	code,
	label: code,
	required: true,
	style: 'text' as IBundleOptionGroup['style'],
	terms: [
		{ code: 'plain', label: 'Plain', price_delta: 0 },
		{ code: 'stitched', label: 'Stitched', price_delta: 800, requires_measurements: true },
	],
	...over,
});
const freeItem = (product_id: string, over: Partial<IFreeItem> = {}): IFreeItem => ({
	product_id,
	name: product_id,
	mrp: null,
	selling: 100,
	quantity: 1,
	in_stock: true,
	variant_id: null,
	variant_label: null,
	variants: [],
	...over,
});
const popup = (result: Promise<unknown>) => {
	const start = vi.fn();
	modals.open.mockReturnValueOnce({ componentInstance: { start }, result });
	return start;
};

const saree = setLevel('saree', 1, [setItem('b906', 19200), setItem('b1082', 16400), setItem('a1091', 28600)]);
const petticoat = setLevel('pc', 1, [setItem('cream', 450)]);

afterEach(() => {
	modals.open.mockReset();
	lang = 'en';
});

describe('BundleConfigurator: options, measurements and marks', () => {
	it('selects each option group’s default, then its first term, then nothing', () => {
		const groups = [
			group('blouse', { default_term_code: 'stitched' }),
			group('fall'),
			group('empty', { terms: [] }),
		];
		const { box } = render(setBundle([petticoat], { option_groups: groups }));
		expect(groups.map((g) => box.selectedCode(g))).toEqual(['stitched', 'plain', '']);
		expect(box.selectedTermLabel(groups[0]!)).toBe('Stitched');
		expect(box.selectedTermLabel(groups[2]!)).toBe('');
		expect(box.optionDelta()).toBe(800);
		expect(box.needsMeasurements()).toBe(true);
	});

	it('reads no option groups as none', () => {
		const set = setBundle([petticoat]);
		delete (set as Partial<IBundle>).option_groups;
		expect(render(set).box.optionGroups()).toEqual([]);
	});

	it('prices a picked option and waits for its measurements before the set is valid', () => {
		const blouse = group('blouse');
		const { box, last } = render(setBundle([petticoat], { option_groups: [blouse] }));
		expect(last()).toMatchObject({ total: 450, valid: true });
		box.select(blouse, 'stitched');
		expect(last()).toMatchObject({ total: 1250, delta: 800, valid: false, selections: { blouse: 'stitched' } });
		expect(box.mark(petticoat.items[0]!)).toBe('warn');
		expect(box.measured()).toBe(false);
	});

	it('starts from saved option choices and measurements', () => {
		const blouse = group('blouse');
		const { box, last } = render(setBundle([petticoat], { option_groups: [blouse] }), {
			initialSelections: { blouse: 'stitched' },
			initialMeasurements: { bust: 34 },
		});
		expect(last()).toMatchObject({ valid: true, measurements: { bust: 34 } });
		expect(box.measured()).toBe(true);
		expect(box.mark(petticoat.items[0]!)).toBe('ok');
	});

	it('ignores empty saved choices', () => {
		const { last } = render(setBundle([petticoat], { option_groups: [group('blouse')] }), {
			initialSelections: {},
			initialMeasurements: {},
		});
		expect(last()).toMatchObject({ selections: {}, measurements: {} });
	});

	describe('measurements pop-up', () => {
		it('opens the set’s form under the product’s own title and keeps the saved values', async () => {
			const start = popup(Promise.resolve({ bust: 36 }));
			const fields = [{ code: 'bust', label: 'Bust', unit: 'in' }];
			const { box, last } = render(
				setBundle([petticoat], { option_groups: [group('blouse')], measurement_fields: fields }),
				{ initialSelections: { blouse: 'stitched' } },
				{ measurement_title: 'Blouse measurements', size_guide: { id: 1 } },
			);
			await box.openMeasurements();
			expect(modals.open).toHaveBeenCalledWith(MeasurementsSheet, expect.objectContaining({ size: 'lg' }));
			expect(start).toHaveBeenCalledWith({
				heading: 'Blouse measurements',
				fields,
				forName: '',
				values: {},
				sizeGuide: true,
			});
			expect(last()).toMatchObject({ valid: true, measurements: { bust: 36 } });
		});

		it('keeps everything when the pop-up is dismissed, with the default title and no fields', async () => {
			const start = popup(Promise.reject(new Error('dismissed')));
			const { box, states } = render(setBundle([petticoat]));
			const before = states.length;
			await box.openMeasurements();
			expect(start).toHaveBeenCalledWith(
				expect.objectContaining({
					heading: 'measurements_required_for_selection',
					fields: [],
					sizeGuide: false,
				}),
			);
			expect(states).toHaveLength(before);
			expect(box.measured()).toBe(false);
		});
	});

	it('counts the rows alone when the set has no extras', () => {
		expect(render(setBundle([saree, petticoat])).box.countLabel()).toBe('2');
	});

	it('opens one row at a time and closes it on a second tap', () => {
		const { box } = render(setBundle([saree]));
		box.toggle('level:saree');
		expect(box.open()).toBe('level:saree');
		box.toggle('item:cream');
		expect(box.open()).toBe('item:cream');
		box.toggle('item:cream');
		expect(box.open()).toBeNull();
	});

	it('follows the page language, English when none is set', () => {
		expect(render(setBundle([saree])).box.lang()).toBe('en');
		lang = 'bn';
		expect(render(setBundle([saree])).box.lang()).toBe('bn');
		lang = '';
		expect(render(setBundle([saree])).box.lang()).toBe('en');
	});

	it('names a piece’s size by its fixed label, its chosen size, or not at all', () => {
		const { box } = render(setBundle([saree]));
		expect(box.sizeLabel(setItem('x', 1, { variant_id: 'v', variant_label: 'Free size' }))).toBe('Free size');
		expect(box.sizeLabel(setItem('y', 1, { variants: [{ id: 'v-m', label: 'M', in_stock: true }] }))).toBeNull();
	});

	it('marks pieces: red out of stock, amber unready, green ready', () => {
		const { box } = render(setBundle([saree]));
		expect(box.mark(setItem('gone', 1, { in_stock: false }))).toBe('bad');
		expect(box.mark(setItem('unsized', 1, { variants: [{ id: 'v', label: 'S', in_stock: true }] }))).toBe('warn');
		expect(box.mark(setItem('ok', 1))).toBe('ok');
	});

	it('marks a choice level by what it offers and what is picked', async () => {
		const sizes = [{ id: 'v-s', label: 'S', in_stock: true }];
		const soldOut = setLevel('none', 1, [
			setItem('n1', 1, { in_stock: false }),
			setItem('n2', 1, { in_stock: false }),
		]);
		const any = setLevel('any', 2, [setItem('r1', 4400), setItem('r2', 4800), setItem('r3', 5600)]);
		const sized = setLevel('sized', 1, [setItem('s1', 1000, { variants: sizes }), setItem('s2', 1200)]);
		const { box } = render(setBundle([saree, any, sized]));
		expect(box.levelMark(soldOut)).toBe('bad');
		expect(box.levelMark(saree)).toBe('ok');
		expect(box.levelMark(sized)).toBe('warn');
		await box.pick(any, any.items[0]!);
		expect(box.levelMark(any)).toBe('warn');
		expect(box.picked(any).map((item) => item.key)).toEqual(['r2']);
		expect(box.changeFor(saree, saree.items[0]!)).toBe(0);
	});

	it('marks a level red when a saved pick has sold out since', () => {
		const level = setLevel('saree', 1, [setItem('a', 5000), setItem('gone', 6000, { in_stock: false })]);
		const { box } = render(setBundle([level]), { initialSet: { picks: { saree: ['gone'] } } });
		expect(box.levelMark(level)).toBe('bad');
	});

	it('refuses a sold-out item, one the rules do not offer now, and a second tap on a single pick', async () => {
		const gone = setItem('gone', 1, { in_stock: false });
		const level = setLevel('saree', 1, [...saree.items, gone]);
		const { box, states } = render(setBundle([level]));
		const before = states.length;
		await box.pick(level, gone);
		await box.pick(setLevel('elsewhere', 1, [setItem('z', 1), setItem('y', 1)]), setItem('z', 1));
		await box.pick(level, level.items[0]!);
		expect(states).toHaveLength(before);
		expect(box.offered(setLevel('elsewhere', 1, []), setItem('z', 1))).toBe(false);
		expect(box.changeFor(setLevel('elsewhere', 1, []), setItem('z', 1))).toBe(0);
	});

	describe('free items on a pick', () => {
		it('opens no pop-up for an item without free items or for several given ones without sizes', async () => {
			const given = freeWith({ items: [freeItem('pc'), freeItem('bag')] });
			const level = setLevel('saree', 1, [setItem('a', 5000), setItem('b', 6000, { free_with: given })]);
			const { box } = render(setBundle([level]));
			await box.pick(level, level.items[1]!);
			expect(modals.open).not.toHaveBeenCalled();
			expect(box.freeNames(level.items[0]!)).toEqual([]);
			expect(box.freeReady(level.items[0]!)).toBe(true);
		});

		it('confirms one given item, and asks for the size of a given item that has sizes', async () => {
			const one = freeWith({ items: [freeItem('pc')] });
			const sized = freeWith({
				items: [freeItem('pc'), freeItem('bag', { variants: [{ id: 'm', label: 'M', in_stock: true }] })],
			});
			const level = setLevel('saree', 1, [
				setItem('a', 5000),
				setItem('b', 6000, { free_with: one }),
				setItem('c', 6000, { free_with: sized }),
			]);
			const { box, last } = render(setBundle([level]));
			popup(Promise.reject(new Error('closed')));
			await box.pick(level, level.items[1]!);
			expect(last()?.free).toEqual({ b: [{ productId: 'pc', variantId: null }] });

			const start = popup(Promise.resolve([{ productId: 'bag', variantId: 'm' }]));
			await box.pick(level, level.items[2]!);
			expect(start).toHaveBeenCalledWith(expect.objectContaining({ pieceName: 'c', picks: null }));
			expect(last()?.free).toEqual({ c: [{ productId: 'bag', variantId: 'm' }] });
		});

		it('asks again when an extra with a free choice is ticked, starting from the earlier picks', async () => {
			const choice = freeWith({ given: false, take: 'upto', min: 0, max: 1, required: false });
			const set = setBundle([petticoat]);
			set.extras = [setItem('blouse', 1200, { free_with: choice })];
			const { box, last } = render(set, {
				initialSet: { extras: [], free: { blouse: [{ productId: 'pc', variantId: null }] } },
			});
			const start = popup(Promise.resolve([]));
			await box.toggleExtra(set.extras[0]!);
			expect(start).toHaveBeenCalledWith(
				expect.objectContaining({ picks: [{ productId: 'pc', variantId: null }] }),
			);
			expect(last()).toMatchObject({ extras: ['blouse'], free: {} });
		});

		it('names nothing for a free pick the rule no longer offers', () => {
			const withPc = setItem('saree', 9000, { free_with: freeWith() });
			const { box } = render(setBundle([setLevel('s', 1, [withPc])]));
			box.onFreeState(withPc, { picks: [{ productId: 'gone', variantId: null }], valid: true });
			expect(box.freeNames(withPc)).toEqual([]);
			expect(box.freeReady(withPc)).toBe(false);
		});
	});

	it('starts from a saved set without free picks or variants', () => {
		const { box } = render(setBundle([saree]), { initialSet: { picks: { saree: ['a1091'] } } });
		expect(box.snapshot()).toEqual({
			selections: {},
			measurements: {},
			measured: false,
			set: { picks: { saree: ['a1091'] }, extras: [], variants: {}, free: {} },
		});
	});
});
