import { z } from 'zod';

import { TemplateCode } from './accounts-templates';
import { Id, IsoDateTime, PriceINR } from './common';
import { RoleKey } from './ledger';
import { IsoDate, PaymentMode } from './purchasing';

/**
 * Reverse charge (accounts brief D, Rules 47A and 52): something bought from a supplier without a GSTIN on which we pay
 * the GST ourselves. A self-invoice is made within 30 days of receiving it, and each payment to the supplier gets a
 * payment voucher. The "What" list is the reverse-charge rule set (template RS-RCM), filtered by the kind of company
 * and the day the supply was received; a self-invoice keeps a copy of the rule it was made with.
 */

export const SelfInvoiceStatus = z.enum(['draft', 'issued', 'cancelled']);
export type SelfInvoiceStatus = z.infer<typeof SelfInvoiceStatus>;

/** One entry of the reverse-charge list, as offered on the form and copied onto the self-invoice. */
export const RcmChoice = z.object({
	/** The rule set and version it came from. */
	templateCode: TemplateCode,
	templateVersion: z.number().int().positive(),
	key: z.string(),
	name: z.string(),
	/** SAC. */
	code: z.string(),
	ratePercent: z.number().min(0).max(100),
	/** The role of the expense ledger it posts to. */
	expenseRole: RoleKey,
	source: z.string(),
});
export type RcmChoice = z.infer<typeof RcmChoice>;

export const SelfInvoice = z.object({
	id: Id,
	/** SI/26-27/000002 once issued. */
	number: z.string().nullable(),
	status: SelfInvoiceStatus,
	supplierId: Id,
	supplierName: z.string(),
	supplierAddress: z.string(),
	supplierStateCode: z.string(),
	rule: RcmChoice,
	/** The month the supply is for (YYYY-MM). */
	forMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
	receivedOn: IsoDate,
	/** The day it was issued. */
	date: IsoDate.nullable(),
	locationId: Id,
	gstRegistrationId: Id.nullable(),
	/** Our State (place of supply), as its two-digit code. */
	placeOfSupply: z.string(),
	interState: z.boolean(),
	taxableINR: PriceINR,
	cgstINR: PriceINR,
	sgstINR: PriceINR,
	igstINR: PriceINR,
	taxINR: PriceINR,
	totalINR: PriceINR,
	paidINR: PriceINR,
	/** The payment vouchers issued with its payments (A7's Paid column). */
	paymentVouchers: z.array(z.object({ id: Id, number: z.string() })).default([]),
	/** Issued after the 30 days of Rule 47A. */
	late: z.boolean(),
	journalVoucherId: Id.nullable(),
	cancelReason: z.string().nullable(),
	version: z.number().int().nonnegative(),
	createdAt: IsoDateTime,
	createdBy: Id.nullable(),
	updatedAt: IsoDateTime,
	updatedBy: Id.nullable(),
	issuedAt: IsoDateTime.nullable(),
	issuedBy: Id.nullable(),
	cancelledAt: IsoDateTime.nullable(),
	cancelledBy: Id.nullable(),
});
export type SelfInvoice = z.infer<typeof SelfInvoice>;

/** D2: the reverse-charge supply form. */
export const SelfInvoiceWrite = z.object({
	supplierId: Id,
	/** The reverse-charge list entry ("What"). */
	ruleKey: z.string().min(1),
	forMonth: SelfInvoice.shape.forMonth,
	receivedOn: IsoDate,
	taxableINR: PriceINR.refine((value) => value > 0, { message: 'amount_positive' }),
	/** The version the form was opened on; null for a new one. */
	version: z.number().int().nonnegative().nullable().default(null),
});
export type SelfInvoiceWrite = z.infer<typeof SelfInvoiceWrite>;

export const SelfInvoiceFormQuery = z.object({ receivedOn: IsoDate });
export type SelfInvoiceFormQuery = z.infer<typeof SelfInvoiceFormQuery>;

/** What the D2 form offers: suppliers without a GSTIN, and the reverse-charge list for the day received. */
export const SelfInvoiceForm = z.object({
	suppliers: z.array(z.object({ id: Id, name: z.string(), stateCode: z.string() })),
	choices: z.array(RcmChoice),
	/** Our State, for the place of supply. */
	placeOfSupply: z.string(),
});
export type SelfInvoiceForm = z.infer<typeof SelfInvoiceForm>;

