import { z } from 'zod';

import { IsoDateTime } from './common';

/**
 * Document numbers across the system (`DEC-NUMBERING`; the brief's table accepted by the owner on
 * 2026-11-20 for every row except the order number).
 *
 * - GST documents follow Rule 46: one series per type, at most 16 characters, letters, digits, "-"
 *   and "/", unique in the financial year, consecutive. The year in the number makes the 1 April
 *   restart safe.
 * - A number is given only when the document is final, inside the same save, so drafts and failed
 *   saves never use one up. A cancelled document keeps its number.
 * - Every format is a setting, checked when set: at most 16 characters for GST types, still unique
 *   once separators are removed (the form an SMS carries), and locked once its first number is issued.
 * - Parcels, returns and payment requests hang off the order number (`ST-48213-90761/P1`).
 * - The order number's format is still the owner's to choose (asked 2026-11-20); it stays a setting
 *   with three shapes and is never locked, because it is not a GST document.
 */

/** Every numbered document type the system issues or keeps beside its own. */
export const NumberedDocumentType = z.enum([
	'taxInvoice',
	'creditNote',
	'debitNote',
	'receipt',
	'refundVoucher',
	'deliveryChallan',
	'paymentVoucher',
	'selfInvoice',
	'purchaseOrder',
	'purchaseEntry',
	'purchaseReturnNote',
	'journal',
	'stockAdjustment',
	'stockCount',
	'openingStock',
]);
export type NumberedDocumentType = z.infer<typeof NumberedDocumentType>;

/** Documents numbered under GST rules (Rule 46 and the rules naming each voucher). */
export const GST_DOCUMENT_TYPES: readonly NumberedDocumentType[] = [
	'taxInvoice',
	'creditNote',
	'debitNote',
	'receipt',
	'refundVoucher',
	'deliveryChallan',
	'paymentVoucher',
	'selfInvoice',
];

/** Rule 46: a GST document number is at most 16 characters. */
export const GST_NUMBER_MAX_LENGTH = 16;

export const NumberSeparator = z.enum(['/', '-']);
export type NumberSeparator = z.infer<typeof NumberSeparator>;

/** A series: prefix, the financial year (`26-27`) or not, a padded count, and when the count restarts. */
export const SeriesFormat = z.object({
	prefix: z
		.string()
		.trim()
		.regex(/^[A-Z][A-Z0-9]{0,5}$/, { message: 'prefix_shape' }),
	separator: NumberSeparator.default('/'),
	includeFinancialYear: z.boolean().default(true),
	digits: z.number().int().min(3).max(8),
	/** `fy`: restarts at 1 each 1 April. `never`: one count for ever. */
	reset: z.enum(['fy', 'never']).default('fy'),
});
export type SeriesFormat = z.infer<typeof SeriesFormat>;

/** Child documents of an order: the order number, a separator, a letter, a count (`/P1`). */
export const OrderChildFormat = z.object({
	letter: z.string().regex(/^[A-Z]$/),
	separator: NumberSeparator.default('/'),
});
export type OrderChildFormat = z.infer<typeof OrderChildFormat>;

/**
 * The order number (OD18, still open). Three shapes from the brief:
 * - `randomGroups`: `ST-48213-90761`, random digits in fixed-width groups, never restarts;
 * - `financialYearSequence`: `SO/26-27/000001`;
 * - `runningNumber`: `ST10001`, one count from a starting number.
 */
export const OrderNumberFormat = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('randomGroups'),
		prefix: z
			.string()
			.trim()
			.regex(/^[A-Z][A-Z0-9]{0,5}$/, { message: 'prefix_shape' }),
		separator: NumberSeparator.default('-'),
		groups: z.array(z.number().int().min(3).max(8)).min(1).max(3),
	}),
	z.object({
		kind: z.literal('financialYearSequence'),
		prefix: z
			.string()
			.trim()
			.regex(/^[A-Z][A-Z0-9]{0,5}$/, { message: 'prefix_shape' }),
		separator: NumberSeparator.default('/'),
		digits: z.number().int().min(4).max(8),
	}),
	z.object({
		kind: z.literal('runningNumber'),
		prefix: z
			.string()
			.trim()
			.regex(/^[A-Z][A-Z0-9]{0,5}$/, { message: 'prefix_shape' }),
		start: z.number().int().min(1).max(99_999_999),
		digits: z.number().int().min(3).max(8),
	}),
]);
export type OrderNumberFormat = z.infer<typeof OrderNumberFormat>;

