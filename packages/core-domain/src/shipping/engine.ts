import type {
	LocalizedText,
	ShippingAmountSource,
	ShippingCartSnapshot,
	ShippingNode,
	ShippingResult,
	ShippingRuleSetBody,
	ShippingSnapshotLine,
	ShippingStep,
	ShippingTraceEntry,
	ShippingZone,
} from '@saha-textile/contracts';

import { groupHolds } from './conditions';
import { cartFacts, chargeFor, factValue, type ShippingCartFacts, type ShippingEvalScope } from './facts';

/**
 * The shipping rule engine. Pure: it prices the lines a rule set is responsible for, inside the
 * whole cart, and explains every amount. The admin's Try it and the checkout call the same
 * function on the server, so what staff test is what shoppers pay.
 */

/** Rupees to the paisa. */
export const roundINR = (amount: number): number => Math.round((amount + Number.EPSILON) * 100) / 100;

/** Started kilograms: couriers charge 1 kg for 300 g and 2 kg for 1.2 kg. */
const startedKg = (grams: number): number => (grams <= 0 ? 0 : Math.ceil(grams / 1000 - 1e-9));

export interface ShippingCantShipLine {
	lineId: string;
	message: LocalizedText;
}

/** Where a rule set gave no answer (a draft that wasn't finished, or a data gap). */
export interface ShippingNoResult {
	stepId: string;
	lineIds: string[];
	/** The block that had nothing to give: an empty branch, an empty step, or an amount left blank. */
	blockId: string;
}

export type ShippingRuleSetOutcome =
	| { status: 'priced'; amountINR: number; trace: ShippingTraceEntry[]; adjustments: ShippingAdjustTrace[] }
	| { status: 'cantShip'; lines: ShippingCantShipLine[]; trace: ShippingTraceEntry[] }
	| { status: 'needsQuote'; lineIds: string[]; trace: ShippingTraceEntry[] }
	| { status: 'noResult'; where: ShippingNoResult[]; trace: ShippingTraceEntry[] };

export interface ShippingAdjustTrace {
	adjustId: string;
	kind: 'minimum' | 'maximum' | 'roundUp' | 'freeAbove';
	fromINR: number;
	toINR: number;
}

export interface EvaluateShippingInput {
	body: ShippingRuleSetBody;
	/** The whole cart: cart facts, delivery and shopper come from here. */
	snapshot: ShippingCartSnapshot;
	zone: ShippingZone;
	/** The lines this rule set prices; defaults to every line in the cart. */
	lineIds?: readonly string[];
	/** Whole-cart facts when the caller already has them. */
	cart?: ShippingCartFacts;
}

interface Walk {
	result: ShippingResult | null;
	path: string[];
	/** The block that had no result, when `result` is null. */
	emptyAt: string;
}

/** Follow the decision tree for one scope. */
function walk(node: ShippingNode | null, scope: ShippingEvalScope, path: string[], parentId: string): Walk {
	if (node === null) return { result: null, path, emptyAt: parentId };
	const here = [...path, node.id];
	switch (node.kind) {
		case 'result':
			return { result: node.result, path: here, emptyAt: node.id };
		case 'if':
			return groupHolds(node.when, scope)
				? walk(node.then, scope, [...here, 'then'], `${node.id}:then`)
				: walk(node.otherwise, scope, [...here, 'otherwise'], `${node.id}:otherwise`);
		case 'bands': {
			const value = node.field === null ? null : factValue(node.field, scope);
			if (typeof value === 'number') {
				const band = node.bands.find(
					(b) => (b.from === null || value >= b.from) && (b.to === null || value < b.to),
				);
				if (band) return walk(band.then, scope, [...here, band.id], band.id);
			}
			return walk(node.otherwise, scope, [...here, 'otherwise'], `${node.id}:otherwise`);
		}
	}
}

/** An amount source's value for a line; null when a fixed amount was left blank. */
function sourceAmount(source: ShippingAmountSource, line: ShippingSnapshotLine): number | null {
	return source.from === 'fixed' ? source.amount : chargeFor(line, source.charge);
}

type Priced =
	| { kind: 'amount'; entry: ShippingTraceEntry }
	| { kind: 'cantShip'; message: LocalizedText; entry: ShippingTraceEntry }
	| { kind: 'quote'; entry: ShippingTraceEntry }
	| { kind: 'empty'; blockId: string; entry: ShippingTraceEntry };

/**
 * Price one result for the lines in hand. `units` is how many units the scope covers (a line's
 * units, 1 in a unit loop, every unit of the group for the whole cart).
 */
