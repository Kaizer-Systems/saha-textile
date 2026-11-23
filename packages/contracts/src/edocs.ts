import { z } from 'zod';

import { Id, IsoDateTime } from './common';
import { Gstin, GstStateCode } from './gst';
import { IsoDate } from './purchasing';

/**
 * E-invoice (IRN + signed QR) and e-way bill (accounts brief addendum 2, EI1–EI14; owner 23 Nov 2026).
 * Five paths, chosen per GSTIN: by hand (active now) and, per document, a direct government API and a
 * provider (GSP). The buttons are the same in every path; only how the numbers arrive differs.
 */
export const EInvoicePath = z.enum(['manual', 'irpDirect', 'irpProvider']);
export type EInvoicePath = z.infer<typeof EInvoicePath>;
export const EWayBillPath = z.enum(['manual', 'ewbDirect', 'ewbProvider']);
export type EWayBillPath = z.infer<typeof EWayBillPath>;
export const AutomaticEDocPath = z.enum(['irpDirect', 'irpProvider', 'ewbDirect', 'ewbProvider']);
export type AutomaticEDocPath = z.infer<typeof AutomaticEDocPath>;
export const EDocKind = z.enum(['eInvoice', 'eWayBill']);
export type EDocKind = z.infer<typeof EDocKind>;
export const EDocEnvironment = z.enum(['sandbox', 'production']);
export type EDocEnvironment = z.infer<typeof EDocEnvironment>;

/** Which government system or provider an automatic path talks to (AE2, AE3). */
export const EDocProvider = z.enum(['irisIrp', 'nicIrp', 'nicEwb', 'mastersIndia', 'otherGsp']);
export type EDocProvider = z.infer<typeof EDocProvider>;

/** IRN: 64 hexadecimal characters (SHA-256 of GSTIN, financial year, document type and number). */
export const Irn = z
	.string()
	.trim()
	.regex(/^[0-9a-fA-F]{64}$/, { message: 'irn_shape' })
	.transform((value) => value.toLowerCase());
/** E-way bill number: 12 digits, 14 from 23 Nov 2026 (NIC notice). Spaces are ignored. */
export const EWayBillNumber = z
	.string()
	.transform((value) => value.replace(/\s+/g, ''))
	.pipe(z.string().regex(/^(\d{12}|\d{14})$/, { message: 'ewb_shape' }));
/** Government document number: up to 16 characters, letters, digits, / and -; not starting with 0, / or -. */
export const GovDocNumber = z.string().regex(/^[a-zA-Z1-9][a-zA-Z0-9/-]{0,15}$/, { message: 'doc_number_shape' });

/** An automatic path's keys as the screens see them: never the secrets themselves (AE6). */
export const EDocKeysView = z.object({
	path: AutomaticEDocPath,
	provider: EDocProvider,
	environment: EDocEnvironment,
	baseUrl: z.string().url(),
	userName: z.string(),
	clientIdHint: z.string().nullable().default(null),
	hasClientSecret: z.boolean(),
	hasPassword: z.boolean(),
	hasPublicKey: z.boolean(),
	passwordSetOn: IsoDate.nullable().default(null),
	testedAt: IsoDateTime.nullable().default(null),
	testOk: z.boolean().nullable().default(null),
	testMessage: z.string().nullable().default(null),
});
export type EDocKeysView = z.infer<typeof EDocKeysView>;

/** Saving keys: a blank secret keeps the stored one. */
export const EDocKeysWrite = z.object({
	path: AutomaticEDocPath,
	provider: EDocProvider,
	environment: EDocEnvironment,
	baseUrl: z
		.string()
		.url()
		.refine((u) => u.startsWith('https://'), { message: 'https_needed' }),
	userName: z.string().trim().min(1).max(100),
	password: z.string().max(200).optional(),
	clientId: z.string().trim().max(200).optional(),
	clientSecret: z.string().max(500).optional(),
	/** The government public key (PEM) used to encrypt the sign-in; public, not a secret. */
	publicKeyPem: z.string().max(5000).optional(),
});
export type EDocKeysWrite = z.infer<typeof EDocKeysWrite>;

/** Per GSTIN (EI1). */
export const EDocSettings = z.object({
	gstin: Gstin,
	eInvoicePath: EInvoicePath.default('manual'),
	eWayBillPath: EWayBillPath.default('manual'),
	/** Business invoices of an enabled GSTIN make their e-way bill through the e-invoice path (NIC requires it). */
	eWayBillWithEInvoice: z.boolean().default(true),
	/** Empty: the GSTIN is not e-invoice enabled and Generate e-invoice doesn't show. */
	eInvoiceEnabledFrom: IsoDate.nullable().default(null),
	eWayBillThresholdINR: z.number().int().nonnegative().default(50_000),
	keys: z.array(EDocKeysView).default([]),
	revision: z.number().int().nonnegative().default(0),
	updatedAt: IsoDateTime.nullable().default(null),
	updatedBy: Id.nullable().default(null),
});
export type EDocSettings = z.infer<typeof EDocSettings>;
export const EDocSettingsWrite = EDocSettings.pick({
	eInvoicePath: true,
	eWayBillPath: true,
	eWayBillWithEInvoice: true,
	eInvoiceEnabledFrom: true,
	eWayBillThresholdINR: true,
});
export type EDocSettingsWrite = z.infer<typeof EDocSettingsWrite>;

export const EDocSettingsSave = z.object({ settings: EDocSettingsWrite, expectedUpdatedAt: z.string().nullable() });
export type EDocSettingsSave = z.infer<typeof EDocSettingsSave>;

