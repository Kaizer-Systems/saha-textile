import type { TaxInvoice } from '@saha-textile/contracts';

import type { EDocLine, EDocParty, EDocSale, GovSupplyType } from '../edocs/edoc-rules';

const paise = (inr: number): number => Math.round(inr * 100);
const rupees = (p: number): number => p / 100;

/** The services code for delivery charged on an invoice (courier services, SAC 996812). */
export const DELIVERY_SAC = '996812';

/**
 * A tax invoice as the government's e-invoice sees it (accounts brief D1 + addendum 2): the same lines, numbers and
 * totals, so the IRN is for exactly the invoice we printed. Prices on our invoices include GST, so each line sends
 * its taxable value as the unit price times quantity. Delivery, when the invoice charges it, is one service line at
 * the tax the invoice put on it (the difference between the invoice's totals and its goods lines).
 */
export function saleFromTaxInvoice(
	invoice: TaxInvoice,
	parties: { seller: EDocParty; buyer: EDocParty; shipTo?: EDocParty | null; dispatchFrom?: EDocParty | null },
): EDocSale {
	const lines: EDocLine[] = invoice.lines.map((line) => ({
		description: line.title.slice(0, 300),
		hsn: line.hsn,
		isService: false,
		qty: line.quantity,
		unit: line.unit === 'MTR' ? 'm' : 'pc',
		unitPriceINR: line.quantity > 0 ? rupees(Math.round(paise(line.taxableINR) / line.quantity)) : 0,
		grossINR: line.taxableINR,
		discountINR: 0,
		taxableINR: line.taxableINR,
		gstRatePercent: line.ratePercent,
		igstINR: line.igstINR,
		cgstINR: line.cgstINR,
		sgstINR: line.sgstINR,
		cessINR: 0,
		totalINR: line.totalINR,
	}));
	if (invoice.shippingINR > 0) {
		const sum = (pick: (l: EDocLine) => number) => lines.reduce((s, l) => s + paise(pick(l)), 0);
		const taxable = paise(invoice.taxableINR) - sum((l) => l.taxableINR);
		const cgst = paise(invoice.cgstINR) - sum((l) => l.cgstINR);
		const sgst = paise(invoice.sgstINR) - sum((l) => l.sgstINR);
		const igst = paise(invoice.igstINR) - sum((l) => l.igstINR);
		const rate = Math.max(0, ...invoice.lines.map((l) => l.ratePercent));
		lines.push({
			description: 'Delivery charges',
			hsn: DELIVERY_SAC,
			isService: true,
			qty: 1,
			unit: 'pc',
			unitPriceINR: rupees(taxable),
			grossINR: rupees(taxable),
			discountINR: 0,
			taxableINR: rupees(taxable),
			gstRatePercent: rate,
			igstINR: rupees(igst),
			cgstINR: rupees(cgst),
			sgstINR: rupees(sgst),
			cessINR: 0,
			totalINR: rupees(taxable + cgst + sgst + igst),
		});
	}
	const supplyType: GovSupplyType = invoice.placeOfSupply === '96' ? 'EXPWOP' : 'B2B';
	return {
		documentType: 'taxInvoice',
		number: invoice.number,
		date: invoice.date,
		seller: parties.seller,
		buyer: parties.buyer,
		placeOfSupply: invoice.placeOfSupply,
		shipTo: parties.shipTo ?? null,
		dispatchFrom: parties.dispatchFrom ?? null,
		supplyType,
		reverseCharge: false,
		lines,
		totals: {
			taxableINR: invoice.taxableINR,
			cgstINR: invoice.cgstINR,
			sgstINR: invoice.sgstINR,
			igstINR: invoice.igstINR,
			cessINR: 0,
			discountINR: 0,
			otherINR: 0,
			roundOffINR: invoice.roundOffINR,
			totalINR: invoice.totalINR,
		},
	};
}