function priceResult(
	step: ShippingStep,
	walked: Walk,
	lines: readonly ShippingSnapshotLine[],
	units: number,
	gramsPerScope: number,
	valueINR: number,
	cart: ShippingCartFacts,
): Priced {
	const base = { stepId: step.id, lineIds: lines.map((l) => l.lineId), path: walked.path };
	const result = walked.result;
	if (result === null)
		return { kind: 'empty', blockId: walked.emptyAt, entry: { ...base, result: 'none', amountINR: 0 } };
	const blank = (): Priced => ({
		kind: 'empty',
		blockId: walked.emptyAt,
		entry: { ...base, result: result.kind, amountINR: 0 },
	});
	const amount = (value: number, extra: Partial<ShippingTraceEntry> = {}): Priced => ({
		kind: 'amount',
		entry: { ...base, result: result.kind, amountINR: roundINR(value), ...extra },
	});
	switch (result.kind) {
		case 'free':
			return amount(0);
		case 'cantShip':
			return { kind: 'cantShip', message: result.message, entry: { ...base, result: 'cantShip', amountINR: 0 } };
		case 'courierQuote':
			return { kind: 'quote', entry: { ...base, result: 'courierQuote', amountINR: 0 } };
		case 'amount': {
			if (result.amount === null) return blank();
			if (result.per === 'once') return amount(result.amount, { unitAmountINR: result.amount });
			if (result.per === 'unit') return amount(result.amount * units, { units, unitAmountINR: result.amount });
			const kg = startedKg(gramsPerScope);
			return amount(result.amount * kg, { kg, unitAmountINR: result.amount });
		}
		case 'percent': {
			if (result.percent === null) return blank();
			const of = result.of === 'line' ? valueINR : step.scope === 'wholeCart' ? valueINR : cart.subtotalINR;
			return amount((of * result.percent) / 100, { percent: result.percent });
		}
		case 'productCharge': {
			if (step.scope === 'wholeCart') {
				if (result.per === 'once') {
					const highest = Math.max(0, ...lines.map((l) => chargeFor(l, result.charge)));
					return amount(highest, { unitAmountINR: highest });
				}
				const total = lines.reduce((sum, l) => sum + chargeFor(l, result.charge) * l.units, 0);
				return amount(total, { units });
			}
			// A line or unit step prices exactly one line at a time.
			const each = chargeFor(lines[0] as ShippingSnapshotLine, result.charge);
			return result.per === 'once'
				? amount(each, { unitAmountINR: each })
				: amount(each * units, { units, unitAmountINR: each });
		}
		case 'firstAndFurther': {
			if (lines.length === 0 || units === 0) return amount(0);
			const firsts = lines.map((l) => sourceAmount(result.first, l));
			const furthers = lines.map((l) => sourceAmount(result.further, l));
			if (firsts.some((v) => v === null) || furthers.some((v) => v === null)) return blank();
			const first = firsts as number[];
			const further = furthers as number[];
			if (step.scope !== 'wholeCart' || result.count === 'perProduct') {
				// Each product (or the one line in hand) starts again at its own first unit.
				let total = 0;
				let furtherUnits = 0;
				lines.forEach((l, i) => {
					const n = step.scope === 'wholeCart' ? l.units : units;
					total += (first[i] as number) + (further[i] as number) * (n - 1);
					furtherUnits += n - 1;
				});
				return amount(total, { firstINR: first[0], furtherUnits, furtherINR: further[0], units });
			}
			// Across the cart: one first unit, taken from the line with the highest first-unit amount
			// (the earliest such line on a tie); every other unit pays its own further amount.
			let pick = 0;
			first.forEach((v, i) => {
				if (v > (first[pick] as number)) pick = i;
			});
			let total = first[pick] as number;
			lines.forEach((l, i) => {
				const n = i === pick ? l.units - 1 : l.units;
				total += (further[i] as number) * n;
			});
			return amount(total, { firstINR: first[pick], furtherUnits: units - 1, furtherINR: further[pick], units });
		}
	}
}

