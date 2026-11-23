import type { RefundVoucher, RefundVoucherReason } from '@saha-textile/contracts';
import { rupeesInWords } from '@saha-textile/core-domain';

import { longDate } from '../purchasing/purchase-order-document';
import type { DocumentData } from './document-data';
import { money } from './record-prints';

/** Why the money went back, as the voucher prints it. */
export const REFUND_REASON_WORDS: Record<RefundVoucherReason, string> = {
	order_cancelled: 'Order cancelled before dispatch',
	line_cancelled: 'One line cancelled',
	sold_out_before_payment: 'Sold out before payment',
	paid_after_cancel: 'Paid after the order was cancelled',
};

/** C2 print (Rule 51): the receipt it gives back, how and to whom; an advance for goods carries no GST. */
export function refundVoucherData(voucher: RefundVoucher, seller: { name: string; lines: string[] }): DocumentData {
	return {
		doc: 'refundVoucher',
		title: 'Refund voucher',
		number: voucher.number,
		date: longDate(voucher.date),
		seller,
		values: {
			voucherNo: voucher.number,
			date: longDate(voucher.date),
			receiptNo: voucher.receiptNumber ?? '—',
			amount: money(voucher.amountINR),
			taxReversed: 'None: an advance for goods carries no GST',
			method: voucher.how === 'gateway' ? 'Gateway refund' : 'Bank transfer',
			reference: voucher.reference,
			reason: REFUND_REASON_WORDS[voucher.reason],
			amountInWords: rupeesInWords(voucher.amountINR),
		},
		parties: { payee: { heading: 'Paid to', lines: [voucher.payee] } },
	};
}
