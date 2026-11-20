import { z } from 'zod';

import { PhoneNumber, PhoneNumberInput, SavedAddressRow, SavedAddressWrite } from './address-book';
import { Id, IsoDateTime, PriceINR } from './common';
import { GstStateCode, Gstin, Pan } from './gst';
import { IsoDate, Supplier, SupplierWrite } from './purchasing';

/**
 * Businesses: customers and suppliers as companies in one record (owner, 2026-11-20; brief bz01–bz06,
 * so01–so04). The supplier record of the purchases module IS the business record: a business that
 * sells to us has the supplier role (the supplier fields, unchanged), one that buys from us has the
 * customer role (zone, credit limit, credit days, standing), and one can have both.
 *
 * Each side keeps its own account (concern K5): what they owe us (receivable) and what we owe them
 * (payable) are never netted automatically. Other businesses may allow a set-off between the two
 * accounts, only under a written agreement (a standing one or a one-off); Saha Textile keeps it off.
 */

export const BusinessType = z.enum([
	'proprietorship',
	'partnership',
	'llp',
	'privateLimited',
	'publicLimited',
	'huf',
	'trustOrSociety',
	'government',
	'other',
]);
export type BusinessType = z.infer<typeof BusinessType>;

/** Active · credit on hold (orders only when paid) · blocked (no new orders). */
export const BusinessStanding = z.enum(['active', 'creditOnHold', 'blocked']);
export type BusinessStanding = z.infer<typeof BusinessStanding>;

export const BusinessContact = z.object({
	id: Id,
	name: z.string().trim().min(1).max(120),
	role: z.string().trim().max(80).default(''),
	email: z.string().trim().email().nullable().default(null),
	mobile: PhoneNumber.nullable().default(null),
	/** The accounts contact gets payment links and statements. One per business. */
	isAccounts: z.boolean().default(false),
});
export type BusinessContact = z.infer<typeof BusinessContact>;

export const BusinessContactWrite = BusinessContact.omit({ id: true, mobile: true }).extend({
	id: Id.optional(),
	mobile: PhoneNumberInput.nullable().default(null),
});
export type BusinessContactWrite = z.infer<typeof BusinessContactWrite>;

/** The customer side: zone, credit and standing. */
export const BusinessCustomerRole = z.object({
	zoneId: Id,
	creditLimitINR: PriceINR.default(0),
	creditDays: z.number().int().min(0).max(365).default(0),
	standing: BusinessStanding.default('active'),
	standingReason: z.string().max(500).nullable().default(null),
	standingBy: z.string().nullable().default(null),
	standingAt: IsoDateTime.nullable().default(null),
});
export type BusinessCustomerRole = z.infer<typeof BusinessCustomerRole>;

/** Set-off between the two accounts: never, or under a standing written agreement. */
export const SetOffSetting = z.discriminatedUnion('mode', [
	z.object({ mode: z.literal('never') }),
	z.object({
		mode: z.literal('agreement'),
		reference: z.string().trim().min(1).max(80),
		signedOn: IsoDate,
		validUntil: IsoDate.nullable().default(null),
		/** The signed copy, from Media. */
		mediaId: Id,
	}),
]);
export type SetOffSetting = z.infer<typeof SetOffSetting>;

export const Business = z.object({
	id: Id,
	legalName: z.string(),
	tradeName: z.string().default(''),
	businessType: BusinessType.default('other'),
	gstin: z.string().nullable(),
	pan: z.string().nullable(),
	stateCode: z.string(),
	stateName: z.string(),
	/** The registered address the supplier form keeps (line, city, PIN). */
	registeredAddress: Supplier.shape.address,
	/** Billing and delivery addresses for its orders, with the same rules as a customer's. */
	addresses: z.array(SavedAddressRow).default([]),
	contacts: z.array(BusinessContact).default([]),
	roles: z.object({
		/** Sells to us: the supplier fields stay on the record as the purchases module reads them. */
		supplier: z.boolean(),
		/** Buys from us. */
		customer: BusinessCustomerRole.nullable(),
	}),
	setOff: SetOffSetting.default({ mode: 'never' }),
	active: z.boolean(),
	notes: z.string().nullable(),
	revision: z.number().int().nonnegative().default(0),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
});
export type Business = z.infer<typeof Business>;

