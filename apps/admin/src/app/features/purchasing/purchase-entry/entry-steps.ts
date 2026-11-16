import type { PurchaseEntry } from '@saha-textile/contracts';

/** The purchase entry's steps on the order page's tracking panel, with the theme's tracking pictures (p08, p10). */
export const ENTRY_STEPS: ReadonlyArray<{ svg: string; label: string }> = [
	{ svg: 'pending', label: 'pe_status_draft' },
	{ svg: 'processing', label: 'pe_status_checked' },
	{ svg: 'delivered', label: 'pe_step_posted' },
	{ svg: 'refund', label: 'pay_status_paid' },
];

/** How far along an entry is: Draft 0, Goods checked 1, Posted 2, Paid 3 (a void entry keeps where it stopped). */
export function entryStep(entry: Pick<PurchaseEntry, 'status' | 'paymentStatus' | 'postedAt' | 'checkedAt'>): number {
	if (entry.status === 'draft') return 0;
	if (entry.status === 'checked') return 1;
	if (entry.status === 'posted') return entry.paymentStatus === 'paid' ? 3 : 2;
	return entry.postedAt ? 2 : entry.checkedAt ? 1 : 0;
}
