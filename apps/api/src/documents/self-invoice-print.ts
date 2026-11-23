import type { PaymentMode, PaymentVoucher, SelfInvoice } from '@saha-textile/contracts';
import { gstStateName, rupeesInWords } from '@saha-textile/core-domain';

import { longDate } from '../purchasing/purchase-order-document';
import type { DocumentData } from './document-data';
import { money } from './record-prints';

/** How a payment was made, as a voucher prints it. */
export const PAYMENT_MODE_WORDS: Record<PaymentMode, string> = {
	bank_transfer: 'Bank transfer',
	upi: 'UPI',
	cheque: 'Cheque',
	cash: 'Cash',
};

const state = (code: string) => `${gstStateName(code) ?? code} (${code})`;

/** D2 print (Rule 47A): the supply on which we pay the tax ourselves, from the unregistered supplier. */
export function selfInvoiceData(invoice: SelfInvoice, seller: { name: string; lines: string[] }): DocumentData {
	const taxLabel = invoice.interState ? 'IGST' : 'CGST + SGST';
	const number = invoice.number ?? 'Draft';
	const date = longDate(invoice.date ?? invoice.receivedOn);
	return {
		doc: 'selfInvoice',
		title: 'Self-invoice',
		number,
		date,
		seller,
		values: {
			selfInvoiceNo: number,
			date,
			placeOfSupply: state(invoice.placeOfSupply),
			rcmNote: 'Tax payable on reverse charge: Yes. Bought from an unregistered supplier.',
			amountInWords: rupeesInWords(invoice.totalINR),
		},
		parties: {
			supplier: {
				heading: 'Supplier (unregistered)',
				lines: [invoice.supplierName, invoice.supplierAddress].filter(Boolean),
			},
		},
		taxHeading: taxLabel,
		rows: [
			{
				kind: 'line',
				depth: 0,
				cells: {
					index: '1',
					item: invoice.rule.name,
					hsn: invoice.rule.code,
					qty: '1',
					rate: money(invoice.taxableINR),
					taxable: money(invoice.taxableINR),
					tax: money(invoice.taxINR),
				},
			},
		],
		totals: {
			totals: [
				{ label: 'Taxable value', value: money(invoice.taxableINR) },
				{ label: `${taxLabel} (reverse charge)`, value: money(invoice.taxINR) },
				{ label: 'Total', value: money(invoice.totalINR) },
			],
		},
	};
}

/** D3, D4 print (Rule 52): who was paid, how, against what; the reverse-charge tax where it applies. */
export function paymentVoucherData(voucher: PaymentVoucher, seller: { name: string; lines: string[] }): DocumentData {
	return {
		doc: 'paymentVoucher',
		title: 'Payment voucher',
		number: voucher.number,
		date: longDate(voucher.date),
		seller,
		values: {
			voucherNo: voucher.number,
			date: longDate(voucher.date),
			against: voucher.against.number,
			amount: money(voucher.amountINR),
			method: PAYMENT_MODE_WORDS[voucher.mode],
			reference: voucher.reference ?? '',
			rcmTax:
				voucher.reverseChargeTaxINR === null
					? ''
					: `${money(voucher.reverseChargeTaxINR)} paid by us under reverse charge`,
			amountInWords: rupeesInWords(voucher.amountINR),
		},
		parties: {
			payee: { heading: 'Paid to', lines: [voucher.payeeName, voucher.payeeAddress].filter(Boolean) },
		},
	};
}
