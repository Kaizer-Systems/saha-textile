import { constants, generateKeyPairSync, privateDecrypt, randomBytes } from 'node:crypto';

import { EDocRefusedError, EDocUnavailableError } from '@saha-textile/core-domain';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	aesEcbDecrypt,
	aesEcbEncrypt,
	callJson,
	decryptEWayBillPayload,
	encryptEWayBillPayload,
	eWayBillDetailsSheet,
	ewbErrorCodes,
	EwbDirectGateway,
	irpErrors,
	IrpDirectEInvoiceGateway,
	mastersIndiaEWayBillBody,
	MastersIndiaEInvoiceGateway,
	mastersIndiaInvoiceBody,
	MastersIndiaEWayBillGateway,
	toGstinDetails,
	toResult,
	type FetchLike,
} from '../src';

// A fake NIC server: RSA sign-in, the session key under the app key, payloads under the session key.
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const rsaOpen = (b64: string): Record<string, unknown> =>
	JSON.parse(
		Buffer.from(
			privateDecrypt(
				{ key: privateKey, padding: constants.RSA_PKCS1_PADDING },
				Buffer.from(b64, 'base64'),
			).toString('utf8'),
			'base64',
		).toString('utf8'),
	);

const IRN = 'B'.repeat(64);
const QR = 'a.b.c';
const NOW = new Date('2026-11-22T10:00:00Z');
const reply = (body: unknown, status = 200) => ({ status, text: async () => JSON.stringify(body) });

type Route = (url: string, payload: unknown, enc: (x: unknown) => string) => unknown;

/** A NIC server for one kind of API; `auth` may replace the sign-in answer. */
function nic(kind: 'irp' | 'ewb', route: Route, auth?: (appKey: Buffer, sek: Buffer) => unknown) {
	const sek = randomBytes(32);
	const urls: string[] = [];
	let signIns = 0;
	const enc = (x: unknown) =>
		kind === 'irp'
			? aesEcbEncrypt(sek, Buffer.from(JSON.stringify(x)))
			: aesEcbEncrypt(sek, Buffer.from(Buffer.from(JSON.stringify(x)).toString('base64')));
	const fetch: FetchLike = async (url, init) => {
		urls.push(url);
		const body = init.body ? (JSON.parse(init.body) as Record<string, string>) : undefined;
		if (url.endsWith('/auth')) {
			signIns += 1;
			const creds = rsaOpen(body?.['Data'] as string);
			const appKey = Buffer.from(String(creds['AppKey'] ?? creds['app_key']), 'base64');
			const custom = auth?.(appKey, sek);
			if (custom !== undefined) return reply(custom);
			return reply(
				kind === 'irp'
					? {
							Status: 1,
							Data: {
								AuthToken: 'tok',
								Sek: aesEcbEncrypt(appKey, sek),
								TokenExpiry: '2026-11-23 23:00:00',
							},
						}
					: { status: '1', authtoken: 'tok', sek: aesEcbEncrypt(appKey, sek) },
			);
		}
		let payload: unknown;
		if (kind === 'irp' && body?.['Data']) payload = JSON.parse(aesEcbDecrypt(sek, body['Data']).toString('utf8'));
		if (kind === 'ewb' && body?.['data'])
			payload = JSON.parse(
				Buffer.from(aesEcbDecrypt(sek, body['data']).toString('utf8'), 'base64').toString('utf8'),
			);
		return reply(route(url, payload, enc));
	};
	return { fetch, urls, signIns: () => signIns };
}

const irp = (fetch: FetchLike, over: Record<string, unknown> = {}) =>
	new IrpDirectEInvoiceGateway({
		baseUrl: 'https://irp.example/',
		clientId: 'c',
		clientSecret: 's',
		userName: 'u',
		password: 'p',
		publicKeyPem: PEM,
		fetch,
		now: () => NOW,
		...over,
	});
