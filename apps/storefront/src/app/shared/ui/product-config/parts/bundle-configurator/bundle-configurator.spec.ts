import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { describe, expect, it, vi } from 'vitest';

import { BundleConfigurator } from './bundle-configurator';
import { freeWith, setBundle, setItem, setLevel } from '../../set-test-data';

import type { ConfiguratorState, IBundle } from '@data-access/interfaces/product-detail.interface';

const modals = { open: vi.fn() };
const render = (bundle: IBundle, inputs: Record<string, unknown> = {}) => {
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
	fixture.componentRef.setInput('product', { bundle });
	for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
	fixture.detectChanges();
	return { box: fixture.componentInstance, states };
};

const saree = setLevel('saree', 1, [setItem('b906', 19200), setItem('b1082', 16400), setItem('a1091', 28600)]);
const petticoat = setLevel('pc', 1, [setItem('cream', 450)]);

describe('BundleConfigurator', () => {
	it('draws fixed pieces as their own rows, a choice level as one row, then the extras', () => {
		const set = setBundle([saree, petticoat], { setPrice: 18500 });
		set.extras = [setItem('blouse', 1200)];
		const { box } = render(set);
		expect(box.rows().map((row) => [row.kind, row.code])).toEqual([
			['choice', 'level:saree'],
			['piece', 'item:cream'],
			['extra', 'extra:blouse'],
		]);
		expect(box.hasChoice()).toBe(true);
		expect(box.countLabel()).toBe('2 plus_optional');
	});

	it("prices picks by the set's rule: included, then the difference for a dearer pick", async () => {
		const { box, states } = render(setBundle([saree], { setPrice: 18500 }));
		expect(states.at(-1)).toMatchObject({ total: 18500, delta: 0, valid: true, pieces: ['b906'] });
		expect(box.changeFor(saree, saree.items[1]!)).toBe(0);
		expect(box.changeFor(saree, saree.items[2]!)).toBe(9400);
		await box.pick(saree, saree.items[2]!);
		expect(states.at(-1)).toMatchObject({ total: 27900, picks: { saree: ['a1091'] }, pieces: ['a1091'] });
	});

	it('ticks extras on and off with their price; a sold-out one stays off', async () => {
		const set = setBundle([petticoat], { setPrice: 450 });
		set.extras = [setItem('blouse', 1200), setItem('gone', 900, { in_stock: false })];
		const { box, states } = render(set);
		await box.toggleExtra(set.extras[0]!);
		expect(states.at(-1)).toMatchObject({ total: 1650, extras: ['blouse'] });
		await box.toggleExtra(set.extras[1]!);
		expect(states.at(-1)?.extras).toEqual(['blouse']);
		await box.toggleExtra(set.extras[0]!);
		expect(states.at(-1)).toMatchObject({ total: 450, extras: [] });
	});

	it('takes several picks in a "take 2" level and lets one go again', async () => {
		const any = setLevel('any', 2, [setItem('r1', 4400), setItem('r2', 4800), setItem('r3', 5600)]);
		const { box, states } = render(setBundle([any]));
		expect(states.at(-1)?.pieces).toEqual(['r1', 'r2']);
		await box.pick(any, any.items[2]!);
		expect(states.at(-1)?.picks).toEqual({ any: ['r2', 'r3'] });
		await box.pick(any, any.items[1]!);
		expect(states.at(-1)?.picks).toEqual({ any: ['r3'] });
		expect(states.at(-1)?.valid).toBe(false);
	});

	it('waits for a size on a piece the shopper sizes, and for a free choice on a fixed piece', () => {
		const sized = setItem('pc', 450, { variants: [{ id: 'v-m', label: 'M', in_stock: true }] });
		const choice = freeWith({
			given: false,
			take: 'exactly',
			count: 1,
			min: 1,
			max: 1,
			items: [
				{
					product_id: 'bag',
					name: 'Bag',
					mrp: null,
					selling: 300,
					quantity: 1,
					in_stock: true,
					variant_id: null,
					variant_label: null,
					variants: [],
				},
				{
					product_id: 'box',
					name: 'Box',
					mrp: null,
					selling: 200,
					quantity: 1,
					in_stock: true,
					variant_id: null,
					variant_label: null,
					variants: [],
				},
			],
		});
		const withFree = setItem('saree', 9000, { free_with: choice });
		const set = setBundle([setLevel('pc', 1, [sized]), setLevel('saree', 1, [withFree])]);
		const { box, states } = render(set);
		expect(box.mark(sized)).toBe('warn');
		expect(states.at(-1)?.valid).toBe(false);
		box.setSize(sized, 'v-m');
		expect(box.sizeLabel(sized)).toBe('M');
		box.onFreeState(withFree, { picks: [{ productId: 'box', variantId: null }], valid: true });
		expect(states.at(-1)).toMatchObject({
			valid: true,
			variants: { pc: 'v-m' },
			free: { saree: [{ productId: 'box', variantId: null }] },
		});
		expect(box.freeNames(withFree)).toEqual(['Box']);
	});

	it('fills given free items in by themselves and names them on the row', () => {
		const withPc = setItem('saree', 9000, { free_with: freeWith() });
		const { box, states } = render(setBundle([setLevel('s', 1, [withPc])]));
		expect(box.freeNames(withPc)).toEqual(['Cream petticoat']);
		expect(states.at(-1)?.free).toEqual({ saree: [{ productId: 'pc', variantId: null }] });
	});

	it('opens the free-item pop-up when a pick needs the shopper, and keeps what it returns', async () => {
		const choice = freeWith({ given: false, take: 'upto', count: 1, min: 0, max: 1, required: false });
		const level = setLevel('saree', 1, [setItem('a', 5000), setItem('b', 6000, { free_with: choice })]);
		const start = vi.fn();
		modals.open.mockReturnValueOnce({
			componentInstance: { start },
			result: Promise.resolve([{ productId: 'pc', variantId: null }]),
		});
		const { box, states } = render(setBundle([level]));
		await box.pick(level, level.items[1]!);
		expect(start).toHaveBeenCalledWith(expect.objectContaining({ pieceName: 'b' }));
		expect(states.at(-1)?.free).toEqual({ b: [{ productId: 'pc', variantId: null }] });
	});

	it('is not valid while the set cannot be bought, and reports sold out', () => {
		const { states } = render(setBundle([petticoat], { buyable: false }));
		expect(states.at(-1)?.valid).toBe(false);
	});

	it('applies choices from the Configure set sheet and hands them back', () => {
		const { box, states } = render(setBundle([saree], { setPrice: 18500 }));
		box.apply({}, {}, false, { picks: { saree: ['b1082'] }, extras: [], variants: {}, free: {} });
		expect(states.at(-1)?.picks).toEqual({ saree: ['b1082'] });
		expect(box.snapshot().set.picks).toEqual({ saree: ['b1082'] });
	});
});
