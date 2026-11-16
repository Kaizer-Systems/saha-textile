import { daysBetween } from './fiscal-year';
import { formatQuantity, formatRupees, roundUnitCost, type SoldBy } from './money';

/**
 * Stock rules: what may be taken out, held or released; who needs approval (P2); what a
 * write-off is worth at cost (FIFO, oldest first); count differences; reorder suggestions;
 * ageing bands; opening stock rows. Quantities are stock units (pieces, or tenths of a metre).
 */

export interface StockFacts {
	onHand: number;
	held: number;
	/** Paid orders not shipped yet (0 until checkout reservation, DEC-STOCK-RESERVE). */
	reserved: number;
}

export function freeToSell(facts: StockFacts): number {
	return facts.onHand - facts.held - facts.reserved;
}

export type AdjustmentAction = 'remove' | 'add' | 'hold' | 'release';

/**
 * P2 (owner, 2026-11-15): every write-off needs approval, with no amount limit; anyone holding
 * the approve permission (the super admin, and any role or user given it) applies directly and
 * is recorded as the approver. Manual additions change stock value too, so they follow the same
 * rule. Holds and releases never need approval (the brief's held stock rules).
 */
export function adjustmentNeedsApproval(action: AdjustmentAction, canApprove: boolean): boolean {
	if (action === 'hold' || action === 'release') return false;
	return !canApprove;
}

/** Why an adjustment cannot go ahead, or null. A held write-off draws from its hold. */
export function adjustmentRefusal(input: {
	action: AdjustmentAction;
	quantity: number;
	facts: StockFacts;
	soldBy: SoldBy;
	/** The hold a release or a held write-off draws from. */
	hold: { quantity: number; status: string } | null;
	tracked: boolean;
}): string | null {
	const { action, quantity, facts, soldBy } = input;
	if (!input.tracked) return 'This item does not keep stock.';
	if (quantity <= 0) return 'The quantity must be more than 0.';
	const free = freeToSell(facts);
	if (action === 'release') {
		if (!input.hold || input.hold.status !== 'open') return 'That hold is no longer open.';
		if (quantity > input.hold.quantity) return `Only ${formatQuantity(input.hold.quantity, soldBy)} is held there.`;
		return null;
	}
	if (action === 'hold') {
		if (quantity > free) return `Only ${formatQuantity(Math.max(free, 0), soldBy)} is free to hold.`;
		return null;
	}
	if (action === 'remove') {
		if (input.hold) {
			if (input.hold.status !== 'open') return 'That hold is no longer open.';
			if (quantity > input.hold.quantity)
				return `Only ${formatQuantity(input.hold.quantity, soldBy)} is held there.`;
			return null;
		}
		// Oversell stays off (owner lock): never take out what paid orders or holds need.
		if (quantity > free) {
			return facts.reserved > 0
				? `Only ${formatQuantity(Math.max(free, 0), soldBy)} can come out: paid orders need ${formatQuantity(facts.reserved, soldBy)}.`
				: `Only ${formatQuantity(Math.max(free, 0), soldBy)} is free; release held pieces first or write off from Held stock.`;
		}
		return null;
	}
	return null;
}

export interface CostLayerFact {
	id: string;
	receivedAt: string;
	quantityRemaining: number;
	/** Per stock unit (per piece, or per tenth of a metre). */
	unitCostINR: number;
}

/**
 * The value of `quantity` units taken oldest-first, and the sentence the screens show
 * ("1 at ₹8,600 + 1 at ₹9,295.61"). Costs show per piece or per metre.
 */