/** The business form (bz02): the supplier fields plus the customer side, contacts and addresses. */
export const BusinessWrite = z
	.object({
		legalName: SupplierWrite.shape.legalName,
		tradeName: z.string().trim().max(80).default(''),
		businessType: BusinessType,
		kind: SupplierWrite.shape.kind,
		gstin: Gstin.nullable().default(null),
		pan: Pan.nullable().default(null),
		stateCode: GstStateCode,
		registeredAddress: SupplierWrite.shape.address,
		contacts: z.array(BusinessContactWrite).max(20).default([]),
		sellsToUs: z.boolean(),
		/** Present when the business buys from us. */
		customer: z
			.object({
				zoneId: Id,
				creditLimitINR: PriceINR.max(100_000_000),
				creditDays: z.number().int().min(0).max(365),
			})
			.nullable(),
		/** Supplier fields (only read when `sellsToUs`). */
		supplier: z
			.object({
				paymentTermsDays: z.number().int().min(0).max(365),
				usesItemCodes: z.boolean().default(false),
			})
			.nullable()
			.default(null),
		notes: z.string().trim().max(1000).nullable().default(null),
		active: z.boolean().default(true),
		revision: z.number().int().nonnegative().optional(),
	})
	.superRefine((value, ctx) => {
		if (value.kind !== 'unregistered' && !value.gstin) {
			ctx.addIssue({ code: 'custom', path: ['gstin'], message: 'gstin_required' });
		}
		if (value.gstin && value.gstin.slice(0, 2) !== value.stateCode) {
			ctx.addIssue({ code: 'custom', path: ['stateCode'], message: 'state_differs_from_gstin' });
		}
		if (!value.sellsToUs && !value.customer) {
			ctx.addIssue({ code: 'custom', path: ['customer'], message: 'needs_a_role' });
		}
		if (value.sellsToUs && !value.supplier) {
			ctx.addIssue({ code: 'custom', path: ['supplier'], message: 'supplier_fields_required' });
		}
		if (value.contacts.filter((contact) => contact.isAccounts).length > 1) {
			ctx.addIssue({ code: 'custom', path: ['contacts'], message: 'one_accounts_contact' });
		}
	});
export type BusinessWrite = z.infer<typeof BusinessWrite>;

export const BusinessAddressWrite = SavedAddressWrite;
export type BusinessAddressWrite = z.infer<typeof BusinessAddressWrite>;

export const BusinessStandingWrite = z.object({
	standing: BusinessStanding,
	reason: z.string().trim().min(3).max(500),
});
export type BusinessStandingWrite = z.infer<typeof BusinessStandingWrite>;

export const BusinessZoneWrite = z.object({ zoneId: Id });
export type BusinessZoneWrite = z.infer<typeof BusinessZoneWrite>;

export const SetOffSettingWrite = SetOffSetting;
export type SetOffSettingWrite = z.infer<typeof SetOffSettingWrite>;

/* ---------------------------------------------------------------------------------------------- */
/* The two accounts                                                                                */
/* ---------------------------------------------------------------------------------------------- */

export const LedgerSide = z.enum(['receivable', 'payable']);
export type LedgerSide = z.infer<typeof LedgerSide>;

export const LedgerEntryKind = z.enum([
	'orderOnAccount',
	'invoice',
	'receipt',
	'creditNote',
	'debitNote',
	'purchaseEntry',
	'purchasePayment',
	'purchaseReturn',
	'openingBalance',
	'setOff',
	'reversal',
]);
export type LedgerEntryKind = z.infer<typeof LedgerEntryKind>;

/**
 * One entry in a business's account. On the receivable side a positive amount is owed to us; on the
 * payable side a positive amount is owed by us. Entries are never edited or deleted: a mistake is
 * undone by a reversing entry with its own reason.
 */
export const LedgerEntry = z.object({
	id: Id,
	businessId: Id,
	side: LedgerSide,
	kind: LedgerEntryKind,
	amountINR: z.number().finite(),
	/** The order, receipt, purchase entry or journal this entry comes from. */
	documentType: z.string(),
	documentId: Id,
	documentNumber: z.string().nullable().default(null),
	/** When it falls due (orders on account: the order date plus credit days). */
	dueOn: IsoDate.nullable().default(null),
	note: z.string().max(500).nullable().default(null),
	reversalOf: Id.nullable().default(null),
	/** A one-off set-off's own signed agreement (a standing one lives on the business). */
	agreement: z.object({ reference: z.string(), signedOn: IsoDate, mediaId: Id }).nullable().default(null),
	at: IsoDateTime,
	by: z.string(),
});
export type LedgerEntry = z.infer<typeof LedgerEntry>;

