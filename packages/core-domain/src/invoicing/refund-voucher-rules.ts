import type { OrderPayment, RefundVoucherStatus } from '@saha-textile/contracts';

const paise = (rupees: number): number => Math.round(rupees * 100);

/**
 * Our own refund reference for a gateway (CCAvenue takes 1–30 letters and digits): a prefix and the
 * document's id with everything else dropped. The same document always gives the same reference, so a retry
 * never refunds twice.
 */
export function gatewayRefundReference(prefix: string, id: string): string {
	return `${prefix}${id}`.replace(/[^A-Za-z0-9]/g, '').slice(0, 30);
}

/** What a gateway's answer means for the voucher: taken, refused, or not known yet. */
export function refundStatusOf(outcome: 'accepted' | 'duplicate' | 'refused' | null): RefundVoucherStatus {
	if (outcome === 'accepted' || outcome === 'duplicate') return 'refunded';
	if (outcome === 'refused') return 'failed';
	return 'waiting_for_gateway';
}

/** C1: the payments a cancelled order gives back, each in full: received money with its receipt. */
export function refundablePayments(payments: readonly OrderPayment[]): OrderPayment[] {
	return payments.filter((p) => p.state === 'received' && p.amountINR > 0 && !!p.receiptNumber);
}

/**
 * The refund voucher's posting (posting rules, "Refund voucher (no invoice yet)"): the customer's advance comes
 * off, against the gateway clearing account or the bank it was paid from.
 */
export function refundVoucherPosting(
	amountINR: number,
	paidFrom: { role: string } | { id: string },
): { ledger: { role: string } | { id: string }; debitPaise?: number; creditPaise?: number }[] {
	return [
		{ ledger: { role: 'customer_advances' }, debitPaise: paise(amountINR) },
		{ ledger: paidFrom, creditPaise: paise(amountINR) },
	];
}
