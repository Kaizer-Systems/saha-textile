import { z } from 'zod';

import { Id, IsoDateTime } from './common';
import { Gstin, GstStateCode, Pan } from './gst';
import { IsoDate } from './purchasing';

/**
 * Company setup (accounts brief sections J and CT, addendum AD4–AD6; owner-approved 2026-11-23).
 * One business per deployment. The kind of business picks the chart of accounts, the statement
 * format, the depreciation books and how owners are paid. Public limited is not offered (owner:
 * "don't go for public limited because we are not going that big of a scale").
 */
export const BusinessKind = z.enum(['proprietorship', 'partnership', 'llp', 'private_limited_opc', 'private_limited']);
export type BusinessKind = z.infer<typeof BusinessKind>;
export const BUSINESS_KINDS = BusinessKind.options;

const Money = z.number().nonnegative().max(1e12);
const Percent = z.number().min(0).max(100);
const Name = z.string().trim().min(1).max(200);
/** Director Identification Number or Designated Partner Identification Number: 8 digits. */
export const Din = z
	.string()
	.trim()
	.regex(/^\d{8}$/, { message: 'din_shape' });
/** Udyam registration number, e.g. UDYAM-WB-10-0000000. */
export const UdyamNumber = z
	.string()
	.trim()
	.regex(/^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/, { message: 'udyam_shape' });