export const EDocListQuery = z.object({
	kind: EDocKind,
	status: z.enum(['active', 'cancelled']).optional(),
	from: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.optional(),
	to: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.optional(),
	q: z.string().trim().max(80).optional(),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type EDocListQuery = z.infer<typeof EDocListQuery>;

export const EDocActivityQuery = z.object({ page: z.coerce.number().int().min(1).default(1) });
export type EDocActivityQuery = z.infer<typeof EDocActivityQuery>;

export const EDocDocumentType = z.enum(['taxInvoice', 'creditNote', 'debitNote', 'deliveryChallan']);
export type EDocDocumentType = z.infer<typeof EDocDocumentType>;

export const EWayBillPartB = z.object({
	mode: z.enum(['road', 'rail', 'air', 'ship', 'inTransit', 'metroRail']),
	vehicleNo: z.string().trim().max(15).nullable().default(null),
	vehicleType: z.enum(['regular', 'overDimension']).default('regular'),
	transporterId: z.string().trim().max(15).nullable().default(null),
	transporterName: z.string().trim().max(100).nullable().default(null),
	transportDocNo: z.string().trim().max(15).nullable().default(null),
	transportDocDate: IsoDate.nullable().default(null),
	distanceKm: z.number().int().min(0).max(4000),
});
export type EWayBillPartB = z.infer<typeof EWayBillPartB>;

/** One IRN or one e-way bill, whatever path made it. */
export const EDocument = z.object({
	id: Id,
	kind: EDocKind,
	gstin: Gstin,
	documentType: EDocDocumentType,
	documentId: Id,
	documentNumber: z.string(),
	documentDate: IsoDate,
	orderId: Id.nullable().default(null),
	/** The buyer and the document's value, as the lists show them (EI12, EI13). */
	partyName: z.string().nullable().default(null),
	partyGstin: z.string().nullable().default(null),
	valueINR: z.number().nullable().default(null),
	path: z.union([EInvoicePath, EWayBillPath]),
	status: z.enum(['active', 'cancelled']),
	irn: z.string().nullable().default(null),
	ackNo: z.string().nullable().default(null),
	ackDate: IsoDateTime.nullable().default(null),
	/** The IRP's signed QR (a JWS); null when typed by hand ("QR pending"). */
	signedQr: z.string().max(8000).nullable().default(null),
	signedInvoice: z.string().max(200_000).nullable().default(null),
	ewbNumber: z.string().nullable().default(null),
	generatedAt: IsoDateTime.nullable().default(null),
	validUntil: IsoDateTime.nullable().default(null),
	partB: EWayBillPartB.nullable().default(null),
	/** Media id of the portal's PDF, attached when entered by hand. */
	portalPdfId: Id.nullable().default(null),
	cancellation: z
		.object({ reason: z.string(), remark: z.string(), at: IsoDateTime, by: Id })
		.nullable()
		.default(null),
	createdAt: IsoDateTime,
	createdBy: Id,
});
export type EDocument = z.infer<typeof EDocument>;

/** By hand, e-invoice (EI4B): the portal's signed file, or the numbers typed in. */
export const ManualEInvoiceEntry = z.union([
	z.object({ signedFile: z.string().min(2).max(300_000) }),
	z.object({
		irn: Irn,
		ackNo: z
			.string()
			.trim()
			.regex(/^\d{12,20}$/, { message: 'ack_shape' }),
		ackDate: IsoDateTime,
	}),
]);
export type ManualEInvoiceEntry = z.infer<typeof ManualEInvoiceEntry>;

/** By hand, e-way bill (EI6B). */
export const ManualEWayBillEntry = z.object({
	number: EWayBillNumber,
	generatedAt: IsoDateTime,
	validUntil: IsoDateTime,
	portalPdfId: Id.nullable().default(null),
	partB: EWayBillPartB.nullable().default(null),
});
export type ManualEWayBillEntry = z.infer<typeof ManualEWayBillEntry>;

/** Cancel reasons: the e-invoice and e-way bill codes differ (IRN: 1 duplicate, 2 data entry, 3 order cancelled, 4 others). */
export const EDocCancelReason = z.enum(['duplicate', 'dataEntryMistake', 'orderCancelled', 'other']);
export type EDocCancelReason = z.infer<typeof EDocCancelReason>;
export const EDocCancel = z.object({ reason: EDocCancelReason, remark: z.string().trim().max(50).default('') });
export type EDocCancel = z.infer<typeof EDocCancel>;

/** The activity log (EI14): never keys, passwords or payloads. */
export const EDocCall = z.object({
	id: Id,
	at: IsoDateTime,
	gstin: Gstin,
	path: z.union([EInvoicePath, EWayBillPath]),
	action: z.enum(['test', 'generate', 'cancel', 'fetch', 'partB', 'extend', 'gstinDetails', 'manualEntry']),
	documentNumber: z.string().nullable().default(null),
	ok: z.boolean(),
	code: z.string().nullable().default(null),
	message: z.string().max(500).nullable().default(null),
	durationMs: z.number().int().nonnegative().nullable().default(null),
	by: Id,
});
export type EDocCall = z.infer<typeof EDocCall>;

/** A buyer's GSTIN as the government returns it (Get GSTIN details). */
export const GstinDetails = z.object({
	gstin: Gstin,
	legalName: z.string(),
	tradeName: z.string(),
	stateCode: GstStateCode,
	pin: z.string().nullable(),
	status: z.enum(['active', 'cancelled', 'inactive', 'provisional', 'unknown']),
	blockedForEWayBill: z.boolean(),
});
export type GstinDetails = z.infer<typeof GstinDetails>;