export function fifoDraw(
	layers: readonly CostLayerFact[],
	quantity: number,
	soldBy: SoldBy,
): {
	valueINR: number;
	uncosted: number;
	parts: Array<{ layerId: string; quantity: number; unitCostINR: number }>;
	breakdown: string;
} {
	const ordered = [...layers]
		.filter((layer) => layer.quantityRemaining > 0)
		.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
	let left = quantity;
	const parts: Array<{ layerId: string; quantity: number; unitCostINR: number }> = [];
	for (const layer of ordered) {
		if (left <= 0) break;
		const take = Math.min(left, layer.quantityRemaining);
		parts.push({ layerId: layer.id, quantity: take, unitCostINR: layer.unitCostINR });
		left -= take;
	}
	const valuePaise = parts.reduce((sum, part) => sum + Math.round(part.quantity * part.unitCostINR * 100), 0);
	const perUnit = soldBy === 'metre' ? 10 : 1;
	const breakdown = parts
		.map(
			(part) =>
				`${formatQuantity(part.quantity, soldBy)} at ${formatRupees(roundUnitCost(part.unitCostINR * perUnit))}${soldBy === 'metre' ? ' / m' : ''}`,
		)
		.join(' + ');
	return { valueINR: valuePaise / 100, uncosted: Math.max(left, 0), parts, breakdown };
}

/** Value of what is left in a set of layers. */
export function layersValue(layers: readonly CostLayerFact[]): number {
	return Math.round(layers.reduce((sum, layer) => sum + layer.quantityRemaining * layer.unitCostINR * 100, 0)) / 100;
}

/**
 * What the pieces on hand are worth at cost. FIFO sends the oldest pieces out first, so what is
 * left is the newest: on-hand units are valued against the newest layers. This holds whether or
 * not every sale has drawn its layer yet; units no layer covers are reported as uncosted.
 */
export function onHandValue(layers: readonly CostLayerFact[], onHand: number): { valueINR: number; uncosted: number } {
	const newestFirst = [...layers]
		.filter((layer) => layer.quantityRemaining > 0)
		.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
	let left = Math.max(0, onHand);
	let paise = 0;
	for (const layer of newestFirst) {
		if (left <= 0) break;
		const take = Math.min(left, layer.quantityRemaining);
		paise += Math.round(take * layer.unitCostINR * 100);
		left -= take;
	}
	return { valueINR: paise / 100, uncosted: left };
}

/** The age of the oldest piece still in stock, in days, or null with nothing in stock. */
export function oldestPieceDays(layers: readonly CostLayerFact[], today: string): number | null {
	const open = layers.filter((layer) => layer.quantityRemaining > 0);
	if (open.length === 0) return null;
	const oldest = open.reduce(
		(first, layer) => (layer.receivedAt < first ? layer.receivedAt : first),
		open[0]?.receivedAt ?? today,
	);
	return Math.max(0, daysBetween(oldest.slice(0, 10), today));
}

export type StockStatus = 'in_stock' | 'low' | 'out' | 'made_to_order';

export function stockStatus(input: { free: number; lowLevel: number | null; madeToOrder: boolean }): StockStatus {
	if (input.free <= 0) return input.madeToOrder ? 'made_to_order' : 'out';
	if (input.lowLevel !== null && input.free <= input.lowLevel) return 'low';
	return 'in_stock';
}

/** Whether a hold has sat longer than the reminder setting (i06). */
export function holdOverdue(since: string, today: string, reminderDays: number): boolean {
	return daysBetween(since.slice(0, 10), today) > reminderDays;
}

/* ------------------------------------------------------------------ counts */

/**
 * A counted line: expected = stock at the start + every movement since (sales, purchases,
 * returns), so the shop keeps selling during a count (c02, c03).
 */
export function countLineDifference(input: { atStart: number; movedSince: number; counted: number | null }): {
	expected: number;
	difference: number | null;
} {
	const expected = input.atStart + input.movedSince;
	return { expected, difference: input.counted === null ? null : input.counted - expected };
}

/* ------------------------------------------------------------------ reorder */

export const REORDER_LOOKBACK_DAYS = 60;
export const REORDER_RUNWAY_DAYS = 14;
export const REORDER_COVER_DAYS = 45;

