import type { EDocCancelReason, EWayBillPartB, GstinDetails } from '@saha-textile/contracts';
import {
	EDocRefusedError,
	EDocUnavailableError,
	eWayBillDetailsForIrp,
	fromGovDateTime,
	type EInvoiceGateway,
	type EInvoiceResult,
	type EWayBillResult,
} from '@saha-textile/core-domain';

import { callJson, trimSlash, type HttpOptions } from './http';
import { decryptEInvoicePayload, decryptSek, encryptEInvoicePayload, newAppKey, rsaEncryptBase64 } from './nic-crypto';

/**
 * The direct e-invoice path (AE2): any IRP that speaks NIC's e-invoice API (auth v1.04, core v1.03), chosen by
 * its base address: IRIS IRP 6 (free plan, any enabled GSTIN) or NIC (₹100 crore and above). Paths are
 * configurable because each IRP publishes its own host; the defaults are NIC's service prefixes.
 */
export interface IrpDirectConfig extends HttpOptions {
	baseUrl: string;
	clientId: string;
	clientSecret: string;
	userName: string;
	password: string;
	/** The IRP's public key (PEM) used to encrypt the sign-in. */
	publicKeyPem: string;
	paths?: Partial<typeof IRP_PATHS>;
	now?: () => Date;
}

export const IRP_PATHS = {
	auth: '/eivital/v1.04/auth',
	gstin: '/eivital/v1.04/Master/gstin/{gstin}',
	generate: '/eicore/v1.03/Invoice',
	cancel: '/eicore/v1.03/Invoice/Cancel',
	byDocument: '/eicore/v1.03/Invoice/irnbydocdetails?doctype={type}&docnum={number}&docdate={date}',
	ewbByIrn: '/eiewb/v1.03/ewaybill',
};

interface Session {
	authToken: string;
	sek: Buffer;
	expiresAt: number;
}

type IrpReply = {
	Status?: unknown;
	status?: unknown;
	Data?: unknown;
	data?: unknown;
	ErrorDetails?: unknown;
	error?: unknown;
	InfoDtls?: unknown;
};

/** NIC sends errors as an array, a base64 JSON array, or one object. */
export function irpErrors(reply: IrpReply): { code: string; message: string }[] {
	let raw: unknown = reply.ErrorDetails ?? reply.error ?? null;
	if (typeof raw === 'string') {
		const text = raw;
		try {
			raw = JSON.parse(Buffer.from(text, 'base64').toString('utf8'));
		} catch {
			try {
				raw = JSON.parse(text);
			} catch {
				return [{ code: 'unknown', message: text }];
			}
		}
	}
	const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
	return list.map((e) => {
		const item = e as Record<string, unknown>;
		return {
			code: String(item['ErrorCode'] ?? item['errorCode'] ?? 'unknown'),
			message: String(item['ErrorMessage'] ?? item['errorMessage'] ?? ''),
		};
	});
}

const ok = (reply: IrpReply): boolean => String(reply.Status ?? reply.status ?? '0') === '1';
const TOKEN_ERRORS = new Set(['1005', '1004']);

export class IrpDirectEInvoiceGateway implements EInvoiceGateway {
	private readonly sessions = new Map<string, Session>();
	private readonly paths: typeof IRP_PATHS;

	constructor(private readonly config: IrpDirectConfig) {
		this.paths = { ...IRP_PATHS, ...config.paths };
	}

	private headers(gstin: string, session?: Session): Record<string, string> {
		return {
			client_id: this.config.clientId,
			client_secret: this.config.clientSecret,
			Gstin: gstin,
			...(session ? { user_name: this.config.userName, AuthToken: session.authToken } : {}),
		};
	}

	private url(path: string, values: Record<string, string> = {}): string {
		return (
			trimSlash(this.config.baseUrl) +
			path.replace(/\{(\w+)\}/g, (_, key: string) => encodeURIComponent(values[key] ?? ''))
		);
	}

