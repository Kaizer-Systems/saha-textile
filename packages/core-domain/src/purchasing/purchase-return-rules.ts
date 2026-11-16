import { fromPaise, roundPaise, type SoldBy } from './money';
import type { PurchaseTaxType } from './purchase-entry-math';
import { formatQuantity } from './money';

/**
 * Purchase returns and debit notes (r01–r04). A return always starts from a posted purchase
 * entry, so the cost that comes off is that entry's own cost; returning goods takes them out of
 * stock when the return is SENT, never when it is drafted. A short-supply claim moves no stock.
 */

export interface ReturnableFacts {
	entryLineId: string;
	/** Good pieces the entry took into stock. */
	accepted: number;
	/** Missing pieces on the goods check (short-supply claims draw from these). */
	missing: number;
	/** Already on returns that are sent or settled, plus other drafts. */
	returnedBefore: number;
	claimedShortBefore: number;
	onHand: number;
	held: number;
	reserved: number;
	/** What is still in this entry line's own cost layer. */
	layerRemaining: number;
	soldBy: SoldBy;
}

/** r02/r03: the most that can go back now, and why it is capped when it is. */
export function freeToReturn(
	facts: ReturnableFacts,
	kind: 'return_goods' | 'short_supply',
	hold: { quantity: number } | null = null,
): { max: number; capReason: string | null } {
	if (kind === 'short_supply') {
		const max = Math.max(0, facts.missing - facts.claimedShortBefore);
		return { max, capReason: max === 0 ? 'Every missing piece is already claimed.' : null };
	}
	const fromEntry = Math.max(0, facts.accepted - facts.returnedBefore);
	const inLayer = Math.max(0, facts.layerRemaining);
	if (hold) {
		const max = Math.min(fromEntry, inLayer, hold.quantity);
		return {
			max,
			capReason:
				max < hold.quantity ? 'Some held pieces came from another entry or have already been returned.' : null,
		};
	}
	const free = Math.max(0, facts.onHand - facts.held - facts.reserved);
	const max = Math.min(fromEntry, inLayer, free);
	let capReason: string | null = null;
	if (max < Math.min(fromEntry, inLayer)) {
		const parts: string[] = [];
		if (facts.held > 0) parts.push(`${formatQuantity(facts.held, facts.soldBy)} held`);
		if (facts.reserved > 0)
			parts.push(`${formatQuantity(facts.reserved, facts.soldBy)} in paid orders waiting to ship`);
		capReason = `${formatQuantity(facts.onHand, facts.soldBy)} on hand, but ${parts.join(' and ')}: ${formatQuantity(max, facts.soldBy)} free to return.`;
	} else if (inLayer < fromEntry) {
		capReason = `Only ${formatQuantity(inLayer, facts.soldBy)} from this entry is still in stock; the rest has sold.`;
	}
	return { max, capReason };
}

export interface ReturnLineMathInput {
	quantity: number;
	/** Per stock unit, from the entry's cost layer (before GST when ITC was claimable). */
	unitCostPerStockUnitINR: number;
	gstRatePct: number;
}

/** The debit note's lines and totals: value at the entry's cost, GST as the bill charged it. */
export function computeReturnTotals(taxType: PurchaseTaxType, lines: readonly ReturnLineMathInput[]) {
	const computed = lines.map((line) => {
		const taxable = roundPaise(line.quantity * line.unitCostPerStockUnitINR * 100);
		const tax = taxType === 'none' ? 0 : roundPaise((taxable * line.gstRatePct) / 100);
		return { taxable, tax };
	});
	const taxable = computed.reduce((sum, line) => sum + line.taxable, 0);
	const tax = computed.reduce((sum, line) => sum + line.tax, 0);
	const cgst = taxType === 'intra_state' ? Math.round(tax / 2) : 0;
	return {
		lines: computed.map((line) => ({
			taxableINR: fromPaise(line.taxable),
			taxINR: fromPaise(line.tax),
			totalINR: fromPaise(line.taxable + line.tax),
		})),
		taxableINR: fromPaise(taxable),
		cgstINR: fromPaise(cgst),
		sgstINR: fromPaise(taxType === 'intra_state' ? tax - cgst : 0),
		igstINR: fromPaise(taxType === 'inter_state' ? tax : 0),
		totalINR: fromPaise(taxable + tax),
	};
}

/** A part settlement leaves the rest open on the supplier's statement (r04). */
export function settlementOpen(totalINR: number, settledINR: number): number {
	return Math.max(0, Math.round((totalINR - settledINR) * 100) / 100);
}
