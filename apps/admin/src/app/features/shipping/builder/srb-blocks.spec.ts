import { type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { duplicateStep, newAdjust, newCondition, newGroup, newNode, newResult, newStep } from '@core/shipping/blocks';

import { SrbGroup } from './srb-group';
import { SrbNode } from './srb-node';

import type {
	ShippingBandsNode,
	ShippingCondition,
	ShippingConditionGroup,
	ShippingIfNode,
	ShippingNode,
	ShippingResultNode,
} from '@saha-textile/contracts';

function bare<T>(type: Type<T>, inputs: Record<string, unknown>) {
	TestBed.resetTestingModule();
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(type);
	for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
	return fixture.componentInstance;
}

function node(start: ShippingNode | null) {
	const c = bare(SrbNode, { node: start, scope: 'eachLine' });
	const out: Array<ShippingNode | null> = [];
	c.nodeChange.subscribe((next) => out.push(next));
	return { c, out, last: () => out.at(-1) };
}

const result = (kind: Parameters<typeof newResult>[0]) => newNode(kind) as ShippingResultNode;

describe('the rule builder’s new blocks (rb05)', () => {
	it('starts every result, block, step and adjustment with its own values', () => {
		expect(newResult('amount')).toEqual({ kind: 'amount', amount: null, per: 'once' });
		expect(newResult('percent')).toEqual({ kind: 'percent', percent: null, of: 'line' });
		expect(newResult('firstAndFurther')).toMatchObject({ count: 'acrossCart' });
		expect(newResult('free')).toEqual({ kind: 'free' });
		expect(newResult('cantShip')).toEqual({ kind: 'cantShip', message: {} });
		expect(newResult('courierQuote')).toEqual({ kind: 'courierQuote' });
		expect(newNode('bands')).toMatchObject({ kind: 'bands', field: 'cart.chargeableWeight' });
		expect(newNode('amount')).toMatchObject({ kind: 'result', result: { kind: 'amount' } });
		expect(newStep().scope).toBe('eachLine');
		expect(newStep('wholeCart').scope).toBe('wholeCart');
		expect(newAdjust('minimum')).toMatchObject({ kind: 'minimum', amount: null });
		expect(newAdjust('maximum')).toMatchObject({ kind: 'maximum', amount: null });
		expect(newAdjust('roundUp')).toMatchObject({ kind: 'roundUp', to: null });
		expect(newAdjust('freeAbove')).toMatchObject({ kind: 'freeAbove', subtotal: null });
		const copy = duplicateStep({ ...newStep(), id: '', node: newNode('if') });
		expect(copy.id).toMatch(/^b/);
		expect((copy.node as ShippingIfNode).when.items).toHaveLength(1);
	});
});

describe('a rule builder block (srb-node)', () => {
	it('adds, casts and removes blocks', () => {
		const { c, last } = node(null);
		c.add('if');
		expect(last()?.kind).toBe('if');
		const made = newNode('if');
		expect(c.asIf(made)).toBe(made);
		expect(c.asBands(made)).toBe(made);
		expect(c.asResult(made)).toBe(made);
		expect(c.asAny(made)).toBe(made);
		c.remove();
		expect(last()).toBeNull();
		expect(c.menu.length).toBe(2);
		expect(c.fieldKey('cart.subtotal')).toBe('ship_f_cart_subtotal');
	});

	it('edits an If: conditions, groups and the join', () => {
		const start = newNode('if') as ShippingIfNode;
		const { c, last } = node(start);
		c.addCondition(start);
		expect((last() as ShippingIfNode).when.items).toHaveLength(2);
		c.addGroup(start);
		expect(((last() as ShippingIfNode).when.items[1] as ShippingConditionGroup).join).toBe('any');
		c.addGroup({ ...start, when: { ...start.when, join: 'any' } });
		expect(((last() as ShippingIfNode).when.items[1] as ShippingConditionGroup).join).toBe('all');
		c.setJoin(start, 'any');
		expect((last() as ShippingIfNode).when.join).toBe('any');
		c.patchIf(start, { then: newNode('free') });
		expect((last() as ShippingIfNode).then?.kind).toBe('result');
	});

	it('edits bands: their unit, rows and plain amounts (rb10)', () => {
		const start = newNode('bands') as ShippingBandsNode;
		const { c, last } = node(start);
		expect(c.bandUnit(start)).toBe('g');
		expect(c.bandUnit({ ...start, field: 'cart.subtotal' })).toBe('₹');
		expect(c.bandUnit({ ...start, field: 'line.sellingPrice' })).toBe('₹');
		expect(c.bandUnit({ ...start, field: 'cart.units' })).toBe('#');
		expect(c.bandUnit({ ...start, field: null })).toBe('#');
		c.addBand({ ...start, bands: [] });
		expect((last() as ShippingBandsNode).bands[0]?.from).toBeNull();
		c.addBand({ ...start, bands: [{ id: 'b1', from: 0, to: 500, then: null }] });
		expect((last() as ShippingBandsNode).bands[1]?.from).toBe(500);
		c.addBand(start);
		expect((last() as ShippingBandsNode).bands[1]?.from).toBeNull();
		c.patchBand(start, 0, { to: 1000 });
		expect((last() as ShippingBandsNode).bands[0]?.to).toBe(1000);
		const withAmount: ShippingBandsNode = {
			...start,
			bands: [
				{
					id: 'b1',
					from: 0,
					to: null,
					then: { kind: 'result', id: 'r1', result: { kind: 'amount', amount: 100, per: 'kg' } },
				},
				{ id: 'b2', from: 0, to: null, then: newNode('if') },
			],
		};
		expect(c.simpleAmount(withAmount.bands[0]?.then ?? null)).toEqual({ amount: 100, per: 'kg' });
		expect(c.simpleAmount(newNode('free'))).toBeNull();
		expect(c.simpleAmount(newNode('if'))).toBeNull();
		expect(c.simpleAmount(null)).toBeNull();
		c.setBandAmount(withAmount, 0, { per: 'kg' }, '250');
		expect(((last() as ShippingBandsNode).bands[0]?.then as ShippingResultNode).result).toEqual({
			kind: 'amount',
			amount: 250,
			per: 'kg',
		});
		const before = last();
		c.setBandAmount(withAmount, 1, { per: 'once' }, '5');
		c.setBandAmount(withAmount, 9, { per: 'once' }, '5');
		expect(last()).toBe(before);
		c.removeBand(withAmount, 0);
		expect((last() as ShippingBandsNode).bands.map((band) => band.id)).toEqual(['b2']);
		c.patchBands(start, { field: 'cart.lines' });
		expect((last() as ShippingBandsNode).field).toBe('cart.lines');
	});

	it('reads numbers, and changes what a result charges', () => {
		const { c, out, last } = node(null);
		expect(c.numberOrNull('')).toBeNull();
		expect(c.numberOrNull(null)).toBeNull();
		expect(c.numberOrNull('abc')).toBeNull();
		expect(c.numberOrNull('12')).toBe(12);
		const charge = result('productCharge');
		expect(c.kindOf(charge.result)).toBe('charge');
		expect(c.kindOf(newResult('amount'))).toBe('charge');
		expect(c.kindOf(newResult('free'))).toBe('free');
		c.setKindChoice(charge, 'charge');
		expect(out).toEqual([]);
		c.setKindChoice(result('free'), 'charge');
		expect((last() as ShippingResultNode).result.kind).toBe('productCharge');
		c.setKindChoice(charge, 'percent');
		expect((last() as ShippingResultNode).result.kind).toBe('percent');
		expect(c.chargeSource(charge.result)).toBe('product:domestic');
		expect(c.chargeSource(newResult('amount'))).toBe('amount');
		const amount: ShippingResultNode = {
			kind: 'result',
			id: 'r',
			result: { kind: 'amount', amount: 80, per: 'kg' },
		};
		c.setChargeSource(amount, 'amount');
		expect((last() as ShippingResultNode).result).toEqual({ kind: 'amount', amount: 80, per: 'kg' });
		c.setChargeSource(charge, 'amount');
		expect((last() as ShippingResultNode).result).toEqual({ kind: 'amount', amount: null, per: 'unit' });
		c.setChargeSource(amount, 'product:internationalFirst');
		expect((last() as ShippingResultNode).result).toEqual({
			kind: 'productCharge',
			charge: 'internationalFirst',
			per: 'unit',
		});
		c.setChargeSource({ ...amount, result: { kind: 'amount', amount: 1, per: 'once' } }, 'product:domestic');
		expect((last() as ShippingResultNode).result).toMatchObject({ per: 'once' });
		c.setChargeSource(result('percent'), 'amount');
		expect((last() as ShippingResultNode).result).toEqual({ kind: 'amount', amount: null, per: 'unit' });
	});

	it('edits first and further amounts, messages and language names', () => {
		const start = result('firstAndFurther');
		const { c, last } = node(start);
		expect(c.sourceValue({ from: 'fixed', amount: 5 })).toBe('fixed');
		expect(c.sourceValue({ from: 'product', charge: 'domestic' })).toBe('domestic');
		c.setSource(start, 'first', 'fixed', { from: 'fixed', amount: 300 });
		expect((last() as ShippingResultNode).result).toMatchObject({ first: { from: 'fixed', amount: 300 } });
		c.setSource(start, 'first', 'fixed', { from: 'product', charge: 'domestic' });
		expect((last() as ShippingResultNode).result).toMatchObject({ first: { from: 'fixed', amount: null } });
		c.setSource(start, 'further', 'internationalFurther', { from: 'fixed', amount: 1 });
		expect((last() as ShippingResultNode).result).toMatchObject({
			further: { from: 'product', charge: 'internationalFurther' },
		});
		c.setSourceAmount(start, 'further', '150');
		expect((last() as ShippingResultNode).result).toMatchObject({ further: { from: 'fixed', amount: 150 } });
		const cant = result('cantShip');
		c.setMessage(cant, 'bn', 'পাঠানো যাবে না', { en: 'Cannot ship' });
		expect((last() as ShippingResultNode).result).toEqual({
			kind: 'cantShip',
			message: { en: 'Cannot ship', bn: 'পাঠানো যাবে না' },
		});
		c.setKind(cant, 'courierQuote');
		expect((last() as ShippingResultNode).result.kind).toBe('courierQuote');
		expect(c.languageName('en')).toBe('English');
		expect(c.languageName('not a code')).toBe('not a code');
	});
});

describe('a condition group (srb-group, rb04)', () => {
	function group(start: ShippingConditionGroup) {
		const c = bare(SrbGroup, { group: start });
		const out: ShippingConditionGroup[] = [];
		c.groupChange.subscribe((next) => out.push(next));
		return { c, out, last: () => out.at(-1) as ShippingConditionGroup };
	}
	const condition = (change: Partial<ShippingCondition>): ShippingCondition => ({ ...newCondition(), ...change });

	it('reads fields, operators and the value box each condition shows', () => {
		const { c } = group(newGroup());
		expect(c.joinLabel()).toBe('ship_and');
		expect(group(newGroup('any')).c.joinLabel()).toBe('ship_or');
		expect(c.groupOf('line.discounted')).toBe('line');
		expect(c.operators(null)).toEqual([]);
		expect(c.operators('cart.subtotal').length).toBeGreaterThan(0);
		expect(c.shape(condition({ field: null }))).toBeNull();
		expect(c.shape(condition({ field: 'cart.subtotal', op: null }))).toBeNull();
		expect(c.shape(condition({ field: 'cart.subtotal', op: 'isOneOf' }))).toBeNull();
		expect(c.shape(condition({ field: 'line.category', op: 'isOneOf' }))).toBe('categories');
		expect(c.shape(condition({ field: 'line.mainCategory', op: 'is' }))).toBe('category');
		expect(c.shape(condition({ field: 'delivery.zone', op: 'is' }))).toBe('zone');
		expect(c.shape(condition({ field: 'line.soldBy', op: 'isOneOf' }))).toBe('list');
		expect(c.shape(condition({ field: 'line.soldBy', op: 'is' }))).toBe('soldBy');
		expect(c.shape(condition({ field: 'cart.subtotal', op: 'between' }))).toBe('range');
	});

	it('changes the join, adds and replaces rows, and sets fields, operators and values', () => {
		const start: ShippingConditionGroup = { ...newGroup(), items: [newCondition(), newGroup('any')] };
		const { c, last } = group(start);
		c.setJoin('any');
		expect(last().join).toBe('any');
		c.addCondition();
		expect(last().items).toHaveLength(3);
		c.addGroup();
		expect((last().items[2] as ShippingConditionGroup).join).toBe('any');
		c.replace(1, null);
		expect(last().items).toHaveLength(1);
		c.replace(0, newCondition());
		expect(last().items).toHaveLength(2);
		const first = start.items[0] as ShippingCondition;
		c.setField(0, first, 'line.madeToOrder');
		expect(last().items[0]).toMatchObject({ field: 'line.madeToOrder', value: true });
		c.setField(0, first, 'cart.subtotal');
		expect(last().items[0]).toMatchObject({ field: 'cart.subtotal', value: null });
		const money = condition({ field: 'cart.subtotal', op: 'atLeast', value: 500 });
		c.setOperator(0, money, 'atMost');
		expect((last().items[0] as ShippingCondition).value).toBe(500);
		c.setOperator(0, money, 'between');
		expect((last().items[0] as ShippingCondition).value).toBeNull();
		c.setOperator(0, condition({ field: null, op: null }), 'is');
		expect((last().items[0] as ShippingCondition).value).toBeNull();
		c.setOperator(0, condition({ field: 'cart.subtotal', op: null, value: 5 }), 'between');
		expect((last().items[0] as ShippingCondition).value).toBeNull();
		c.setValue(0, money, 900);
		expect((last().items[0] as ShippingCondition).value).toBe(900);
		// Last: a second group on the page starts over the test module.
		const anyGroup = group({ ...newGroup('any') });
		anyGroup.c.addGroup();
		expect((anyGroup.last().items[1] as ShippingConditionGroup).join).toBe('all');
	});

	it('reads lists, numbers and ranges as typed', () => {
		const { c, last } = group(newGroup());
		expect(c.listOf(' a, ,b ')).toEqual(['a', 'b']);
		expect(c.listOf(' , ')).toBeNull();
		expect(c.listText(['a', 'b'])).toBe('a, b');
		expect(c.listText('WB')).toBe('WB');
		expect(c.listText(null)).toBe('');
		expect(c.numberOf('')).toBeNull();
		expect(c.numberOf(null)).toBeNull();
		expect(c.numberOf('x')).toBeNull();
		expect(c.numberOf('7')).toBe(7);
		expect(c.rangeOf([1, 2])).toEqual([1, 2]);
		expect(c.rangeOf([1, 'a'] as never)).toEqual([null, null]);
		expect(c.rangeOf([1])).toEqual([null, null]);
		expect(c.rangeOf('x')).toEqual([null, null]);
		const range = condition({ field: 'cart.subtotal', op: 'between', value: null });
		c.setRange(0, range, 0, '100');
		expect((last().items[0] as ShippingCondition).value).toBeNull();
		c.setRange(0, { ...range, value: [100, 200] }, 1, '300');
		expect((last().items[0] as ShippingCondition).value).toEqual([100, 300]);
		expect(c.selectedList(['a'])).toEqual(['a']);
		expect(c.selectedList(5)).toEqual([]);
		const select = document.createElement('select');
		select.multiple = true;
		for (const value of ['c1', 'c2']) {
			const option = document.createElement('option');
			option.value = value;
			select.append(option);
		}
		c.pickCategories(0, range, select);
		expect((last().items[0] as ShippingCondition).value).toBeNull();
		(select.options[1] as HTMLOptionElement).selected = true;
		c.pickCategories(0, range, select);
		expect((last().items[0] as ShippingCondition).value).toEqual(['c2']);
		const item = newCondition();
		expect(c.asCondition(item)).toBe(item);
		expect(c.asGroup(item)).toBe(item);
	});
});
