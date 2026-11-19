import type {
	ShippingAmountSource,
	ShippingChargeKind,
	ShippingNode,
	ShippingResult,
	ShippingRuleSetBody,
	ShippingTraceEntry,
	ShippingTryLineView,
	ShippingZone,
} from '@saha-textile/contracts';

/**
 * Try it's words (brief rb02, rb03, rb09, rb10): each line's amount, its unit numbers when the
 * whole cart is counted, the small line under each product, and the sentence in the result box.
 * Worked out from the server's trace and the blocks, never priced again here.
 */

export type Translate = (key: string, params?: Record<string, string | number>) => string;

export interface TryLineFigures {
	/** What this line costs, when the trace gives it a share of its own; null otherwise. */
	amountINR: number | null;
	/** The units this line holds when the cart is counted as one (units 1–2, unit 3); null otherwise. */
	units: { from: number; to: number } | null;
}

export const rupees = (amount: number): string => `₹${amount.toLocaleString('en-IN')}`;
const grams = (value: number): string => Math.round(value).toLocaleString('en-IN');

/** A block of the body by id, searched through every step. */
export function findNode(body: ShippingRuleSetBody, id: string): ShippingNode | null {
	const visit = (node: ShippingNode | null): ShippingNode | null => {
		if (!node) return null;
		if (node.id === id) return node;
		if (node.kind === 'if') return visit(node.then) ?? visit(node.otherwise);
		if (node.kind === 'bands') {
			for (const band of node.bands) {
				const found = visit(band.then);
				if (found) return found;
			}
			return visit(node.otherwise);
		}
		return null;
	};
	for (const step of body.steps) {
		const found = visit(step.node);
		if (found) return found;
	}
	return null;
}

/** The result block an entry ended in: the last block on its path. */
function resultOf(body: ShippingRuleSetBody, entry: ShippingTraceEntry): ShippingResult | null {
	const last = entry.path[entry.path.length - 1];
	const node = last ? findNode(body, last) : null;
	return node?.kind === 'result' ? node.result : null;
}

function sourceFor(source: ShippingAmountSource, line: ShippingTryLineView): number {
	return source.from === 'fixed' ? (source.amount ?? 0) : line.charges[source.charge];
}

/** One first unit across the cart (the highest first-unit amount, earliest on a tie); every other unit its own further amount. */
function acrossCart(
	result: Extract<ShippingResult, { kind: 'firstAndFurther' }>,
	lines: readonly ShippingTryLineView[],
): Map<string, number> {
	const firsts = lines.map((line) => sourceFor(result.first, line));
	let pick = 0;
	firsts.forEach((value, i) => {
		if (value > (firsts[pick] ?? 0)) pick = i;
	});
	return new Map(
		lines.map((line, i) => {
			const further = sourceFor(result.further, line);
			const amount = i === pick ? (firsts[i] ?? 0) + further * (line.units - 1) : further * line.units;
			return [line.lineId, amount];
		}),
	);
}

export function lineFigures(
	body: ShippingRuleSetBody,
	lines: readonly ShippingTryLineView[],
	trace: readonly ShippingTraceEntry[],
): Map<string, TryLineFigures> {
	const figures = new Map<string, TryLineFigures>(lines.map((l) => [l.lineId, { amountINR: null, units: null }]));
	const add = (lineId: string, amount: number) => {
		const current = figures.get(lineId);
		if (current) current.amountINR = (current.amountINR ?? 0) + amount;
	};
	let countsUnits = false;
	for (const entry of trace) {
		if (entry.lineIds.length === 1) {
			add(entry.lineIds[0] ?? '', entry.amountINR);
			continue;
		}
		const result = resultOf(body, entry);
		if (result?.kind !== 'firstAndFurther') continue;
		countsUnits = true;
		const inEntry = lines.filter((l) => entry.lineIds.includes(l.lineId));
		if (result.count === 'acrossCart') {
			for (const [lineId, amount] of acrossCart(result, inEntry)) add(lineId, amount);
		} else {
			for (const line of inEntry)
				add(line.lineId, sourceFor(result.first, line) + sourceFor(result.further, line) * (line.units - 1));
		}
	}
	if (countsUnits) {
		let next = 1;
		for (const line of lines) {
			const current = figures.get(line.lineId);
			if (current && line.units > 0) current.units = { from: next, to: next + line.units - 1 };
			next += line.units;
		}
	}
	return figures;
}

/** Whether the blocks read a field (for "15% off" instead of "discounted", or weights in the line). */
export function bodyReads(body: ShippingRuleSetBody, field: string): boolean {
	return JSON.stringify(body).includes(`"${field}"`);
}

export function lineState(t: Translate, line: ShippingTryLineView, showPercent: boolean): string {
	if (!line.discounted) return t('ship_state_full_price');
	if (showPercent && line.mrpINR) {
		const percent = Math.round(((line.mrpINR - line.sellingPriceINR) / line.mrpINR) * 100);
		return t('ship_state_percent_off', { percent });
	}
	return t('ship_state_discounted');
}

const capitalise = (text: string): string => text.charAt(0).toLocaleUpperCase() + text.slice(1);