const ewb = (fetch: FetchLike) =>
	new EwbDirectGateway({
		baseUrl: 'https://ewb.example',
		clientId: 'c',
		clientSecret: 's',
		userName: 'u',
		password: 'p',
		publicKeyPem: PEM,
		fetch,
	});
const PART_B = {
	mode: 'road' as const,
	vehicleNo: 'wb 02 ak 4410',
	vehicleType: 'overDimension' as const,
	transporterId: null,
	transporterName: null,
	transportDocNo: 'LR-1',
	transportDocDate: '2026-11-22',
	distanceKm: 10,
};
const BARE_B = {
	...PART_B,
	vehicleNo: null,
	vehicleType: 'regular' as const,
	transportDocNo: null,
	transportDocDate: null,
};

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('callJson', () => {
	it('uses the global fetch by default and sends no body or content type on a GET', async () => {
		const fetch = vi.fn(async () => reply({ ok: true }));
		vi.stubGlobal('fetch', fetch);
		await expect(callJson({}, 'GET', 'https://x.test', { H: '1' })).resolves.toEqual({ ok: true });
		expect(fetch).toHaveBeenCalledWith(
			'https://x.test',
			expect.objectContaining({ headers: { Accept: 'application/json', H: '1' } }),
		);
	});

	it('turns a server error, a non-JSON answer, a dead line and a timeout into “unavailable”', async () => {
		const call = (fetch: FetchLike, timeoutMs?: number) =>
			callJson({ fetch, timeoutMs }, 'POST', 'https://x.test', {}, {});
		await expect(call(async () => reply({}, 503))).rejects.toMatchObject({ message: 'edoc_http_503' });
		await expect(call(async () => ({ status: 200, text: async () => '<html>' }))).rejects.toMatchObject({
			message: 'edoc_not_json_200',
		});
		await expect(
			call(async () => {
				throw new Error('ECONNRESET');
			}),
		).rejects.toMatchObject({ message: 'edoc_network' });
		const hang: FetchLike = (_url, init) =>
			new Promise((_resolve, reject) =>
				init.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
			);
		await expect(call(hang, 5)).rejects.toBeInstanceOf(EDocUnavailableError);
		await expect(call(hang, 5)).rejects.toMatchObject({ message: 'edoc_timeout' });
	});
});

describe('NIC crypto', () => {
	it('works with 128-bit keys and refuses any other length', () => {
		const key = randomBytes(16);
		expect(aesEcbDecrypt(key, aesEcbEncrypt(key, Buffer.from('hi'))).toString()).toBe('hi');
		expect(() => aesEcbEncrypt(randomBytes(10), Buffer.from('x'))).toThrow('edoc_key_length');
	});

	it('reads an e-way bill answer sent as plain JSON as well as Base64 JSON', () => {
		const key = randomBytes(32);
		expect(decryptEWayBillPayload(key, aesEcbEncrypt(key, Buffer.from('{"a":1}')))).toEqual({ a: 1 });
		expect(decryptEWayBillPayload(key, aesEcbEncrypt(key, Buffer.from('[1]')))).toEqual([1]);
		expect(decryptEWayBillPayload(key, encryptEWayBillPayload(key, { b: 2 }))).toEqual({ b: 2 });
	});
});

describe('the e-way bill details sheet', () => {
	it('reads an inward bill without items, transport or transporter', () => {
		const rows = eWayBillDetailsSheet({ supplyType: 'I', subSupplyType: '99', transMode: '9' });
		expect(rows.find((row) => row.label === 'Transaction')?.value).toBe('Inward · 99');
		expect(rows.find((row) => row.label === 'Transport')?.value).toMatch(/^Part A only/);
		expect(rows.find((row) => row.label === 'Transporter')?.value).toBe('—');
		expect(rows.find((row) => row.label === 'Vehicle or document')?.value).toBe('—');
		expect(rows.some((row) => row.label.startsWith('Item'))).toBe(false);
	});
});