/**
 * i07: on the list when free-to-sell is at or under the low-stock level, or would run out
 * within 14 days at the last 60 days' pace; the suggestion covers 45 days of sales.
 */
export function reorderSuggestion(input: {
	free: number;
	lowLevel: number | null;
	soldLast60: number;
	soldBy: SoldBy;
}): {
	listed: boolean;
	daysLeft: number | null;
	suggested: number;
} {
	const perDay = input.soldLast60 / REORDER_LOOKBACK_DAYS;
	const daysLeft = perDay > 0 ? Math.floor(Math.max(input.free, 0) / perDay) : null;
	const atLevel = input.lowLevel !== null && input.free <= input.lowLevel;
	const runningOut = daysLeft !== null && daysLeft <= REORDER_RUNWAY_DAYS;
	const listed = atLevel || runningOut;
	let suggested = Math.ceil(perDay * REORDER_COVER_DAYS) - Math.max(input.free, 0);
	if (input.soldBy === 'metre') suggested = Math.ceil(suggested / 5) * 5; // half-metre steps
	return { listed, daysLeft, suggested: Math.max(suggested, input.soldBy === 'metre' ? 10 : 1) };
}

/* ------------------------------------------------------------------ ageing */

export const AGEING_BANDS: ReadonlyArray<{ label: string; fromDays: number; toDays: number | null }> = [
	{ label: '0–90 days', fromDays: 0, toDays: 90 },
	{ label: '91–180 days', fromDays: 91, toDays: 180 },
	{ label: '181–365 days', fromDays: 181, toDays: 365 },
	{ label: 'Over a year', fromDays: 366, toDays: null },
];

export function ageingBandOf(days: number): number {
	return AGEING_BANDS.findIndex((band) => days >= band.fromDays && (band.toDays === null || days <= band.toDays));
}

/* ------------------------------------------------------------------ opening stock */

export type OpeningRowResult =
	'ready' | 'cost_missing' | 'unknown_sku' | 'already_has_stock' | 'quantity_invalid' | 'repeated';

/**
 * o01: a row is ready only with a known SKU that has never had stock, a whole quantity above 0
 * (metres in steps of 0.1), and a cost. Posting stays off until every row is ready.
 */
export function classifyOpeningRow(input: {
	known: boolean;
	soldBy: SoldBy | null;
	quantity: number;
	unitCostINR: number | null;
	hasStockOrMovements: boolean;
	repeated: boolean;
}): OpeningRowResult {
	if (!input.known) return 'unknown_sku';
	if (input.repeated) return 'repeated';
	const units = input.soldBy === 'metre' ? input.quantity * 10 : input.quantity;
	if (!(input.quantity > 0) || Math.abs(units - Math.round(units)) > 1e-9) return 'quantity_invalid';
	if (input.hasStockOrMovements) return 'already_has_stock';
	if (input.unitCostINR === null || !(input.unitCostINR >= 0)) return 'cost_missing';
	return 'ready';
}

/* ------------------------------------------------------------------ metre quantities */

/** M1: − and + move a metre line by 0.5 m (5 tenths); pieces by 1. */
export function stepperStep(soldBy: SoldBy): number {
	return soldBy === 'metre' ? 5 : 1;
}

/**
 * A typed length snapped to 0.1 m (half up): 2.55 → 2.6. Returns tenths, and whether it moved,
 * so the shop can say "2.55 m became 2.6 m".
 */
export function snapMetres(typed: number): { tenths: number; snapped: boolean } {
	const tenths = Math.round(typed * 10 + 1e-9);
	return { tenths, snapped: Math.abs(typed * 10 - tenths) > 1e-9 };
}

/**
 * M3 is open (business owner, round-2 O1): when a cut would leave less than the shortest cut,
 * the shop offers Take all or Keep. This returns the leftover so the shop can ask.
 */
export function scrapLeftover(input: { requested: number; available: number; shortestCut: number }): number | null {
	const left = input.available - input.requested;
	return left > 0 && left < input.shortestCut ? left : null;
}