	private async session(gstin: string, force = false): Promise<Session> {
		const now = (this.config.now ?? (() => new Date()))().getTime();
		const cached = this.sessions.get(gstin);
		// Reuse the token until 10 minutes before it ends (NIC: one token per 6 hours, not one per call).
		if (cached && !force && cached.expiresAt - 10 * 60_000 > now) return cached;
		const appKey = newAppKey();
		const credentials = {
			UserName: this.config.userName,
			Password: this.config.password,
			AppKey: appKey.toString('base64'),
			ForceRefreshAccessToken: force,
		};
		const data = rsaEncryptBase64(
			this.config.publicKeyPem,
			Buffer.from(JSON.stringify(credentials), 'utf8').toString('base64'),
		);
		const reply = (await callJson(this.config, 'POST', this.url(this.paths.auth), this.headers(gstin), {
			Data: data,
		})) as IrpReply;
		if (!ok(reply)) {
			const error = irpErrors(reply)[0] ?? { code: 'auth', message: 'Sign-in refused' };
			throw new EDocRefusedError(error.code, error.message);
		}
		const body = (reply.Data ?? reply.data) as { AuthToken?: string; Sek?: string; TokenExpiry?: string };
		if (!body?.AuthToken || !body.Sek) throw new EDocUnavailableError('edoc_auth_reply');
		const expiry = fromGovDateTime(body.TokenExpiry ?? null);
		const session: Session = {
			authToken: body.AuthToken,
			sek: decryptSek(body.Sek, appKey),
			expiresAt: expiry ? new Date(expiry).getTime() : now + 6 * 3_600_000,
		};
		this.sessions.set(gstin, session);
		return session;
	}

	/** One signed-in call; a stale token is renewed once. */
	private async call(
		gstin: string,
		method: 'GET' | 'POST',
		url: string,
		payload?: unknown,
		retried = false,
	): Promise<{ data: unknown; info: unknown }> {
		const session = await this.session(gstin, retried);
		const body = payload === undefined ? undefined : { Data: encryptEInvoicePayload(session.sek, payload) };
		const reply = (await callJson(this.config, method, url, this.headers(gstin, session), body)) as IrpReply;
		if (!ok(reply)) {
			const errors = irpErrors(reply);
			if (!retried && errors.some((e) => TOKEN_ERRORS.has(e.code))) {
				this.sessions.delete(gstin);
				return this.call(gstin, method, url, payload, true);
			}
			const first = errors[0] ?? { code: 'unknown', message: 'Refused' };
			throw Object.assign(new EDocRefusedError(first.code, first.message), { info: reply.InfoDtls });
		}
		const data = reply.Data ?? reply.data;
		return {
			data: typeof data === 'string' ? decryptEInvoicePayload(session.sek, data) : data,
			info: reply.InfoDtls,
		};
	}

	async test(gstin: string): Promise<void> {
		await this.session(gstin, false);
		await this.gstinDetails(gstin, gstin);
	}

	async generate(gstin: string, invoiceJson: Record<string, unknown>): Promise<EInvoiceResult> {
		try {
			const { data } = await this.call(gstin, 'POST', this.url(this.paths.generate), invoiceJson);
			return toResult(data);
		} catch (error) {
			// 2150 duplicate IRN: the IRP already has this invoice — fetch it instead of failing (AE7).
			if (error instanceof EDocRefusedError && error.code === '2150') {
				const fromInfo = duplicateFromInfo((error as EDocRefusedError & { info?: unknown }).info);
				if (fromInfo) return fromInfo;
				const doc = invoiceJson['DocDtls'] as { Typ: 'INV' | 'CRN' | 'DBN'; No: string; Dt: string };
				const existing = await this.byDocument(gstin, doc.Typ, doc.No, doc.Dt);
				if (existing) return existing;
			}
			throw error;
		}
	}

	async cancel(
		gstin: string,
		irn: string,
		reason: EDocCancelReason,
		remark: string,
	): Promise<{ cancelledAt: string }> {
		const { data } = await this.call(gstin, 'POST', this.url(this.paths.cancel), {
			Irn: irn,
			CnlRsn: IRN_CANCEL_CODE[reason],
			CnlRem: remark.slice(0, 100),
		});
		const body = data as { CancelDate?: string };
		return { cancelledAt: fromGovDateTime(body?.CancelDate ?? null) ?? new Date().toISOString() };
	}

