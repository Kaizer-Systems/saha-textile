import type { EDocCancelReason, EWayBillPartB } from '@saha-textile/contracts';
import {
	EDocRefusedError,
	EDocUnavailableError,
	fromGovDateTime,
	govTransMode,
	toGovDate,
	type EWayBillGateway,
	type EWayBillResult,
} from '@saha-textile/core-domain';

import { callJson, trimSlash, type HttpOptions } from './http';
import { decryptEWayBillPayload, decryptSek, encryptEWayBillPayload, newAppKey, rsaEncryptBase64 } from './nic-crypto';

/**
 * The direct e-way bill path: NIC's e-way bill API v1.03. NIC gives it only to taxpayers with about 10,000
 * e-way bills a month per GSTIN and up to 3 whitelisted Indian addresses, so it is built and tested but
 * K.R. Marketing uses the by-hand path (EI2).
 */
export interface EwbDirectConfig extends HttpOptions {
	baseUrl: string;
	clientId: string;
	clientSecret: string;
	userName: string;
	password: string;
	publicKeyPem: string;
	paths?: Partial<typeof EWB_PATHS>;
	now?: () => Date;
}

export const EWB_PATHS = { auth: '/ewaybillapi/v1.03/auth', action: '/ewaybillapi/v1.03/ewayapi' };

interface Session {
	authToken: string;
	sek: Buffer;
	expiresAt: number;
}

type EwbReply = {
	status?: unknown;
	data?: unknown;
	error?: unknown;
	alert?: unknown;
	authtoken?: string;
	sek?: string;
};

/** The e-way bill system's error: {errorCodes: "238,"}, sometimes base64-wrapped. */
export function ewbErrorCodes(reply: EwbReply): string[] {
	let raw: unknown = reply.error;
	if (typeof raw === 'string') {
		try {
			raw = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
		} catch {
			return [raw as string];
		}
	}
	const codes = (raw as { errorCodes?: unknown })?.errorCodes;
	return String(codes ?? 'unknown')
		.split(',')
		.map((c) => c.trim())
		.filter(Boolean);
}

const CANCEL_CODE: Record<EDocCancelReason, number> = {
	duplicate: 1,
	orderCancelled: 2,
	dataEntryMistake: 3,
	other: 4,
};
const PART_B_REASON = { breakdown: '1', transhipment: '2', others: '3', firstTime: '4' } as const;
const EXTEND_REASON = { naturalCalamity: 1, lawAndOrder: 2, transhipment: 4, accident: 5, others: 99 } as const;
const TOKEN_ERRORS = new Set(['238', '106']);

export class EwbDirectGateway implements EWayBillGateway {
	private readonly sessions = new Map<string, Session>();
	private readonly paths: typeof EWB_PATHS;

	constructor(private readonly config: EwbDirectConfig) {
		this.paths = { ...EWB_PATHS, ...config.paths };
	}

	private async session(gstin: string, force = false): Promise<Session> {
		const now = (this.config.now ?? (() => new Date()))().getTime();
		const cached = this.sessions.get(gstin);
		if (cached && !force && cached.expiresAt - 10 * 60_000 > now) return cached;
		const appKey = newAppKey();
		const credentials = {
			action: 'ACCESSTOKEN',
			username: this.config.userName,
			password: this.config.password,
			app_key: appKey.toString('base64'),
		};
		const data = rsaEncryptBase64(
			this.config.publicKeyPem,
			Buffer.from(JSON.stringify(credentials), 'utf8').toString('base64'),
		);
		const reply = (await callJson(
			this.config,
			'POST',
			trimSlash(this.config.baseUrl) + this.paths.auth,
			{ 'client-id': this.config.clientId, 'client-secret': this.config.clientSecret, Gstin: gstin },
			{ Data: data },
		)) as EwbReply;
		if (String(reply.status) !== '1' || !reply.authtoken || !reply.sek) {
			const code = ewbErrorCodes(reply)[0] ?? 'auth';
			if (String(reply.status) === '1') throw new EDocUnavailableError('edoc_auth_reply');
			throw new EDocRefusedError(code, 'Sign-in refused');
		}
		// NIC: the token lives 360 minutes and is not renewed by calling again.
		const session = {
			authToken: reply.authtoken,
			sek: decryptSek(reply.sek, appKey),
			expiresAt: now + 360 * 60_000,
		};
		this.sessions.set(gstin, session);
		return session;
	}

