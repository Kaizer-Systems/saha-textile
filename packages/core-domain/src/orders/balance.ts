import type { OrderBalance, OrderPaymentStatus, PaymentRecordState } from '@saha-textile/contracts';

/**
 * The money on an order, in rupees (open orders keep their balance in ₹, concern K10), and the
 * payment status worked out from the payment records (brief "Payment has its own status").
 */

const round2 = (amount: number): number => Math.round((amount + Number.EPSILON) * 100) / 100;

export interface BalanceInput {
	/** Each line's total in rupees before coupons. */
	lineTotalsINR: readonly number[];
	couponINR: number;
	shippingINR: number;
	/** Delivery money taken off by a free-delivery coupon. */
	deliveryCouponINR?: number;
	payments: ReadonlyArray<{ amountINR: number; state: PaymentRecordState; refundedINR?: number }>;
}

/** Goods, coupons, shipping, paid, due and paid ahead. Pending and failed payments don't count. */
export function orderBalance(input: BalanceInput): OrderBalance {
	const goodsINR = round2(input.lineTotalsINR.reduce((sum, amount) => sum + amount, 0));
	const couponINR = round2(Math.min(input.couponINR, goodsINR));
	const shippingINR = round2(Math.max(0, input.shippingINR - (input.deliveryCouponINR ?? 0)));
	const totalINR = round2(goodsINR - couponINR + shippingINR);
	let paidINR = 0;
	let refundedINR = 0;
	for (const payment of input.payments) {
		if (payment.state === 'received' || payment.state === 'partRefunded' || payment.state === 'refunded') {
			paidINR += payment.amountINR;
			refundedINR += payment.refundedINR ?? (payment.state === 'refunded' ? payment.amountINR : 0);
		}
	}
	paidINR = round2(paidINR);
	refundedINR = round2(refundedINR);
	const net = round2(paidINR - refundedINR);
	return {
		goodsINR,
		couponINR,
		shippingINR,
		totalINR,
		paidINR,
		dueINR: round2(Math.max(0, totalINR - net)),
		paidAheadINR: round2(Math.max(0, net - totalINR)),
		refundedINR,
	};
}

export interface PaymentStatusInput {
	balance: OrderBalance;
	/** The order was placed as cash on delivery and the cash isn't recorded yet. */
	cashOnDelivery: boolean;
	/** The order was placed on a business's account. */
	onAccount: boolean;
	/** A payment request is active (not paid, expired or cancelled). */
	activeRequest: boolean;
	/** A payment is pending at the bank (UPI pending, bank transfer not arrived, gateway pending). */
	pendingAtBank: boolean;
}

/** Unpaid · Request sent · Pending at the bank · Paid · Part paid · Paid ahead · Due on delivery · On account · Refunded · Part refunded. */
export function derivePaymentStatus(input: PaymentStatusInput): OrderPaymentStatus {
	const { balance } = input;
	if (balance.refundedINR > 0) return balance.refundedINR >= balance.paidINR ? 'refunded' : 'part_refunded';
	if (balance.totalINR > 0 && balance.dueINR === 0) return balance.paidAheadINR > 0 ? 'paid_ahead' : 'paid';
	if (balance.totalINR === 0 && balance.paidAheadINR > 0) return 'paid_ahead';
	if (input.pendingAtBank) return 'pending_at_bank';
	if (input.activeRequest) return 'request_sent';
	if (input.onAccount) return 'on_account';
	if (input.cashOnDelivery) return 'due_on_delivery';
	if (balance.paidINR > 0) return 'part_paid';
	return 'unpaid';
}

/** Whether the order can be placed: paid in full, or trusted (cash on delivery, on account). */
export function isPlaceable(status: OrderPaymentStatus): boolean {
	return status === 'paid' || status === 'paid_ahead' || status === 'due_on_delivery' || status === 'on_account';
}