export const LedgerQuery = z.object({
	side: LedgerSide,
	from: IsoDate.optional(),
	to: IsoDate.optional(),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type LedgerQuery = z.infer<typeof LedgerQuery>;

export const LedgerStatementRow = LedgerEntry.extend({ balanceINR: z.number().finite() });
export type LedgerStatementRow = z.infer<typeof LedgerStatementRow>;

export const LedgerStatement = z.object({
	side: LedgerSide,
	openingINR: z.number().finite(),
	rows: z.array(LedgerStatementRow),
	closingINR: z.number().finite(),
	total: z.number().int().nonnegative(),
});
export type LedgerStatement = z.infer<typeof LedgerStatement>;

/** A receipt on account (bz06): it settles the oldest open orders first unless split by hand. */
export const BusinessReceiptWrite = z.object({
	method: z.enum(['upi', 'bankTransfer', 'cash', 'cheque']),
	amountINR: PriceINR.positive().max(100_000_000),
	reference: z.string().trim().min(1).max(80),
	receivedOn: IsoDate,
	note: z.string().trim().max(500).nullable().default(null),
	/** Empty: oldest first. Otherwise the amount set against each order. */
	allocations: z
		.array(z.object({ orderId: Id, amountINR: PriceINR.positive() }))
		.max(200)
		.default([]),
});
export type BusinessReceiptWrite = z.infer<typeof BusinessReceiptWrite>;

/** An order the business has on account and not settled, for the receipt's "Settles" table (bz06). */
export const BusinessOpenOrder = z.object({
	orderId: Id,
	orderNumber: z.string(),
	placedAt: IsoDateTime,
	dueOn: IsoDate.nullable(),
	dueINR: PriceINR,
});
export type BusinessOpenOrder = z.infer<typeof BusinessOpenOrder>;

/** A set-off entry (so02, so03): at most the smaller balance; shown in both accounts as one journal. */
export const SetOffWrite = z.object({
	amountINR: PriceINR.positive(),
	/** Under the standing agreement, or a one-off with its own signed copy. */
	basis: z.discriminatedUnion('kind', [
		z.object({ kind: z.literal('standingAgreement') }),
		z.object({
			kind: z.literal('oneOff'),
			reference: z.string().trim().min(1).max(80),
			signedOn: IsoDate,
			mediaId: Id,
		}),
	]),
	note: z.string().trim().min(3).max(500),
	/** The day of the entry (so02); today when left out. */
	on: IsoDate.nullable().default(null),
});
export type SetOffWrite = z.infer<typeof SetOffWrite>;

export const SetOffReverseWrite = z.object({ reason: z.string().trim().min(3).max(500) });
export type SetOffReverseWrite = z.infer<typeof SetOffReverseWrite>;

/* ---------------------------------------------------------------------------------------------- */
/* Lists                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

export const BusinessListQuery = z.object({
	q: z.string().trim().max(100).optional(),
	role: z.enum(['all', 'customer', 'supplier', 'both']).default('all'),
	standing: BusinessStanding.optional(),
	zoneId: Id.optional(),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(15),
});
export type BusinessListQuery = z.infer<typeof BusinessListQuery>;

export const BusinessListRow = z.object({
	id: Id,
	legalName: z.string(),
	tradeName: z.string(),
	gstin: z.string().nullable(),
	stateName: z.string(),
	sellsToUs: z.boolean(),
	buysFromUs: z.boolean(),
	zone: z.object({ id: Id, code: z.string(), name: z.string() }).nullable(),
	creditLimitINR: PriceINR.nullable(),
	creditUsedINR: PriceINR.nullable(),
	/** What they owe us (receivable balance). */
	owesUsINR: z.number().finite(),
	/** What we owe them (payable balance). */
	weOweINR: z.number().finite(),
	standing: BusinessStanding.nullable(),
	active: z.boolean(),
});
export type BusinessListRow = z.infer<typeof BusinessListRow>;

export const BusinessListResponse = z.object({
	items: z.array(BusinessListRow),
	total: z.number().int().nonnegative(),
	counts: z.object({
		all: z.number().int(),
		customer: z.number().int(),
		supplier: z.number().int(),
		both: z.number().int(),
		creditOnHold: z.number().int().default(0),
		blocked: z.number().int().default(0),
	}),
});
export type BusinessListResponse = z.infer<typeof BusinessListResponse>;

/** The business picker on Create order: found by name, phone or GSTIN (owner, 2026-11-20). */
export const BuyerSearchQuery = z.object({
	q: z.string().trim().min(1).max(100),
	limit: z.coerce.number().int().min(1).max(25).default(10),
});
export type BuyerSearchQuery = z.infer<typeof BuyerSearchQuery>;

export const BusinessBuyerOption = z.object({
	id: Id,
	legalName: z.string(),
	tradeName: z.string(),
	gstin: z.string().nullable(),
	phone: z.string().nullable(),
	zone: z.object({ id: Id, code: z.string(), name: z.string() }),
	standing: BusinessStanding,
	creditLimitINR: PriceINR,
	/** Limit less what they owe us on account. */
	creditAvailableINR: z.number().finite(),
	creditDays: z.number().int().nonnegative(),
	standingReason: z.string().nullable(),
	standingBy: z.string().nullable(),
	/** When the standing was last changed: "Credit on hold since 12 Nov" (ck08). */
	standingAt: IsoDateTime.nullable().default(null),
});
export type BusinessBuyerOption = z.infer<typeof BusinessBuyerOption>;

export const CustomerBuyerOption = z.object({
	id: Id,
	name: z.string(),
	email: z.string().nullable(),
	phone: z.string().nullable(),
	addressCount: z.number().int().nonnegative(),
});
export type CustomerBuyerOption = z.infer<typeof CustomerBuyerOption>;