/** Work out one rule set for its lines. */
export function evaluateShippingRuleSet(input: EvaluateShippingInput): ShippingRuleSetOutcome {
	const { body, snapshot, zone } = input;
	const cart = input.cart ?? cartFacts(snapshot);
	const wanted = input.lineIds ? new Set(input.lineIds) : null;
	const lines = wanted ? snapshot.lines.filter((l) => wanted.has(l.lineId)) : snapshot.lines;
	const trace: ShippingTraceEntry[] = [];
	const cantShip: ShippingCantShipLine[] = [];
	const quoteLines = new Set<string>();
	const empty: ShippingNoResult[] = [];
	let total = 0;

	const scopeFor = (line: ShippingSnapshotLine | null, lineUnits: number): ShippingEvalScope => ({
		snapshot,
		cart,
		zone,
		line,
		lineUnits,
	});

	for (const step of body.steps) {
		const priced: number[] = [];
		const take = (result: Priced): void => {
			trace.push(result.entry);
			if (result.kind === 'amount') priced.push(result.entry.amountINR);
			else if (result.kind === 'cantShip')
				for (const id of result.entry.lineIds) cantShip.push({ lineId: id, message: result.message });
			else if (result.kind === 'quote') for (const id of result.entry.lineIds) quoteLines.add(id);
			else empty.push({ stepId: step.id, lineIds: result.entry.lineIds, blockId: result.blockId });
		};

		if (step.scope === 'wholeCart') {
			if (lines.length === 0) continue;
			const units = lines.reduce((n, l) => n + l.units, 0);
			const grams = lines.reduce((g, l) => g + (l.chargeableWeightGrams ?? 0) * l.units, 0);
			const value = lines.reduce((v, l) => v + l.sellingPriceINR * l.units, 0);
			take(
				priceResult(
					step,
					walk(step.node, scopeFor(null, 0), [step.id], step.id),
					lines,
					units,
					grams,
					value,
					cart,
				),
			);
			total += priced.reduce((s, v) => s + v, 0);
			continue;
		}

		for (const line of lines) {
			if (step.scope === 'eachLine') {
				const scope = scopeFor(line, line.units);
				const grams = (line.chargeableWeightGrams ?? 0) * line.units;
				take(
					priceResult(
						step,
						walk(step.node, scope, [step.id], step.id),
						[line],
						line.units,
						grams,
						line.sellingPriceINR * line.units,
						cart,
					),
				);
			} else {
				for (let u = 0; u < line.units; u += 1) {
					const scope = scopeFor(line, 1);
					take(
						priceResult(
							step,
							walk(step.node, scope, [step.id], step.id),
							[line],
							1,
							line.chargeableWeightGrams ?? 0,
							line.sellingPriceINR,
							cart,
						),
					);
				}
			}
		}
		if (priced.length > 0) {
			total +=
				step.combine === 'highest'
					? Math.max(...priced)
					: step.combine === 'lowest'
						? Math.min(...priced)
						: priced.reduce((s, v) => s + v, 0);
		}
	}

	if (cantShip.length > 0) return { status: 'cantShip', lines: dedupeCantShip(cantShip), trace };
	if (empty.length > 0) return { status: 'noResult', where: empty, trace };
	if (quoteLines.size > 0) return { status: 'needsQuote', lineIds: [...quoteLines], trace };

	const adjustments: ShippingAdjustTrace[] = [];
	let amount = roundINR(total);
	for (const adjust of body.adjust) {
		const before = amount;
		switch (adjust.kind) {
			case 'minimum':
				if (adjust.amount === null)
					return {
						status: 'noResult',
						where: [{ stepId: 'adjust', lineIds: lines.map((l) => l.lineId), blockId: adjust.id }],
						trace,
					};
				amount = Math.max(amount, adjust.amount);
				break;
			case 'maximum':
				if (adjust.amount === null)
					return {
						status: 'noResult',
						where: [{ stepId: 'adjust', lineIds: lines.map((l) => l.lineId), blockId: adjust.id }],
						trace,
					};
				amount = Math.min(amount, adjust.amount);
				break;
			case 'roundUp':
				if (adjust.to === null)
					return {
						status: 'noResult',
						where: [{ stepId: 'adjust', lineIds: lines.map((l) => l.lineId), blockId: adjust.id }],
						trace,
					};
				if (adjust.to > 0) amount = Math.ceil(amount / adjust.to - 1e-9) * adjust.to;
				break;
			case 'freeAbove':
				if (adjust.subtotal === null)
					return {
						status: 'noResult',
						where: [{ stepId: 'adjust', lineIds: lines.map((l) => l.lineId), blockId: adjust.id }],
						trace,
					};
				if (cart.subtotalINR >= adjust.subtotal) amount = 0;
				break;
		}
		amount = roundINR(amount);
		if (amount !== before)
			adjustments.push({ adjustId: adjust.id, kind: adjust.kind, fromINR: before, toINR: amount });
	}
	return { status: 'priced', amountINR: amount, trace, adjustments };
}

function dedupeCantShip(lines: ShippingCantShipLine[]): ShippingCantShipLine[] {
	const seen = new Set<string>();
	return lines.filter((l) => (seen.has(l.lineId) ? false : (seen.add(l.lineId), true)));
}