export const DocumentNumberingSettings = z.object({
	/** OD18 is open: this holds the brief's recommended shape until the owner chooses. */
	order: OrderNumberFormat,
	/** Set to the owner's answer when it arrives; false while the order format is the interim one. */
	orderFormatChosenByOwner: z.boolean().default(false),
	parcel: OrderChildFormat,
	return: OrderChildFormat,
	paymentRequest: OrderChildFormat,
	series: z.record(NumberedDocumentType, SeriesFormat),
	/** Types whose first number has been issued; their format can no longer change. */
	lockedTypes: z.array(NumberedDocumentType).default([]),
	revision: z.number().int().nonnegative().default(0),
	updatedAt: IsoDateTime.nullable().default(null),
	updatedBy: z.string().nullable().default(null),
});
export type DocumentNumberingSettings = z.infer<typeof DocumentNumberingSettings>;

/** The brief's table, as accepted on 2026-11-20 (order row: the recommended shape, pending). */
export const DEFAULT_DOCUMENT_NUMBERING: DocumentNumberingSettings = {
	order: { kind: 'randomGroups', prefix: 'ST', separator: '-', groups: [5, 5] },
	orderFormatChosenByOwner: false,
	parcel: { letter: 'P', separator: '/' },
	return: { letter: 'R', separator: '/' },
	paymentRequest: { letter: 'Q', separator: '/' },
	series: {
		taxInvoice: { prefix: 'TI', separator: '/', includeFinancialYear: true, digits: 6, reset: 'fy' },
		creditNote: { prefix: 'CN', separator: '/', includeFinancialYear: true, digits: 6, reset: 'fy' },
		debitNote: { prefix: 'DN', separator: '/', includeFinancialYear: true, digits: 6, reset: 'fy' },
		receipt: { prefix: 'RC', separator: '/', includeFinancialYear: true, digits: 6, reset: 'fy' },
		refundVoucher: { prefix: 'RF', separator: '/', includeFinancialYear: true, digits: 6, reset: 'fy' },
		deliveryChallan: { prefix: 'DC', separator: '/', includeFinancialYear: true, digits: 6, reset: 'fy' },
		paymentVoucher: { prefix: 'PV', separator: '/', includeFinancialYear: true, digits: 6, reset: 'fy' },
		selfInvoice: { prefix: 'SI', separator: '/', includeFinancialYear: true, digits: 6, reset: 'fy' },
		purchaseOrder: { prefix: 'PO', separator: '/', includeFinancialYear: true, digits: 4, reset: 'fy' },
		purchaseEntry: { prefix: 'PE', separator: '/', includeFinancialYear: true, digits: 5, reset: 'fy' },
		purchaseReturnNote: { prefix: 'PR', separator: '/', includeFinancialYear: true, digits: 4, reset: 'fy' },
		journal: { prefix: 'JV', separator: '/', includeFinancialYear: true, digits: 6, reset: 'fy' },
		stockAdjustment: { prefix: 'SA', separator: '/', includeFinancialYear: true, digits: 4, reset: 'fy' },
		stockCount: { prefix: 'SC', separator: '/', includeFinancialYear: true, digits: 3, reset: 'fy' },
		openingStock: { prefix: 'OS', separator: '/', includeFinancialYear: true, digits: 6, reset: 'fy' },
	},
	lockedTypes: [],
	revision: 0,
	updatedAt: null,
	updatedBy: null,
};

/** Why a format can't be saved. */
export const NumberFormatProblem = z.enum([
	'too_long_for_gst',
	'not_unique_without_separators',
	'locked_after_first_issue',
	'prefix_clash',
]);
export type NumberFormatProblem = z.infer<typeof NumberFormatProblem>;

export const DocumentNumberingWrite = DocumentNumberingSettings.omit({
	lockedTypes: true,
	updatedAt: true,
	updatedBy: true,
	orderFormatChosenByOwner: true,
});
export type DocumentNumberingWrite = z.infer<typeof DocumentNumberingWrite>;

/** One row of the numbering settings screen: the format, an example, and whether it is locked. */
export const DocumentNumberingRow = z.object({
	type: z.union([NumberedDocumentType, z.enum(['order', 'parcel', 'return', 'paymentRequest'])]),
	example: z.string(),
	resetsEachYear: z.boolean(),
	locked: z.boolean(),
	gst: z.boolean(),
});
export type DocumentNumberingRow = z.infer<typeof DocumentNumberingRow>;
