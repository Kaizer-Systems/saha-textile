import type {
	EDocCall,
	EDocCancelReason,
	EDocSettings,
	EDocument,
	EWayBillPartB,
	GstinDetails,
} from '@saha-textile/contracts';

/**
 * E-invoice and e-way bill ports (accounts brief addendum 2). One adapter per path: the API picks it per GSTIN
 * from Settings › E-invoice and e-way bill. Adapters speak the government schema built by core `edocs` rules.
 */
export interface EInvoiceResult {
	irn: string;
	ackNo: string;
	ackDate: string;
	signedQr: string;
	signedInvoice: string | null;
	/** Present when Part B went with the invoice and the IRP made the e-way bill too. */
	ewb: EWayBillResult | null;
}

export interface EWayBillResult {
	number: string;
	generatedAt: string;
	validUntil: string | null;
	alert?: string | null;
}

/** The government (or provider) said no: a code and message to show; retrying the same request won't help. */
export class EDocRefusedError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'EDocRefusedError';
	}
}

/** Couldn't reach the service or the session failed: Generate falls back to the by-hand popup (AE7). */
export class EDocUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'EDocUnavailableError';
	}
}

export interface EInvoiceGateway {
	/** Signs in and checks the GSTIN (Settings › Test). */
	test(gstin: string): Promise<void>;
	generate(gstin: string, invoiceJson: Record<string, unknown>): Promise<EInvoiceResult>;
	cancel(gstin: string, irn: string, reason: EDocCancelReason, remark: string): Promise<{ cancelledAt: string }>;
	/** The existing IRN of a document (after a duplicate refusal), within the IRP's 3-day window. */
	byDocument(
		gstin: string,
		docType: 'INV' | 'CRN' | 'DBN',
		docNo: string,
		docDateGov: string,
	): Promise<EInvoiceResult | null>;
	gstinDetails(gstin: string, of: string): Promise<GstinDetails>;
	eWayBillByIrn(gstin: string, irn: string, partB: EWayBillPartB): Promise<EWayBillResult>;
}

export interface EWayBillGateway {
	test(gstin: string): Promise<void>;
	generate(gstin: string, ewbJson: Record<string, unknown>): Promise<EWayBillResult>;
	updatePartB(
		gstin: string,
		ewbNo: string,
		change: {
			partB: EWayBillPartB;
			fromPlace: string;
			fromStateCode: string;
			reason: 'breakdown' | 'transhipment' | 'others' | 'firstTime';
			remark: string;
		},
	): Promise<{ updatedAt: string; validUntil: string | null }>;
	extend(
		gstin: string,
		ewbNo: string,
		extension: {
			partB: EWayBillPartB;
			fromPlace: string;
			fromStateCode: string;
			fromPin: string;
			remainingKm: number;
			reason: 'naturalCalamity' | 'lawAndOrder' | 'transhipment' | 'accident' | 'others';
			remark: string;
		},
	): Promise<{ validUntil: string }>;
	cancel(gstin: string, ewbNo: string, reason: EDocCancelReason, remark: string): Promise<{ cancelledAt: string }>;
}

/** Storage for settings, the IRN / e-way bill records and the activity log. */
export interface EDocListFilter {
	kind: 'eInvoice' | 'eWayBill';
	gstin?: string;
	status?: 'active' | 'cancelled';
	from?: string;
	to?: string;
	q?: string;
	page: number;
	pageSize: number;
}

export interface EDocRepository {
	getSettings(gstin: string): Promise<EDocSettings | null>;
	/** Optimistic: refused with StaleVersionError when someone saved in between. */
	saveSettings(settings: EDocSettings, expectedUpdatedAt: string | null): Promise<EDocSettings>;
	/** The active record of a kind for a document, if any. */
	findActive(kind: 'eInvoice' | 'eWayBill', documentId: string): Promise<EDocument | null>;
	findById(id: string): Promise<EDocument | null>;
	insert(doc: EDocument): Promise<void>;
	replace(doc: EDocument): Promise<void>;
	list(filter: EDocListFilter): Promise<{ rows: EDocument[]; total: number }>;
	logCall(call: EDocCall): Promise<void>;
	listCalls(gstin: string | null, page: number, pageSize: number): Promise<{ rows: EDocCall[]; total: number }>;
}

/** The secrets of an automatic path, encrypted at rest with EDOC_KEYS_KEY (AE6); never logged or returned. */
export interface EDocSecrets {
	password: string | null;
	clientId: string | null;
	clientSecret: string | null;
	publicKeyPem: string | null;
}

export interface EDocKeyStore {
	/** False when the server has no EDOC_KEYS_KEY: automatic paths can't be set up, by hand still works. */
	readonly available: boolean;
	put(gstin: string, path: string, secrets: EDocSecrets): Promise<void>;
	get(gstin: string, path: string): Promise<EDocSecrets | null>;
	remove(gstin: string, path: string): Promise<void>;
}