describe('irpErrors and the IRP answer', () => {
	it('reads errors as Base64 JSON, plain JSON, plain text, one object, lower-case names, or none', () => {
		const b64 = Buffer.from(JSON.stringify([{ ErrorCode: '2150', ErrorMessage: 'Dup' }])).toString('base64');
		expect(irpErrors({ ErrorDetails: b64 })).toEqual([{ code: '2150', message: 'Dup' }]);
		expect(irpErrors({ ErrorDetails: '{"errorCode":"3028","errorMessage":"GSTIN"}' })).toEqual([
			{ code: '3028', message: 'GSTIN' },
		]);
		expect(irpErrors({ error: 'Service down' })).toEqual([{ code: 'unknown', message: 'Service down' }]);
		expect(irpErrors({ error: {} })).toEqual([{ code: 'unknown', message: '' }]);
		expect(irpErrors({})).toEqual([]);
	});

	it('refuses an answer without an IRN, and reads one without an e-way bill, signed invoice or dates', () => {
		expect(() => toResult(null)).toThrow(EDocRefusedError);
		expect(() => toResult({ Irn: IRN })).toThrow('No IRN in the answer');
		const result = toResult({ Irn: IRN, SignedQRCode: QR });
		expect(result).toMatchObject({ irn: 'b'.repeat(64), ackNo: '', signedInvoice: null, ewb: null });
		expect(Date.parse(result.ackDate)).not.toBeNaN();
		const withEwb = toResult({ Irn: IRN, SignedQRCode: QR, EwbNo: 341 });
		expect(withEwb.ewb).toMatchObject({ number: '341', validUntil: null });
	});

	it('reads GSTIN details with every field missing, and a blocked e-way bill flag', () => {
		expect(toGstinDetails(null)).toEqual({
			gstin: '',
			legalName: '',
			tradeName: '',
			stateCode: '00',
			pin: null,
			status: 'unknown',
			blockedForEWayBill: false,
		});
		expect(toGstinDetails({ Status: 'CNL', BlkStatus: 'B', StateCode: 9 })).toMatchObject({
			status: 'cancelled',
			blockedForEWayBill: true,
			stateCode: '09',
		});
	});
});