	async byDocument(
		gstin: string,
		docType: 'INV' | 'CRN' | 'DBN',
		docNo: string,
		docDateGov: string,
	): Promise<EInvoiceResult | null> {
		try {
			const { data } = await this.call(
				gstin,
				'GET',
				this.url(this.paths.byDocument, { type: docType, number: docNo, date: docDateGov }),
			);
			return toResult(data);
		} catch (error) {
			if (error instanceof EDocRefusedError && ['2148', '2283', '3001'].includes(error.code)) return null;
			throw error;
		}
	}

	async gstinDetails(gstin: string, of: string): Promise<GstinDetails> {
		const { data } = await this.call(gstin, 'GET', this.url(this.paths.gstin, { gstin: of }));
		return toGstinDetails(data);
	}

	async eWayBillByIrn(gstin: string, irn: string, partB: EWayBillPartB): Promise<EWayBillResult> {
		const { data } = await this.call(gstin, 'POST', this.url(this.paths.ewbByIrn), {
			Irn: irn,
			...eWayBillDetailsForIrp(partB),
		});
		const body = data as { EwbNo?: unknown; EwbDt?: string; EwbValidTill?: string; Remarks?: string };
		if (!body?.EwbNo) throw new EDocRefusedError('ewb_missing', 'No e-way bill number in the answer');
		return {
			number: String(body.EwbNo),
			generatedAt: fromGovDateTime(body.EwbDt ?? null) ?? new Date().toISOString(),
			validUntil: fromGovDateTime(body.EwbValidTill ?? null),
			alert: body.Remarks ?? null,
		};
	}
}

/** IRN cancel reason codes (NIC: 1 duplicate, 2 data entry mistake, 3 order cancelled, 4 others). */
export const IRN_CANCEL_CODE: Record<EDocCancelReason, string> = {
	duplicate: '1',
	dataEntryMistake: '2',
	orderCancelled: '3',
	other: '4',
};

/** The IRP answer (NIC field names; Masters India uses the same inside results.message). */
export function toResult(data: unknown): EInvoiceResult {
	const body = (data ?? {}) as Record<string, unknown>;
	const irn = String(body['Irn'] ?? '');
	if (!/^[0-9a-fA-F]{64}$/.test(irn) || !body['SignedQRCode'])
		throw new EDocRefusedError('irn_missing', 'No IRN in the answer');
	const ewbNo = body['EwbNo'];
	return {
		irn: irn.toLowerCase(),
		ackNo: String(body['AckNo'] ?? ''),
		ackDate: fromGovDateTime(String(body['AckDt'] ?? '')) ?? new Date().toISOString(),
		signedQr: String(body['SignedQRCode']),
		signedInvoice: body['SignedInvoice'] ? String(body['SignedInvoice']) : null,
		ewb: ewbNo
			? {
					number: String(ewbNo),
					generatedAt: fromGovDateTime(String(body['EwbDt'] ?? '')) ?? new Date().toISOString(),
					validUntil: fromGovDateTime(String(body['EwbValidTill'] ?? '')),
				}
			: null,
	};
}

/** NIC's duplicate answer may carry the existing IRN in InfoDtls ({InfCd: 'DUPIRN', Desc: {AckNo, AckDt, Irn}}). */
function duplicateFromInfo(info: unknown): EInvoiceResult | null {
	const list = Array.isArray(info) ? info : [];
	for (const item of list) {
		const desc = (item as { Desc?: Record<string, unknown> }).Desc;
		if (desc && typeof desc['Irn'] === 'string' && desc['SignedQRCode']) return toResult(desc);
	}
	return null;
}

const GSTIN_STATUS: Record<string, GstinDetails['status']> = {
	ACT: 'active',
	CNL: 'cancelled',
	INA: 'inactive',
	PRO: 'provisional',
};
export function toGstinDetails(data: unknown): GstinDetails {
	const b = (data ?? {}) as Record<string, unknown>;
	return {
		gstin: String(b['Gstin'] ?? ''),
		legalName: String(b['LegalName'] ?? ''),
		tradeName: String(b['TradeName'] ?? ''),
		stateCode: String(b['StateCode'] ?? '').padStart(2, '0'),
		pin: b['AddrPncd'] != null ? String(b['AddrPncd']) : null,
		status: GSTIN_STATUS[String(b['Status'] ?? '')] ?? 'unknown',
		blockedForEWayBill: String(b['BlkStatus'] ?? '') === 'B',
	};
}