/** Company Identification Number (21 characters). */
export const Cin = z
	.string()
	.trim()
	.regex(/^[UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/, { message: 'cin_shape' });
/** LLP Identification Number, e.g. AAA-0000. */
export const Llpin = z
	.string()
	.trim()
	.regex(/^[A-Z]{3}-\d{4}$/, { message: 'llpin_shape' });
/** Tax deduction account number: 4 letters, 5 digits, 1 letter. */
export const Tan = z
	.string()
	.trim()
	.regex(/^[A-Z]{4}\d{5}[A-Z]$/, { message: 'tan_shape' });

export const Proprietor = z.object({ name: Name, pan: Pan, openingCapitalINR: Money.default(0) });
export type Proprietor = z.infer<typeof Proprietor>;

/** A proprietor's other business under the same PAN: here as a location, or its own deployment. */
export const OtherBusiness = z.object({
	tradeName: Name,
	gstin: Gstin.nullable().default(null),
	runsAs: z.enum(['own_deployment', 'location_here']),
});
export type OtherBusiness = z.infer<typeof OtherBusiness>;

/** How a working partner's remuneration is set in the deed (brief 25 YC2): a fixed sum a month, a % of book profit, or none. */
export const RemunerationBasis = z.enum(['monthly', 'percent_of_book_profit', 'none']);
export type RemunerationBasis = z.infer<typeof RemunerationBasis>;

/** Interest on capital worked on each day's capital (money brought in or taken out counts from the next day), or on the year's opening capital only. */
export const InterestBasis = z.enum(['daily', 'opening']);
export type InterestBasis = z.infer<typeof InterestBasis>;

export const Partner = z.object({
	id: Id,
	name: Name,
	pan: Pan,
	/** A working partner may be paid remuneration (Income Tax s.40(b)). */
	working: z.boolean().default(true),
	capitalINR: Money.default(0),
	profitSharePercent: Percent,
	/** At most 12% is allowed as a deduction (s.40(b)); more can be agreed but is disallowed for tax. */
	interestOnCapitalPercent: Percent.default(0),
	monthlyRemunerationINR: Money.default(0),
	remunerationBasis: RemunerationBasis.default('monthly'),
	/** With `percent_of_book_profit`: the partner's % of the year's book profit (s.40(b) meaning). */
	remunerationPercent: Percent.default(0),
	/** LLP only: designated partner and their DPIN. */
	designated: z.boolean().default(false),
	dpin: Din.nullable().default(null),
});
export type Partner = z.infer<typeof Partner>;

/** One partner's terms under a deed: what the year's sharing reads (YC2, YC3). */
export const DeedTerm = Partner.pick({
	id: true,
	name: true,
	working: true,
	profitSharePercent: true,
	interestOnCapitalPercent: true,
	monthlyRemunerationINR: true,
	remunerationBasis: true,
	remunerationPercent: true,
});
export type DeedTerm = z.infer<typeof DeedTerm>;

/** An earlier deed, kept when a new one starts ("A new deed from a date"): it ruled from `from` (null: from the start) to `to`. */
export const PartnerDeed = z.object({
	from: IsoDate.nullable(),
	to: IsoDate,
	interestBasis: InterestBasis,
	lossYearCharges: z.boolean(),
	partners: z.array(DeedTerm).max(50),
});
export type PartnerDeed = z.infer<typeof PartnerDeed>;

export const Director = z.object({
	id: Id,
	name: Name,
	din: Din,
	since: IsoDate,
	paidAs: z.enum(['remuneration', 'sitting_fees', 'none']).default('none'),
});
export type Director = z.infer<typeof Director>;

export const Shareholder = z.object({ id: Id, name: Name, shares: z.number().int().positive() });
export type Shareholder = z.infer<typeof Shareholder>;

export const CompanyProfile = z.object({
	kind: BusinessKind.default('private_limited'),
	legalName: z.string().trim().max(200).default(''),
	tradeName: z.string().trim().max(200).default(''),
	pan: Pan.nullable().default(null),
	tan: Tan.nullable().default(null),
	cin: Cin.nullable().default(null),
	llpin: Llpin.nullable().default(null),
	udyam: UdyamNumber.nullable().default(null),
	/** 4 = April, the Indian financial year. */
	financialYearStartMonth: z.number().int().min(1).max(12).default(4),
	booksStartOn: IsoDate.nullable().default(null),
	homeCurrency: z.literal('INR').default('INR'),
	proprietor: Proprietor.nullable().default(null),
	otherBusinesses: z.array(OtherBusiness).max(50).default([]),
	partners: z.array(Partner).max(50).default([]),
	partnersCapital: z.enum(['fixed_with_current', 'fluctuating']).default('fixed_with_current'),
	/** The partners' terms above are the deed in force from this day (null: from the start of the books). */
	deedFrom: IsoDate.nullable().default(null),
	interestBasis: InterestBasis.default('daily'),
	/** Whether the deed pays interest on capital and remuneration in a year of loss too. */
	lossYearCharges: z.boolean().default(false),
	/** Deeds that ruled before `deedFrom`, oldest first. */
	earlierDeeds: z.array(PartnerDeed).max(50).default([]),
	directors: z.array(Director).max(50).default([]),
	shareholders: z.array(Shareholder).max(500).default([]),
	authorisedCapitalINR: Money.default(0),
	paidUpCapitalINR: Money.default(0),
	faceValueINR: Money.default(10),
	/** One-person company only. */
	nomineeName: z.string().trim().max(200).nullable().default(null),
	revision: z.number().int().nonnegative().default(0),
	updatedAt: IsoDateTime.nullable().default(null),
	updatedBy: Id.nullable().default(null),
});
export type CompanyProfile = z.infer<typeof CompanyProfile>;
export const CompanyProfileWrite = CompanyProfile.omit({ updatedAt: true, updatedBy: true });
export type CompanyProfileWrite = z.infer<typeof CompanyProfileWrite>;

export const CompanyProfileSave = z.object({ profile: CompanyProfileWrite, expectedUpdatedAt: z.string().nullable() });
export type CompanyProfileSave = z.infer<typeof CompanyProfileSave>;

/** GST taxpayer kinds the software handles (addendum G1, G2; ISD for shared costs, AD8). */
export const GstTaxpayerKind = z.enum(['regular', 'composition', 'isd', 'casual']);
export type GstTaxpayerKind = z.infer<typeof GstTaxpayerKind>;
/** Monthly returns, or quarterly under QRMP (turnover up to ₹5 crore). */
export const GstReturnScheme = z.enum(['monthly', 'qrmp']);
export type GstReturnScheme = z.infer<typeof GstReturnScheme>;

/** One dated setting of a registration: a change applies from its date, earlier periods keep theirs. */
export const GstRegistrationTerms = z.object({
	from: IsoDate,
	kind: GstTaxpayerKind,
	scheme: GstReturnScheme,
	/** Composition only: % of turnover paid from the business's own pocket (1% for traders). */
	compositionRatePercent: Percent.nullable().default(null),
	/** Last financial year's aggregate turnover, as confirmed by the owner or the CA. */
	lastYearTurnoverINR: Money.default(0),
	/** Confirmed by the owner or the CA, worked out from turnover each April (AD6). */
	eInvoice: z.boolean().default(false),
	/** Report each e-invoice within 30 days (turnover of ₹10 crore and more). */
	eInvoiceThirtyDays: z.boolean().default(false),
	annualReturn: z.boolean().default(true),
	reconciliationStatement: z.boolean().default(false),
	hsnDigits: z.union([z.literal(4), z.literal(6)]).default(4),
});
export type GstRegistrationTerms = z.infer<typeof GstRegistrationTerms>;

export const GstRegistration = z.object({
	id: Id,
	gstin: Gstin,
	stateCode: GstStateCode,
	legalName: z.string().trim().max(200).default(''),
	tradeName: z.string().trim().max(200).default(''),
	/** Newest first; never edited once a period under them is filed (a change adds a version). */
	terms: z.array(GstRegistrationTerms).min(1),
	active: z.boolean().default(true),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
});
export type GstRegistration = z.infer<typeof GstRegistration>;

export const GstRegistrationWrite = z.object({
	gstin: Gstin,
	legalName: z.string().trim().max(200).default(''),
	tradeName: z.string().trim().max(200).default(''),
	terms: GstRegistrationTerms,
	active: z.boolean().default(true),
});
export type GstRegistrationWrite = z.infer<typeof GstRegistrationWrite>;

/** Feature switches (section J3). Off: screens, menus and report columns hide, and nothing posts. */
export const FeatureKey = z.enum([
	'locations',
	'stores',
	'exports',
	'business_accounts',
	'paypal',
	'cash_on_delivery',
	'reverse_charge',
	'fixed_assets',
	'payroll',
	'pf',
	'esi',
	'bonus',
	'gratuity',
	'lwf',
	'tds',
	'budgets',
	/** Tax invoices issued when goods leave (accounts brief D1, D3); off until the CA confirms the rates. */
	'tax_invoices',
]);
export type FeatureKey = z.infer<typeof FeatureKey>;
export const FEATURE_KEYS = FeatureKey.options;

export const FeatureSwitches = z.object({
	on: z.partialRecord(FeatureKey, z.boolean()).default({}),
	revision: z.number().int().nonnegative().default(0),
	updatedAt: IsoDateTime.nullable().default(null),
	updatedBy: Id.nullable().default(null),
});
export type FeatureSwitches = z.infer<typeof FeatureSwitches>;

export const FeatureSwitchesSave = z.object({
	on: z.partialRecord(FeatureKey, z.boolean()),
	expectedUpdatedAt: z.string().nullable(),
});
export type FeatureSwitchesSave = z.infer<typeof FeatureSwitchesSave>;

/** A switch as Settings › Features shows it: on or off, and how many records use it. */
export const FeatureRow = z.object({
	key: FeatureKey,
	on: z.boolean(),
	inUse: z.number().int().nonnegative(),
	/** Switches that must be on first (Stores needs Locations; PF needs Payroll). */
	needs: z.array(FeatureKey),
});
export type FeatureRow = z.infer<typeof FeatureRow>;