describe('direct e-invoice: sign-in and calls', () => {
	const invoice = { DocDtls: { Typ: 'INV', No: 'TI/1', Dt: '22/11/2026' } };

	it('signs in once and reuses the session; a token without an expiry lasts six hours', async () => {
		const s = nic(
			'irp',
			(url, _p, enc) => (url.includes('/g/') ? { status: 1, data: enc({ Gstin: '19A', Status: 'ACT' }) } : {}),
			(appKey, sek) => ({ status: 1, data: { AuthToken: 'tok', Sek: aesEcbEncrypt(appKey, sek) } }),
		);
		const gateway = irp(s.fetch, { paths: { gstin: '/g/{gstin}/{missing}' } });
		await gateway.test('19A');
		await gateway.gstinDetails('19A', '19A');
		expect(s.signIns()).toBe(1);
		expect(s.urls.at(-1)).toBe('https://irp.example/g/19A/');
	});

	it('refuses a sign-in with its own error, a plain refusal, and a reply without a token', async () => {
		const refused = nic(
			'irp',
			() => ({}),
			() => ({ Status: 0, ErrorDetails: [{ ErrorCode: '1005', ErrorMessage: 'Bad' }] }),
		);
		await expect(irp(refused.fetch).test('19A')).rejects.toMatchObject({ code: '1005' });
		const plain = nic(
			'irp',
			() => ({}),
			() => ({ Status: 0 }),
		);
		await expect(irp(plain.fetch).test('19A')).rejects.toMatchObject({ code: 'auth' });
		const empty = nic(
			'irp',
			() => ({}),
			() => ({ Status: 1, Data: {} }),
		);
		await expect(irp(empty.fetch).test('19A')).rejects.toMatchObject({ message: 'edoc_auth_reply' });
	});

	it('renews a stale token once, then reports a refusal without details as “unknown”', async () => {
		let calls = 0;
		const s = nic('irp', () => {
			calls += 1;
			return calls === 1 ? { Status: 0, ErrorDetails: [{ ErrorCode: '1005' }] } : { Status: 0 };
		});
		await expect(irp(s.fetch).gstinDetails('19A', '27B')).rejects.toMatchObject({ code: 'unknown' });
		expect(s.signIns()).toBe(2);
	});

	it('takes a duplicate’s IRN from its own details, or rethrows when the IRP has nothing', async () => {
		const fromInfo = nic('irp', () => ({
			Status: 0,
			ErrorDetails: [{ ErrorCode: '2150' }],
			InfoDtls: [{ InfCd: 'X' }, { InfCd: 'DUPIRN', Desc: { Irn: IRN, SignedQRCode: QR, AckNo: 9 } }],
		}));
		await expect(irp(fromInfo.fetch).generate('19A', invoice)).resolves.toMatchObject({ ackNo: '9' });

		const nothing = nic('irp', (url) =>
			url.includes('irnbydocdetails')
				? { Status: 0, ErrorDetails: [{ ErrorCode: '2148' }] }
				: { Status: 0, ErrorDetails: [{ ErrorCode: '2150' }], InfoDtls: 'none' },
		);
		await expect(irp(nothing.fetch).generate('19A', invoice)).rejects.toMatchObject({ code: '2150' });

		const other = nic('irp', () => ({ Status: 0, ErrorDetails: [{ ErrorCode: '2172' }] }));
		await expect(irp(other.fetch).generate('19A', invoice)).rejects.toMatchObject({ code: '2172' });
		await expect(irp(other.fetch).byDocument('19A', 'INV', 'TI/1', '22/11/2026')).rejects.toMatchObject({
			code: '2172',
		});
	});

	it('cancels without a date in the answer, and reads the e-way bill made from an IRN', async () => {
		const s = nic('irp', (url, _p, enc) => {
			if (url.endsWith('/Cancel')) return { Status: 1, Data: enc({}) };
			if (url.endsWith('/ewaybill')) return { Status: 1, Data: { EwbNo: 341, Remarks: 'Check distance' } };
			return {};
		});
		const gateway = irp(s.fetch, { now: undefined });
		const cancelled = await gateway.cancel('19A', IRN, 'other', 'x'.repeat(120));
		expect(Date.parse(cancelled.cancelledAt)).not.toBeNaN();
		const bill = await gateway.eWayBillByIrn('19A', IRN, PART_B);
		expect(bill).toMatchObject({ number: '341', validUntil: null, alert: 'Check distance' });
		const plain = nic('irp', () => ({ Status: 1, Data: { EwbNo: 342 } }));
		await expect(irp(plain.fetch).eWayBillByIrn('19A', IRN, PART_B)).resolves.toMatchObject({ alert: null });
	});

	it('treats an answer without any status as a refusal', async () => {
		const s = nic('irp', () => ({}));
		await expect(irp(s.fetch).gstinDetails('19A', '27B')).rejects.toMatchObject({ code: 'unknown' });
	});

	it('refuses an e-way bill answer without a number', async () => {
		const s = nic('irp', () => ({ Status: 1, Data: null }));
		await expect(irp(s.fetch).eWayBillByIrn('19A', IRN, PART_B)).rejects.toMatchObject({ code: 'ewb_missing' });
	});
});