	private async action(
		gstin: string,
		action: string,
		payload: unknown,
		retried = false,
	): Promise<Record<string, unknown>> {
		const session = await this.session(gstin, retried);
		const headers = {
			'client-id': this.config.clientId,
			'client-secret': this.config.clientSecret,
			gstin,
			authtoken: session.authToken,
		};
		const reply = (await callJson(
			this.config,
			'POST',
			trimSlash(this.config.baseUrl) + this.paths.action,
			headers,
			{ action, data: encryptEWayBillPayload(session.sek, payload) },
		)) as EwbReply;
		if (String(reply.status) !== '1') {
			const codes = ewbErrorCodes(reply);
			if (!retried && codes.some((c) => TOKEN_ERRORS.has(c))) {
				this.sessions.delete(gstin);
				return this.action(gstin, action, payload, true);
			}
			throw new EDocRefusedError(codes.join(','), `E-way bill system refused (${codes.join(', ')})`);
		}
		const data = typeof reply.data === 'string' ? decryptEWayBillPayload(session.sek, reply.data) : reply.data;
		return (data ?? {}) as Record<string, unknown>;
	}

	async test(gstin: string): Promise<void> {
		await this.session(gstin, false);
	}

	async generate(gstin: string, ewbJson: Record<string, unknown>): Promise<EWayBillResult> {
		const body = await this.action(gstin, 'GENEWAYBILL', ewbJson);
		if (!body['ewayBillNo']) throw new EDocRefusedError('ewb_missing', 'No e-way bill number in the answer');
		return {
			number: String(body['ewayBillNo']),
			generatedAt: fromGovDateTime(String(body['ewayBillDate'] ?? '')) ?? new Date().toISOString(),
			validUntil: fromGovDateTime(String(body['validUpto'] ?? '')),
			alert: body['alert'] ? String(body['alert']) : null,
		};
	}

	async updatePartB(
		gstin: string,
		ewbNo: string,
		change: {
			partB: EWayBillPartB;
			fromPlace: string;
			fromStateCode: string;
			reason: keyof typeof PART_B_REASON;
			remark: string;
		},
	): Promise<{ updatedAt: string; validUntil: string | null }> {
		const p = change.partB;
		const body = await this.action(gstin, 'VEHEWB', {
			ewbNo: Number(ewbNo),
			vehicleNo: p.vehicleNo ? p.vehicleNo.replace(/\s+/g, '').toUpperCase() : '',
			fromPlace: change.fromPlace.slice(0, 50),
			fromState: Number(change.fromStateCode),
			reasonCode: PART_B_REASON[change.reason],
			reasonRem: change.remark.slice(0, 50),
			transDocNo: p.transportDocNo ?? '',
			transDocDate: p.transportDocDate ? toGovDate(p.transportDocDate) : '',
			transMode: govTransMode(p.mode),
			vehicleType: p.vehicleType === 'overDimension' ? 'O' : 'R',
		});
		return {
			updatedAt: fromGovDateTime(String(body['vehUpdDate'] ?? '')) ?? new Date().toISOString(),
			validUntil: fromGovDateTime(String(body['validUpto'] ?? '')),
		};
	}

	async extend(
		gstin: string,
		ewbNo: string,
		x: {
			partB: EWayBillPartB;
			fromPlace: string;
			fromStateCode: string;
			fromPin: string;
			remainingKm: number;
			reason: keyof typeof EXTEND_REASON;
			remark: string;
		},
	): Promise<{ validUntil: string }> {
		const inTransit = x.partB.mode === 'inTransit';
		const body = await this.action(gstin, 'EXTENDVALIDITY', {
			ewbNo: Number(ewbNo),
			vehicleNo: x.partB.vehicleNo ? x.partB.vehicleNo.replace(/\s+/g, '').toUpperCase() : '',
			fromPlace: x.fromPlace.slice(0, 50),
			fromState: Number(x.fromStateCode),
			remainingDistance: x.remainingKm,
			transDocNo: x.partB.transportDocNo ?? '',
			transDocDate: x.partB.transportDocDate ? toGovDate(x.partB.transportDocDate) : '',
			transMode: govTransMode(x.partB.mode),
			extnRsnCode: EXTEND_REASON[x.reason],
			extnRemarks: x.remark.slice(0, 50),
			fromPincode: Number(x.fromPin),
			consignmentStatus: inTransit ? 'T' : 'M',
			transitType: inTransit ? 'R' : '',
			addressLine1: x.fromPlace.slice(0, 50),
			addressLine2: '',
			addressLine3: '',
		});
		const until = fromGovDateTime(String(body['validUpto'] ?? ''));
		if (!until) throw new EDocRefusedError('ewb_extend_reply', 'No new validity in the answer');
		return { validUntil: until };
	}

	async cancel(
		gstin: string,
		ewbNo: string,
		reason: EDocCancelReason,
		remark: string,
	): Promise<{ cancelledAt: string }> {
		const body = await this.action(gstin, 'CANEWB', {
			ewbNo: Number(ewbNo),
			cancelRsnCode: CANCEL_CODE[reason],
			cancelRmrk: remark.slice(0, 50),
		});
		return { cancelledAt: fromGovDateTime(String(body['cancelDate'] ?? '')) ?? new Date().toISOString() };
	}
}
