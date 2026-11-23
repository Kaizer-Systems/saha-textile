import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { IFreeItem, IFreePick, IFreeWith } from '@data-access/interfaces/product-detail.interface';

import { FreeItems, FreeItemsState, freePicksValid } from './free-items';
import { freeWith } from '../../set-test-data';

const item = (product_id: string, over: Partial<IFreeItem> = {}): IFreeItem => ({
	product_id,
	name: product_id.toUpperCase(),
	mrp: null,
	selling: 100,
	quantity: 1,
	in_stock: true,
	variant_id: null,
	variant_label: null,
	variants: [],
	...over,
});
const SIZES = [
	{ id: 's', label: 'S', in_stock: true },
	{ id: 'm', label: 'M', in_stock: true },
];
const choice = (over: Partial<IFreeWith> = {}) =>
	freeWith({ given: false, take: 'exactly', min: 1, max: 1, items: [item('a'), item('b'), item('c')], ...over });

const render = (rule: IFreeWith, initial: IFreePick[] | null = null) => {
	TestBed.resetTestingModule();
	TestBed.overrideComponent(FreeItems, { set: { imports: [], template: '', providers: [] } });
	const fixture = TestBed.createComponent(FreeItems);
	fixture.componentRef.setInput('freeWith', rule);
	fixture.componentRef.setInput('initial', initial);
	const states: FreeItemsState[] = [];
	fixture.componentInstance.stateChange.subscribe((state) => states.push(state));
	fixture.detectChanges();
	return { part: fixture.componentInstance, states, last: () => states.at(-1) };
};

describe('freePicksValid, the remaining rules', () => {
	it('refuses a pick the rule does not offer', () => {
		expect(freePicksValid(choice(), [{ productId: 'zz', variantId: null }])).toBe(false);
	});

	it('accepts any in-stock picks of a given rule', () => {
		expect(freePicksValid(freeWith(), [{ productId: 'pc', variantId: null }])).toBe(true);
	});

	it('takes none or exactly the count when the choice is “none or exactly”', () => {
		const rule = choice({ none_or_exactly: true, min: 0, max: 2 });
		const pick = (productId: string) => ({ productId, variantId: null });
		expect(freePicksValid(rule, [pick('a'), pick('b')])).toBe(true);
		expect(freePicksValid(rule, [pick('a')])).toBe(false);
	});

	it('takes between min and max otherwise', () => {
		const rule = choice({ take: 'between', min: 1, max: 2 });
		const pick = (productId: string) => ({ productId, variantId: null });
		expect(freePicksValid(rule, [pick('a'), pick('b')])).toBe(true);
		expect(freePicksValid(rule, [pick('a'), pick('b'), pick('c')])).toBe(false);
	});
});

describe('FreeItems', () => {
	it('hands every in-stock given item over, ticked, and is valid at once', () => {
		const { part, last } = render(freeWith({ items: [item('a'), item('b', { in_stock: false })] }));
		expect(part.given()).toBe(true);
		expect(part.single()).toBe(false);
		expect(part.needed()).toBe(0);
		expect(part.isOn(item('a'))).toBe(true);
		expect(part.isOn(item('b', { in_stock: false }))).toBe(false);
		expect(last()).toEqual({ picks: [{ productId: 'a', variantId: null }], valid: true });

		part.toggle(item('a'));
		expect(last()?.picks).toHaveLength(1);
	});

	it('waits for a size on a given item that has sizes', () => {
		const sized = item('pc', { variants: SIZES });
		const { part, last } = render(freeWith({ items: [sized] }));
		expect(part.needsSize(sized)).toBe(true);
		expect(part.sizeOf(sized)).toBeNull();
		expect(last()?.valid).toBe(false);

		part.setSize(sized, 'm');
		expect(part.sizeOf(sized)).toBe('m');
		expect(last()).toEqual({ picks: [{ productId: 'pc', variantId: 'm' }], valid: true });
	});

	it('uses a fixed size without asking', () => {
		const fixed = item('pc', { variant_id: 'l', variants: SIZES });
		const { part } = render(freeWith({ items: [fixed] }));
		expect(part.needsSize(fixed)).toBe(false);
		expect(part.sizeOf(fixed)).toBe('l');
	});

	it('starts a required choice with the first items in stock, and swaps a one-at-a-time pick', () => {
		const rule = choice({ items: [item('a', { in_stock: false }), item('b'), item('c')] });
		const { part, last } = render(rule);
		expect(last()).toEqual({ picks: [{ productId: 'b', variantId: null }], valid: true });
		expect(part.needed()).toBe(0);

		part.toggle(item('c'));
		expect(last()?.picks).toEqual([{ productId: 'c', variantId: null }]);
		part.toggle(item('a', { in_stock: false }));
		expect(last()?.picks).toEqual([{ productId: 'c', variantId: null }]);
		part.toggle(item('c'));
		expect(last()).toEqual({ picks: [], valid: false });
		expect(part.needed()).toBe(1);
	});

	it('lets picks join while there is room, then holds', () => {
		const { part, last } = render(choice({ take: 'upto', min: 1, max: 2 }));
		part.toggle(item('b'));
		part.toggle(item('c'));
		expect(last()?.picks.map((pick) => pick.productId)).toEqual(['a', 'b']);
		expect(last()?.valid).toBe(true);
	});

	it('starts a “none or exactly” choice empty, which is valid, and needs nothing counted', () => {
		const { part, last } = render(choice({ none_or_exactly: true, min: 0, max: 2 }));
		expect(last()).toEqual({ picks: [], valid: true });
		expect(part.needed()).toBe(0);
		part.toggle(item('a'));
		expect(last()?.valid).toBe(false);
		part.toggle(item('b'));
		expect(last()?.valid).toBe(true);
	});

	it('marks a single optional item as “may take it”', () => {
		expect(render(choice({ items: [item('a')] })).part.single()).toBe(true);
	});

	it('reopens from earlier picks, sizes included', () => {
		const sized = item('b', { variants: SIZES });
		const rule = choice({ take: 'upto', min: 0, max: 2, items: [item('a'), sized] });
		const { part, last } = render(rule, [
			{ productId: 'a', variantId: null },
			{ productId: 'b', variantId: 's' },
		]);
		expect(part.sizeOf(sized)).toBe('s');
		expect(last()).toEqual({
			picks: [
				{ productId: 'a', variantId: null },
				{ productId: 'b', variantId: 's' },
			],
			valid: true,
		});
	});
});
