import { z } from 'zod';

import { Id, IsoDateTime } from './common';
import { StatusChangeWrite } from './order-admin';
import { IsoDate } from './purchasing';

/**
 * Refund vouchers (accounts brief C, Rule 51): money given back before anything was invoiced. Made with the
 * refund, never by hand; never edited, deleted or cancelled once the money has gone back. A refund the gateway
 * refused is tried again or paid by bank transfer.
 */
export const RefundVoucherReason = z.enum([
	'order_cancelled',
	'line_cancelled',
	'sold_out_before_payment',
	'paid_after_cancel',
]);
export type RefundVoucherReason = z.infer<typeof RefundVoucherReason>;

export const RefundVoucherHow = z.enum(['gateway', 'bank_transfer']);
export type RefundVoucherHow = z.infer<typeof RefundVoucherHow>;

export const RefundVoucherStatus = z.enum(['refunded', 'waiting_for_gateway', 'failed']);
export type RefundVoucherStatus = z.infer<typeof RefundVoucherStatus>;

export const RefundVoucher = z.object({
	id: Id,
	/** RF/26-27/000003. */
	number: z.string().min(1),
	/** The refund's date. */
	date: IsoDate,
	orderId: Id,
	orderNumber: z.string(),
	paymentId: Id,
	receiptNumber: z.string().nullable(),
	receiptDate: IsoDate.nullable(),
	payee: z.string(),
	amountINR: z.number().nonnegative(),
	/** The money as it moved (a PayPal payment is refunded in its own currency). */
	currency: z.string().length(3),
	amount: z.number().nonnegative(),
	how: RefundVoucherHow,
	/** Gateway: our own refund reference (a retry never refunds twice). Bank transfer: the UTR typed in. */
	reference: z.string(),
	reason: RefundVoucherReason,
	status: RefundVoucherStatus,
	/** The gateway's words when it refused; never shown to customers. */
	refusal: z.string().nullable().default(null),
	/** The cash or bank ledger a bank transfer was paid from. */
	ledgerId: Id.nullable().default(null),
	locationId: Id,
	voucherId: Id.nullable().default(null),
	createdAt: IsoDateTime,
	createdBy: Id.nullable().default(null),
	updatedAt: IsoDateTime,
});
export type RefundVoucher = z.infer<typeof RefundVoucher>;

/** Paid by bank transfer instead (C1 second choice, or a failed gateway refund): from which ledger, with its UTR. */
export const RefundByHand = z.object({
	ledgerId: Id,
	reference: z.string().trim().min(4).max(60),
});
export type RefundByHand = z.infer<typeof RefundByHand>;

export const RefundHowWrite = z.discriminatedUnion('how', [
	z.object({ how: z.literal('gateway') }),
	RefundByHand.extend({ how: z.literal('bank_transfer') }),
]);
export type RefundHowWrite = z.infer<typeof RefundHowWrite>;

/** C1 "Cancel and refund": the existing cancel step's fields, and how the money goes back. */
export const CancelAndRefundWrite = z.object({
	comment: StatusChangeWrite.shape.comment,
	cancel: StatusChangeWrite.shape.cancel.unwrap().unwrap(),
	revision: z.number().int().nonnegative(),
	refund: RefundHowWrite,
});
export type CancelAndRefundWrite = z.infer<typeof CancelAndRefundWrite>;