/** Issue a draft: the version the page shows. */
export const SelfInvoiceIssue = z.object({ version: z.number().int().nonnegative() });
export type SelfInvoiceIssue = z.infer<typeof SelfInvoiceIssue>;

export const SelfInvoiceCancel = z.object({
	reason: z.string().trim().min(3).max(300),
	version: z.number().int().nonnegative(),
});
export type SelfInvoiceCancel = z.infer<typeof SelfInvoiceCancel>;

/** D3: pay the supplier of a self-invoice; a payment voucher is issued with it (Rule 52). */
export const SelfInvoicePayWrite = z.object({
	amountINR: PriceINR.refine((value) => value > 0, { message: 'amount_positive' }),
	paidOn: IsoDate,
	mode: PaymentMode,
	reference: z.string().trim().max(80).nullable().default(null),
	/** The bank ledger paid from, when the books have more than one; cash uses the cash ledger. */
	paidFromLedgerId: Id.nullable().default(null),
	version: z.number().int().nonnegative(),
});
export type SelfInvoicePayWrite = z.infer<typeof SelfInvoicePayWrite>;

export const PaymentVoucherAgainst = z.object({
	kind: z.enum(['selfInvoice', 'purchaseEntry']),
	id: Id,
	number: z.string(),
	/** What it paid for, as A6's Against column shows it ("shop rent"). */
	detail: z.string().default(''),
});
export type PaymentVoucherAgainst = z.infer<typeof PaymentVoucherAgainst>;

/** A payment voucher (decision D5): every payment to a supplier gets one, with the reverse-charge block where it applies. */
export const PaymentVoucher = z.object({
	id: Id,
	/** PV/26-27/000007. */
	number: z.string().min(1),
	date: IsoDate,
	supplierId: Id,
	payeeName: z.string(),
	payeeAddress: z.string(),
	against: PaymentVoucherAgainst,
	amountINR: PriceINR,
	mode: PaymentMode,
	reference: z.string().nullable(),
	paidFromLedgerId: Id.nullable(),
	/** Reverse charge only: the tax we pay on this supply ourselves. */
	reverseChargeTaxINR: PriceINR.nullable(),
	/** Purchase entries: the supplier payment the purchases page recorded. */
	supplierPaymentId: Id.nullable(),
	journalVoucherId: Id.nullable(),
	locationId: Id.nullable(),
	createdAt: IsoDateTime,
	createdBy: Id.nullable(),
});
export type PaymentVoucher = z.infer<typeof PaymentVoucher>;

const ListPaging = {
	from: IsoDate,
	to: IsoDate,
	search: z.string().trim().max(80).default(''),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(25),
};

/** A7's chips: drafts, those still inside the 30 days, issued and not fully paid, paid. */
export const SelfInvoiceListFilter = z.enum(['all', 'drafts', 'due_soon', 'unpaid', 'paid']);
export type SelfInvoiceListFilter = z.infer<typeof SelfInvoiceListFilter>;

/** Accounts › Self-invoices (A7): by the day received, with a search over number, supplier and what. */
export const SelfInvoiceListQuery = z.object({ ...ListPaging, filter: SelfInvoiceListFilter.default('all') });
export type SelfInvoiceListQuery = z.infer<typeof SelfInvoiceListQuery>;

export const SelfInvoiceList = z.object({
	items: z.array(SelfInvoice),
	total: z.number().int().nonnegative(),
	counts: z.record(SelfInvoiceListFilter, z.number().int().nonnegative()),
});
export type SelfInvoiceList = z.infer<typeof SelfInvoiceList>;

/** A6's chips: reverse charge (against a self-invoice), supplier bills (against a purchase entry), cancelled. */
export const PaymentVoucherListFilter = z.enum(['all', 'reverse_charge', 'supplier_bills', 'cancelled']);
export type PaymentVoucherListFilter = z.infer<typeof PaymentVoucherListFilter>;

/** Accounts › Payment vouchers (A6): by date, with a search over number, payee, what it paid and reference. */
export const PaymentVoucherListQuery = z.object({ ...ListPaging, filter: PaymentVoucherListFilter.default('all') });
export type PaymentVoucherListQuery = z.infer<typeof PaymentVoucherListQuery>;

export const PaymentVoucherList = z.object({
	items: z.array(PaymentVoucher),
	total: z.number().int().nonnegative(),
	counts: z.record(PaymentVoucherListFilter, z.number().int().nonnegative()),
});
export type PaymentVoucherList = z.infer<typeof PaymentVoucherList>;
