import type { AdjustmentOutcome, InventoryReasonCode } from '@saha-textile/contracts';

/**
 * Numbered stock adjustments (accounts brief D5, E1 and E3; decision D9). A removal written off takes its value out of
 * stock into stock loss and, for pieces lost, damaged, used as samples or found missing on a recount, takes back their
 * input tax by a journal voucher (s.17(5)(h)); one kept and held as damaged is still ours and posts nothing. Which
 * reasons reverse the tax is to be confirmed by the CA (B7.6, B8.3).
 */

const paise = (inr: number): number => Math.round(inr * 100);

/** A posting line by role, as the credit-note rules write them. */
type PostingRow = { role: string; debitPaise?: number; creditPaise?: number };

/** Removal reasons whose written-off pieces take back their input tax. A supplier's shortage goes back to them instead. */
export const ITC_REVERSAL_REASONS: readonly InventoryReasonCode[] = [
	'damage',
	'lost_missing',
	'internal_use_sample',
	'manual_recount_correction',
	'other',
];

/** Whether an adjustment reverses input tax: a removal written off, for one of those reasons. */
export function reversesInputTax(
	action: 'remove' | 'add',
	outcome: AdjustmentOutcome | null | undefined,
	reasonCode: InventoryReasonCode | null,
): boolean {
	return (
		action === 'remove' && outcome !== 'keptDamaged' && !!reasonCode && ITC_REVERSAL_REASONS.includes(reasonCode)
	);
}

/** The input tax on pieces at their cost (E1's "₹31.00" on ₹620 at 5%), in rupees. */
export function adjustmentInputTaxINR(valueAtCostINR: number, ratePercent: number): number {
	return Math.round((paise(valueAtCostINR) * ratePercent) / 100) / 100;
}

/**
 * The stock value an adjustment moves (posting rules): a removal written off is stock loss against stock in hand; an
 * addition puts the value back into stock against stock loss. Nothing for no value.
 */
export function stockAdjustmentPosting(action: 'remove' | 'add', valueAtCostINR: number): PostingRow[] {
	const total = paise(valueAtCostINR);
	if (total <= 0) return [];
	return action === 'remove'
		? [
				{ role: 'stock_loss', debitPaise: total },
				{ role: 'stock_in_hand', creditPaise: total },
			]
		: [
				{ role: 'stock_in_hand', debitPaise: total },
				{ role: 'stock_loss', creditPaise: total },
			];
}