describe('direct e-way bill', () => {
	it('reads error codes from Base64 JSON, plain text, an object without codes and an empty list', () => {
		expect(ewbErrorCodes({ error: Buffer.from('{"errorCodes":"238, 106,"}').toString('base64') })).toEqual([
			'238',
			'106',
		]);
		expect(ewbErrorCodes({ error: 'not base64 json' })).toEqual(['not base64 json']);
		expect(ewbErrorCodes({ error: {} })).toEqual(['unknown']);
		expect(ewbErrorCodes({ error: { errorCodes: ',' } })).toEqual([]);
	});

	it('refuses a sign-in with its code or plainly, and calls a token-less success unavailable', async () => {
		const code = nic(
			'ewb',
			() => ({}),
			() => ({ status: '0', error: { errorCodes: '108' } }),
		);
		await expect(ewb(code.fetch).test('19A')).rejects.toMatchObject({ code: '108' });
		const plain = nic(
			'ewb',
			() => ({}),
			() => ({ status: '0', error: { errorCodes: '' } }),
		);
		await expect(ewb(plain.fetch).test('19A')).rejects.toMatchObject({ code: 'auth' });
		const empty = nic(
			'ewb',
			() => ({}),
			() => ({ status: '1' }),
		);
		await expect(ewb(empty.fetch).test('19A')).rejects.toMatchObject({ message: 'edoc_auth_reply' });
	});

	it('renews a stale token once, and keeps a working session', async () => {
		let n = 0;
		const s = nic('ewb', (_url, _p, enc) => {
			n += 1;
			if (n === 1) return { status: '0', error: { errorCodes: '238' } };
			return { status: '1', data: enc({ ewayBillNo: 1, alert: 'Long distance' }) };
		});
		const gateway = ewb(s.fetch);
		await expect(gateway.generate('19A', {})).resolves.toMatchObject({
			number: '1',
			alert: 'Long distance',
			validUntil: null,
		});
		await gateway.generate('19A', {});
		expect(s.signIns()).toBe(2);
	});

	it('refuses an answer without a number, and reads a plain or empty data body', async () => {
		const none = nic('ewb', () => ({ status: '1', data: null }));
		await expect(ewb(none.fetch).generate('19A', {})).rejects.toMatchObject({ code: 'ewb_missing' });
		const refused = nic('ewb', () => ({ status: '0', error: { errorCodes: '312' } }));
		await expect(ewb(refused.fetch).generate('19A', {})).rejects.toMatchObject({ code: '312' });
		const plain = nic('ewb', () => ({ status: '1', data: { cancelDate: '22/11/2026 06:00:00 PM' } }));
		await expect(ewb(plain.fetch).cancel('19A', '341', 'duplicate', 'x')).resolves.toEqual({
			cancelledAt: '2026-11-22T12:30:00.000Z',
		});
	});

	it('updates Part B and extends with or without a vehicle, and needs a new validity to extend', async () => {
		const seen: unknown[] = [];
		const s = nic('ewb', (url, payload, enc) => {
			seen.push(payload);
			return {
				status: '1',
				data: enc(seen.length === 2 || seen.length === 4 ? {} : { validUpto: '30/11/2026 11:59:00 PM' }),
			};
		});
		const gateway = ewb(s.fetch);
		const moved = await gateway.updatePartB('19A', '341', {
			partB: PART_B,
			fromPlace: 'Kolkata',
			fromStateCode: '19',
			reason: 'breakdown',
			remark: 'Tyre',
		});
		expect(moved.validUntil).toBe('2026-11-30T18:29:00.000Z');
		expect(Date.parse(moved.updatedAt)).not.toBeNaN();
		await gateway.updatePartB('19A', '341', {
			partB: BARE_B,
			fromPlace: 'K',
			fromStateCode: '19',
			reason: 'others',
			remark: '',
		});
		await gateway.extend('19A', '341', {
			partB: { ...PART_B, mode: 'inTransit' },
			fromPlace: 'K',
			fromStateCode: '19',
			fromPin: '700001',
			remainingKm: 5,
			reason: 'accident',
			remark: 'x',
		});
		await expect(
			gateway.extend('19A', '341', {
				partB: BARE_B,
				fromPlace: 'K',
				fromStateCode: '19',
				fromPin: '700001',
				remainingKm: 5,
				reason: 'others',
				remark: 'x',
			}),
		).rejects.toMatchObject({ code: 'ewb_extend_reply' });
		expect(Date.parse((await gateway.cancel('19A', '341', 'other', 'x')).cancelledAt)).not.toBeNaN();
		expect(seen[0]).toMatchObject({
			vehicleNo: 'WB02AK4410',
			vehicleType: 'O',
			transDocNo: 'LR-1',
			transDocDate: '22/11/2026',
		});
		expect(seen[1]).toMatchObject({ vehicleNo: '', vehicleType: 'R', transDocNo: '', transDocDate: '' });
		expect(seen[2]).toMatchObject({ consignmentStatus: 'T', transitType: 'R' });
		expect(seen[3]).toMatchObject({ consignmentStatus: 'M', transitType: '', vehicleNo: '', transDocNo: '' });
	});
});