/** The small line under a product in Try it. */
export function lineSubline(
	t: Translate,
	input: {
		body: ShippingRuleSetBody;
		line: ShippingTryLineView;
		figures: TryLineFigures | undefined;
		trace: readonly ShippingTraceEntry[];
		zone: ShippingZone;
	},
): string {
	const { body, line, figures, trace, zone } = input;
	if (bodyReads(body, 'line.chargeableWeight') || bodyReads(body, 'cart.chargeableWeight') || bodyReads(body, 'kg')) {
		const box = line.box;
		const parts: string[] = [];
		if (box?.weightGrams != null) parts.push(`${grams(box.weightGrams)} g`);
		if (box?.lengthCm != null && box.widthCm != null && box.heightCm != null)
			parts.push(t('ship_line_box', { l: box.lengthCm, w: box.widthCm, h: box.heightCm }));
		if (line.chargeableWeightGrams != null && parts.length > 1)
			parts.push(t('ship_line_chargeable', { grams: grams(line.chargeableWeightGrams) }));
		return parts.join(' · ');
	}
	const state = lineState(t, line, bodyReads(body, 'line.discountPercent'));
	if (figures?.units) {
		const { from, to } = figures.units;
		return `${capitalise(state)} · ${from === to ? t('ship_line_unit', { n: from }) : t('ship_line_units', { from, to })}`;
	}
	const parts = [
		line.mrpINR != null ? t('ship_line_mrp', { amount: rupees(line.mrpINR) }) : null,
		t('ship_line_price', { amount: rupees(line.sellingPriceINR) }),
		state,
	];
	const own = trace.find((entry) => entry.lineIds.length === 1 && entry.lineIds[0] === line.lineId);
	const result = own ? resultOf(body, own) : null;
	if (result?.kind === 'productCharge') {
		const kind: ShippingChargeKind = result.charge;
		const source = line.chargeSources?.[kind];
		const amount = rupees(line.charges[kind]);
		parts.push(
			source?.from === 'category' && source.name
				? t('ship_line_charge_from', { amount, from: source.name })
				: t('ship_line_charge', { amount }),
		);
	}
	void zone;
	return parts.filter((part): part is string => Boolean(part)).join(' · ');
}

/** The sentence in the result box: the lines in order, or units of the whole cart, then adjustments. */
export function tryExplanation(
	t: Translate,
	input: {
		body: ShippingRuleSetBody;
		lines: readonly ShippingTryLineView[];
		trace: readonly ShippingTraceEntry[];
		adjustments?: ReadonlyArray<{ kind: string; fromINR: number; toINR: number }>;
	},
): string {
	const { body, lines, trace } = input;
	const sentences: string[] = [];
	const number = new Map(lines.map((line, i) => [line.lineId, i + 1]));
	const showPercent = bodyReads(body, 'line.discountPercent');

	const whole = trace.find((entry) => entry.lineIds.length > 1 && resultOf(body, entry)?.kind === 'firstAndFurther');
	if (whole) {
		const units = whole.units ?? 0;
		const first = rupees(whole.firstINR ?? 0);
		const further = whole.furtherINR ?? 0;
		const rest = units - 1;
		if (rest <= 0) sentences.push(t('ship_explain_unit_one', { first }));
		else if (rest === 1) sentences.push(t('ship_explain_unit_two', { first, further: rupees(further) }));
		else if (rest === 2) sentences.push(t('ship_explain_units_three', { first, further: rupees(further) }));
		else sentences.push(t('ship_explain_units_many', { first, last: units, further: rupees(further) }));
	}

	const perLine = trace.filter((entry) => entry.lineIds.length === 1);
	const lineStep = body.steps.find((step) => step.scope === 'eachLine');
	if (perLine.length > 1 && lineStep && lineStep.combine !== 'sum') {
		const amounts = perLine.map((entry) => entry.amountINR).sort((a, b) => b - a);
		const kept = lineStep.combine === 'highest' ? amounts[0] : amounts[amounts.length - 1];
		const dropped = amounts.filter((_, i) => i !== (lineStep.combine === 'highest' ? 0 : amounts.length - 1));
		const key = `ship_explain_${lineStep.combine}_${dropped.length === 1 ? 'one' : 'many'}`;
		sentences.push(t(key, { kept: rupees(kept ?? 0), dropped: dropped.map(rupees).join(', ') }));
	} else {
		for (const entry of perLine) {
			const lineId = entry.lineIds[0] ?? '';
			const line = lines.find((l) => l.lineId === lineId);
			if (!line) continue;
			sentences.push(
				t('ship_explain_line', {
					n: number.get(lineId) ?? 0,
					state: lineState(t, line, showPercent),
					result: entryWords(t, entry),
				}),
			);
		}
	}

	for (const adjustment of input.adjustments ?? []) {
		if (adjustment.fromINR === adjustment.toINR) continue;
		sentences.push(
			t(`ship_explain_adjust_${adjustment.kind}`, {
				from: rupees(adjustment.fromINR),
				to: rupees(adjustment.toINR),
			}),
		);
	}
	return sentences.join(' ');
}

/** One entry in words: free, 2 units × ₹100, ₹149, 10% = ₹245, 2 kg × ₹40 = ₹80. */
export function entryWords(t: Translate, entry: ShippingTraceEntry): string {
	switch (entry.result) {
		case 'free':
			return t('ship_why_free');
		case 'none':
			return t('ship_why_none');
		case 'cantShip':
			return t('ship_why_cant_ship');
		case 'courierQuote':
			return t('ship_why_courier');
		case 'percent':
			return t('ship_why_percent', { percent: entry.percent ?? 0, amount: rupees(entry.amountINR) });
		default:
			if (entry.kg !== undefined)
				return t('ship_why_kg', {
					kg: entry.kg,
					each: rupees(entry.unitAmountINR ?? 0),
					amount: rupees(entry.amountINR),
				});
			if (entry.units !== undefined && entry.unitAmountINR !== undefined)
				return t(entry.units === 1 ? 'ship_why_unit_one' : 'ship_why_units_each', {
					units: entry.units,
					each: rupees(entry.unitAmountINR),
				});
			return rupees(entry.amountINR);
	}
}