describe('Masters India', () => {
	type Answer = (url: string, body: Record<string, unknown> | undefined) => unknown;
	const provider = (answer: Answer, token: unknown = { access_token: 'mi', expires_in: 3600 }) => {
		const urls: string[] = [];
		const fetch: FetchLike = async (url, init) => {
			urls.push(url);
			const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
			if (url.endsWith('/oauth/access_token') || url === 'https://auth.example/token') return reply(token);
			return reply(answer(url, body));
		};
		return { fetch, urls };
	};
	const config = (fetch: FetchLike, over: Record<string, unknown> = {}) => ({
		baseUrl: 'https://mi.example',
		userName: 'u',
		password: 'p',
		clientId: 'c',
		clientSecret: 's',
		fetch,
		...over,
	});
	const ok = (message: unknown) => ({ results: { status: 'Success', message } });

	it('signs in at its own token address, keeps the token an hour by default, and refuses a failed sign-in', async () => {
		const s = provider(() => ok({ Gstin: '19A' }), { access_token: 'mi' });
		const gateway = new MastersIndiaEInvoiceGateway(
			config(s.fetch, { tokenUrl: 'https://auth.example/token', now: () => NOW }),
		);
		await gateway.test('19A');
		await gateway.gstinDetails('19A', '27B');
		expect(s.urls.filter((url) => url.includes('/token'))).toHaveLength(1);
		expect(s.urls.at(-1)).toMatch(
			/^https:\/\/mi\.example\/gstinDetails\?access_token=mi&user_gstin=19A&gstin=27B$/,
		);

		const refused = provider(() => ({}), { error: 'invalid_grant', error_description: 'Wrong password' });
		await expect(new MastersIndiaEWayBillGateway(config(refused.fetch)).test()).rejects.toMatchObject({
			code: 'invalid_grant',
			message: 'Wrong password',
		});
		const bare = provider(() => ({}), {});
		await expect(new MastersIndiaEWayBillGateway(config(bare.fetch)).test()).rejects.toMatchObject({
			code: 'auth',
		});
	});

	it('reads refusals: no results, an error message, a text message, a bare refusal and an expired token', async () => {
		const gateway = (answer: Answer) => new MastersIndiaEInvoiceGateway(config(provider(answer).fetch));
		await expect(gateway(() => ({})).gstinDetails('19A', '27B')).rejects.toMatchObject({
			message: 'edoc_provider_reply',
		});
		await expect(
			gateway(() => ({ results: { errorMessage: '3028: GSTIN not found', InfoDtls: [1] } })).gstinDetails(
				'19A',
				'27B',
			),
		).rejects.toMatchObject({ code: '3028', info: [1] });
		await expect(
			gateway(() => ({ results: { message: 'Plain words' } })).gstinDetails('19A', '27B'),
		).rejects.toMatchObject({
			code: 'provider',
			message: 'Plain words',
		});
		await expect(
			gateway(() => ({ results: { status: 'Failed' } })).gstinDetails('19A', '27B'),
		).rejects.toMatchObject({
			message: 'Refused',
		});
		let n = 0;
		const renew = gateway(() =>
			++n === 1 ? { results: { errorMessage: 'Token expired' } } : ok({ Gstin: '27B' }),
		);
		await expect(renew.gstinDetails('19A', '27B')).resolves.toMatchObject({ gstin: '27B' });
	});

	it('fetches a duplicate invoice by its document, and rethrows when there is none', async () => {
		const invoice = { DocDtls: { Typ: 'INV', No: 'TI/1', Dt: '22/11/2026' } };
		const found = provider((url) =>
			url.includes('generateEinvoice')
				? { results: { errorMessage: '2150: Duplicate IRN' } }
				: ok({ Irn: IRN, SignedQRCode: QR }),
		);
		await expect(
			new MastersIndiaEInvoiceGateway(config(found.fetch)).generate('19A', invoice),
		).resolves.toMatchObject({
			irn: 'b'.repeat(64),
		});
		const missing = provider((url) =>
			url.includes('generateEinvoice')
				? { results: { errorMessage: '2150: Duplicate IRN' } }
				: { results: { errorMessage: '2148: Not found' } },
		);
		await expect(
			new MastersIndiaEInvoiceGateway(config(missing.fetch)).generate('19A', invoice),
		).rejects.toMatchObject({
			code: '2150',
		});
		const other = provider(() => ({ results: { errorMessage: '2172: Bad' } }));
		const gateway = new MastersIndiaEInvoiceGateway(config(other.fetch));
		await expect(gateway.generate('19A', invoice)).rejects.toMatchObject({ code: '2172' });
		await expect(gateway.byDocument('19A', 'INV', 'TI/1', '22/11/2026')).rejects.toMatchObject({ code: '2172' });
	});

	it('cancels an invoice, and says e-way bills by IRN go with Generate', async () => {
		const s = provider(() => ok({}));
		const gateway = new MastersIndiaEInvoiceGateway(config(s.fetch));
		expect(Date.parse((await gateway.cancel('19A', IRN, 'duplicate', 'x')).cancelledAt)).not.toBeNaN();
		await expect(gateway.eWayBillByIrn()).rejects.toMatchObject({ code: 'provider_ewb_by_irn' });
	});

	it('maps an invoice with dispatch, ship-to, e-way bill details and contact fields, and one with none', () => {
		const party = { Gstin: 'G', LglNm: 'Legal', Addr1: 'A', Loc: 'L', Pin: 1, Stcd: '19', Ph: '98', Em: 'a@b.c' };
		const full = mastersIndiaInvoiceBody('19A', {
			SellerDtls: party,
			BuyerDtls: { ...party, TrdNm: 'Trade', Addr2: 'B', Pos: '27' },
			DispDtls: { ...party, Nm: 'Godown' },
			ShipDtls: party,
			EwbDtls: { Distance: 10 },
			ItemList: [{ SlNo: '1' }],
		});
		expect(full).toMatchObject({
			seller_details: { trade_name: 'Legal', address2: '', phone_number: '98', email: 'a@b.c' },
			buyer_details: { trade_name: 'Trade', address2: 'B', place_of_supply: '27' },
			dispatch_details: { company_name: 'Godown' },
			ship_details: { legal_name: 'Legal' },
			ewaybill_details: { transporter_id: '', transportation_distance: 10, vehicle_type: '' },
			item_list: [{ item_serial_number: '1' }],
		});
		const bare = mastersIndiaInvoiceBody('19A', {
			EwbDtls: {
				TransId: 'T',
				TransName: 'N',
				TransMode: '1',
				TransDocNo: 'D',
				TransDocDt: 'X',
				VehNo: 'V',
				VehType: 'R',
			},
		});
		expect(bare).not.toHaveProperty('dispatch_details');
		expect(bare).not.toHaveProperty('ship_details');
		expect(bare['item_list']).toEqual([]);
		expect(bare['seller_details']).not.toHaveProperty('phone_number');
		expect(mastersIndiaInvoiceBody('19A', {})).not.toHaveProperty('ewaybill_details');
	});

	it('maps an e-way bill: inward, unknown codes, over-dimension or regular or no vehicle, and no items', () => {
		expect(
			mastersIndiaEWayBillBody('19A', {
				supplyType: 'I',
				subSupplyType: '99',
				docType: 'XX',
				transMode: '9',
				vehicleType: 'O',
			}),
		).toMatchObject({
			supply_type: 'inward',
			sub_supply_type: 'Supply',
			sub_supply_description: '',
			document_type: 'tax invoice',
			transportation_mode: '',
			vehicle_type: 'ODC',
			itemList: [],
		});
		expect(mastersIndiaEWayBillBody('19A', { vehicleType: 'R' })['vehicle_type']).toBe('Regular');
		expect(mastersIndiaEWayBillBody('19A', {})['vehicle_type']).toBe('');
	});

	it('runs the e-way bill calls: generate, Part B, extend and cancel', async () => {
		const bodies: Record<string, unknown>[] = [];
		const answers: unknown[] = [
			ok({}),
			ok({ ewayBillNo: 7, alert: 'Far' }),
			ok({ ewayBillNo: 8 }),
			ok({}),
			ok({}),
			ok({ validUpto: '30/11/2026 11:59:00 PM' }),
			ok({}),
			ok({}),
		];
		const s = provider((_url, body) => {
			bodies.push(body ?? {});
			return answers.shift();
		});
		const gateway = new MastersIndiaEWayBillGateway(config(s.fetch));
		await expect(gateway.generate('19A', {})).rejects.toMatchObject({ code: 'ewb_missing' });
		await expect(gateway.generate('19A', {})).resolves.toMatchObject({
			number: '7',
			alert: 'Far',
			validUntil: null,
		});
		await expect(gateway.generate('19A', {})).resolves.toMatchObject({ number: '8', alert: null });
		await gateway.updatePartB('19A', '7', {
			partB: PART_B,
			fromPlace: 'K',
			fromStateCode: '19',
			reason: 'firstTime',
			remark: '',
		});
		await gateway.updatePartB('19A', '7', {
			partB: { ...BARE_B, mode: 'unknown' as never },
			fromPlace: 'K',
			fromStateCode: '19',
			reason: 'others',
			remark: '',
		});
		await gateway.extend('19A', '7', {
			partB: { ...PART_B, mode: 'inTransit' },
			fromPlace: 'K',
			fromStateCode: '19',
			fromPin: '700001',
			remainingKm: 3,
			reason: 'Accident',
			remark: '',
		});
		await expect(
			gateway.extend('19A', '7', {
				partB: BARE_B,
				fromPlace: 'K',
				fromStateCode: '19',
				fromPin: '700001',
				remainingKm: 3,
				reason: 'Others',
				remark: '',
			}),
		).rejects.toMatchObject({ code: 'ewb_extend_reply' });
		expect(Date.parse((await gateway.cancel('19A', '7', 'orderCancelled', 'x')).cancelledAt)).not.toBeNaN();
		expect(bodies[3]).toMatchObject({
			vehicle_number: 'wb 02 ak 4410',
			vehicle_type: 'ODC',
			mode_of_transport: 'road',
		});
		expect(bodies[4]).toMatchObject({
			vehicle_number: '',
			vehicle_type: 'Regular',
			transporter_document_number: '',
			mode_of_transport: 'road',
		});
		expect(bodies[5]).toMatchObject({
			mode_of_transport: 'In Transit',
			consignment_status: 'T',
			transit_type: 'Road',
		});
		expect(bodies[6]).toMatchObject({ mode_of_transport: 'road', consignment_status: 'M', vehicle_number: '' });
	});
});
