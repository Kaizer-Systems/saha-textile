import { constants, generateKeyPairSync, privateDecrypt, randomBytes } from 'node:crypto';

import {
	buildEInvoiceJson,
	buildEWayBillJson,
	EDocRefusedError,
	EDocUnavailableError,
	type EDocSale,
} from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

import {
	aesEcbDecrypt,
	aesEcbEncrypt,
	eInvoicePortalFile,
	eWayBillDetailsSheet,
	EwbDirectGateway,
	IrpDirectEInvoiceGateway,
	mastersIndiaEWayBillBody,
	MastersIndiaEInvoiceGateway,
	MastersIndiaEWayBillGateway,
	type FetchLike,
} from '../src';

// A fake NIC server doing the real handshake: RSA sign-in, SEK under the app key, AES payloads.
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

const IRN = 'b'.repeat(64);
const QR = 'eyJhbGciOiJSUzI1NiJ9.eyJkYXRhIjoie30ifQ.sig';

function fakeIrp(opts: { duplicate?: boolean } = {}) {
	const sek = randomBytes(32);
	const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
	const fetch: FetchLike = async (url, init) => {
		const body = init.body ? (JSON.parse(init.body) as { Data?: string }) : undefined;
		calls.push({
			url,
			headers: init.headers,
			body:
				body?.Data && !url.endsWith('/auth')
					? JSON.parse(aesEcbDecrypt(sek, body.Data).toString('utf8'))
					: body,
		});
		const reply = (payload: unknown, status = 1) => ({
			status: 200,
			text: async () =>
				JSON.stringify(
					status ? { Status: 1, Data: aesEcbEncrypt(sek, Buffer.from(JSON.stringify(payload))) } : payload,
				),
		});
		if (url.endsWith('/eivital/v1.04/auth')) {
			const creds = rsaOpen(body!.Data!);
			const appKey = Buffer.from(String(creds['AppKey']), 'base64');
			return {
				status: 200,
				text: async () =>
					JSON.stringify({
						Status: 1,
						Data: {
							AuthToken: 'tok-1',
							Sek: aesEcbEncrypt(appKey, sek),
							TokenExpiry: '2026-11-23 23:00:00',
						},
					}),
			};
		}
		if (url.endsWith('/eicore/v1.03/Invoice')) {
			if (opts.duplicate)
				return {
					status: 200,
					text: async () =>
						JSON.stringify({
							Status: 0,
							ErrorDetails: [{ ErrorCode: '2150', ErrorMessage: 'Duplicate IRN' }],
						}),
				};
			return reply({
				AckNo: 112410123456789,
				AckDt: '2026-11-22 16:31:04',
				Irn: IRN,
				SignedInvoice: 'a.b.c',
				SignedQRCode: QR,
				Status: 'ACT',
				EwbNo: 34101234567890,
				EwbDt: '2026-11-22 16:33:00',
				EwbValidTill: '2026-12-02 23:59:00',
			});
		}
		if (url.includes('irnbydocdetails'))
			return reply({
				AckNo: 112410123450000,
				AckDt: '2026-11-22 16:00:00',
				Irn: IRN,
				SignedQRCode: QR,
				Status: 'ACT',
			});
		if (url.endsWith('/Invoice/Cancel')) return reply({ Irn: IRN, CancelDate: '2026-11-22 18:00:00' });
		if (url.includes('/Master/gstin/'))
			return reply({
				Gstin: '27AAKFR1234M1Z2',
				LegalName: 'Rang Mahal Boutique LLP',
				TradeName: 'Rang Mahal',
				StateCode: 27,
				AddrPncd: 400050,
				Status: 'ACT',
				BlkStatus: 'U',
			});
		return { status: 404, text: async () => '{}' };
	};
	return { fetch, calls };
}

const sale = (): EDocSale => ({
	documentType: 'taxInvoice',
	number: 'TI/26-27/000125',
	date: '2026-11-22',
	seller: {
		gstin: '19DBYPS6736R1ZZ',
		legalName: 'K.R. Marketing',
		line1: 'No. 29, KB Basu Road',
		city: 'Barasat',
		pin: '700124',
		stateCode: '19',
	},
	buyer: {
		gstin: '27AAKFR1234M1Z2',
		legalName: 'Rang Mahal Boutique LLP',
		line1: 'Shop 14, Linking Road',
		city: 'Mumbai',
		pin: '400050',
		stateCode: '27',
	},
	placeOfSupply: '27',
	supplyType: 'B2B',
	reverseCharge: false,
	lines: [
		{
			description: 'Banarasi saree',
			hsn: '5007',
			isService: false,
			qty: 1,
			unit: 'pc',
			unitPriceINR: 50000,
			grossINR: 50000,
			discountINR: 0,
			taxableINR: 50000,
			gstRatePercent: 5,
			igstINR: 2500,
			cgstINR: 0,
			sgstINR: 0,
			cessINR: 0,
			totalINR: 52500,
		},
	],
	totals: {
		taxableINR: 50000,
		cgstINR: 0,
		sgstINR: 0,
		igstINR: 2500,
		cessINR: 0,
		discountINR: 0,
		otherINR: 0,
		roundOffINR: 0,
		totalINR: 52500,
	},
});
const road = {
	mode: 'road' as const,
	vehicleNo: 'WB02AK4410',
	vehicleType: 'regular' as const,
	transporterId: null,
	transporterName: null,
	transportDocNo: null,
	transportDocDate: null,
	distanceKm: 1967,
};
const irpConfig = (fetch: FetchLike) => ({
	baseUrl: 'https://irp.example',
	clientId: 'cid',
	clientSecret: 'csecret',
	userName: 'api-user',
	password: 'pw',
	publicKeyPem: PEM,
	fetch,
	now: () => new Date('2026-11-22T10:00:00Z'),
});

describe('direct e-invoice (NIC-standard IRP)', () => {
	it('signs in with RSA, sends the invoice under the session key and reads the IRN back', async () => {
		const server = fakeIrp();
		const gateway = new IrpDirectEInvoiceGateway(irpConfig(server.fetch));
		const result = await gateway.generate('19DBYPS6736R1ZZ', buildEInvoiceJson(sale(), road));
		expect(result).toMatchObject({
			irn: IRN,
			ackNo: '112410123456789',
			ackDate: '2026-11-22T11:01:04.000Z',
			signedQr: QR,
			ewb: { number: '34101234567890', validUntil: '2026-12-02T18:29:00.000Z' },
		});
		// The server saw the real invoice JSON after decrypting, and our headers.
		const sent = server.calls.find((c) => c.url.endsWith('/Invoice'))!;
		expect(sent.headers).toMatchObject({
			client_id: 'cid',
			Gstin: '19DBYPS6736R1ZZ',
			user_name: 'api-user',
			AuthToken: 'tok-1',
		});
		expect(sent.body).toMatchObject({ Version: '1.1', DocDtls: { No: 'TI/26-27/000125' } });
		// The token is reused for the next call (one sign-in per session).
		await gateway.gstinDetails('19DBYPS6736R1ZZ', '27AAKFR1234M1Z2');
		expect(server.calls.filter((c) => c.url.endsWith('/auth'))).toHaveLength(1);
	});
	it('fetches the existing IRN when the IRP says duplicate (2150)', async () => {
		const server = fakeIrp({ duplicate: true });
		const result = await new IrpDirectEInvoiceGateway(irpConfig(server.fetch)).generate(
			'19DBYPS6736R1ZZ',
			buildEInvoiceJson(sale()),
		);
		expect(result.ackNo).toBe('112410123450000');
		expect(
			server.calls.some((c) => c.url.includes('doctype=INV&docnum=TI%2F26-27%2F000125&docdate=22%2F11%2F2026')),
		).toBe(true);
	});
	it('cancels with NIC’s reason code and reads GSTIN details', async () => {
		const server = fakeIrp();
		const gateway = new IrpDirectEInvoiceGateway(irpConfig(server.fetch));
		expect(await gateway.cancel('19DBYPS6736R1ZZ', IRN, 'dataEntryMistake', 'wrong branch')).toEqual({
			cancelledAt: '2026-11-22T12:30:00.000Z',
		});
		expect(server.calls.at(-1)!.body).toEqual({ Irn: IRN, CnlRsn: '2', CnlRem: 'wrong branch' });
		expect(await gateway.gstinDetails('19DBYPS6736R1ZZ', '27AAKFR1234M1Z2')).toMatchObject({
			status: 'active',
			stateCode: '27',
			blockedForEWayBill: false,
		});
	});
	it('turns a dead connection into “unavailable” (the by-hand popup takes over)', async () => {
		const down: FetchLike = async () => {
			throw new Error('ECONNREFUSED');
		};
		await expect(new IrpDirectEInvoiceGateway(irpConfig(down)).test('19DBYPS6736R1ZZ')).rejects.toBeInstanceOf(
			EDocUnavailableError,
		);
	});
});

describe('direct e-way bill (NIC e-way bill API v1.03)', () => {
	it('signs in, sends GENEWAYBILL as Base64 JSON under the session key, and reads the number back', async () => {
		const sek = randomBytes(32);
		let seen: { action?: string; json?: unknown } = {};
		const fetch: FetchLike = async (url, init) => {
			const body = JSON.parse(init.body!) as Record<string, string>;
			if (url.endsWith('/auth')) {
				const creds = rsaOpen(body['Data']!);
				expect(creds).toMatchObject({ action: 'ACCESSTOKEN', username: 'ewb-user' });
				return {
					status: 200,
					text: async () =>
						JSON.stringify({
							status: '1',
							authtoken: 'ewb-tok',
							sek: aesEcbEncrypt(Buffer.from(String(creds['app_key']), 'base64'), sek),
						}),
				};
			}
			seen = {
				action: body['action'],
				json: JSON.parse(
					Buffer.from(aesEcbDecrypt(sek, body['data']!).toString('utf8'), 'base64').toString('utf8'),
				),
			};
			const answer = Buffer.from(
				JSON.stringify({
					ewayBillNo: 34101234567890,
					ewayBillDate: '22/11/2026 04:33:00 PM',
					validUpto: '02/12/2026 11:59:00 PM',
				}),
			).toString('base64');
			return {
				status: 200,
				text: async () => JSON.stringify({ status: '1', data: aesEcbEncrypt(sek, Buffer.from(answer)) }),
			};
		};
		const gateway = new EwbDirectGateway({
			baseUrl: 'https://ewb.example',
			clientId: 'c',
			clientSecret: 's',
			userName: 'ewb-user',
			password: 'p',
			publicKeyPem: PEM,
			fetch,
		});
		const shopSale = { ...sale(), buyer: { ...sale().buyer, gstin: null } };
		const result = await gateway.generate('19DBYPS6736R1ZZ', buildEWayBillJson(shopSale, road));
		expect(result).toEqual({
			number: '34101234567890',
			generatedAt: '2026-11-22T11:03:00.000Z',
			validUntil: '2026-12-02T18:29:00.000Z',
			alert: null,
		});
		expect(seen).toMatchObject({
			action: 'GENEWAYBILL',
			json: { toGstin: 'URP', docNo: 'TI/26-27/000125', transDistance: '1967' },
		});
	});
	it('reports the e-way bill system’s error codes', async () => {
		const sek = randomBytes(32);
		const fetch: FetchLike = async (url, init) => {
			const body = JSON.parse(init.body!) as Record<string, string>;
			if (url.endsWith('/auth'))
				return {
					status: 200,
					text: async () =>
						JSON.stringify({
							status: '1',
							authtoken: 't',
							sek: aesEcbEncrypt(Buffer.from(String(rsaOpen(body['Data']!)['app_key']), 'base64'), sek),
						}),
				};
			return {
				status: 200,
				text: async () =>
					JSON.stringify({
						status: '0',
						error: Buffer.from(JSON.stringify({ errorCodes: '312,' })).toString('base64'),
					}),
			};
		};
		const gateway = new EwbDirectGateway({
			baseUrl: 'https://ewb.example',
			clientId: 'c',
			clientSecret: 's',
			userName: 'u',
			password: 'p',
			publicKeyPem: PEM,
			fetch,
		});
		await expect(gateway.cancel('19DBYPS6736R1ZZ', '341012345678', 'orderCancelled', 'x')).rejects.toMatchObject({
			code: '312',
		});
	});
});

describe('provider path (Masters India)', () => {
	const server = () => {
		const calls: { url: string; body?: Record<string, unknown> }[] = [];
		const fetch: FetchLike = async (url, init) => {
			const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
			calls.push({ url, body });
			if (url.endsWith('/oauth/access_token'))
				return {
					status: 200,
					text: async () =>
						JSON.stringify({ access_token: 'mi-tok', expires_in: 3600, token_type: 'bearer' }),
				};
			if (url.endsWith('/generateEinvoice'))
				return {
					status: 200,
					text: async () =>
						JSON.stringify({
							results: {
								message: {
									AckNo: 48100019285,
									AckDt: '2026-11-22 16:31:00',
									Irn: IRN,
									SignedQRCode: QR,
									Status: 'ACT',
								},
								errorMessage: '',
								status: 'Success',
								code: 200,
							},
						}),
				};
			if (url.endsWith('/ewayBillsGenerate'))
				return {
					status: 200,
					text: async () =>
						JSON.stringify({
							results: { message: 'Invalid Approximate Distance', status: 'No Content', code: 204 },
						}),
				};
			return { status: 404, text: async () => '{}' };
		};
		return { fetch, calls };
	};
	const config = (fetch: FetchLike) => ({
		baseUrl: 'https://mi.example',
		userName: 'u',
		password: 'p',
		clientId: 'c',
		clientSecret: 's',
		fetch,
	});
	it('maps our invoice to their body and reads the NIC-named answer', async () => {
		const s = server();
		const result = await new MastersIndiaEInvoiceGateway(config(s.fetch)).generate(
			'19DBYPS6736R1ZZ',
			buildEInvoiceJson(sale(), road),
		);
		expect(result).toMatchObject({ irn: IRN, ackNo: '48100019285', signedQr: QR });
		expect(s.calls[1]!.body).toMatchObject({
			access_token: 'mi-tok',
			user_gstin: '19DBYPS6736R1ZZ',
			document_details: { document_type: 'INV', document_number: 'TI/26-27/000125', document_date: '22/11/2026' },
			buyer_details: { gstin: '27AAKFR1234M1Z2', place_of_supply: '27' },
			ewaybill_details: { transportation_distance: 1967, vehicle_number: 'WB02AK4410' },
			item_list: [{ hsn_code: '5007', total_item_value: 52500 }],
		});
	});
	it('surfaces their e-way bill error text', async () => {
		const s = server();
		const error = await new MastersIndiaEWayBillGateway(config(s.fetch))
			.generate('19DBYPS6736R1ZZ', buildEWayBillJson(sale(), road))
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(EDocRefusedError);
		expect((error as EDocRefusedError).message).toBe('Invalid Approximate Distance');
		expect(mastersIndiaEWayBillBody('19DBYPS6736R1ZZ', buildEWayBillJson(sale(), road))).toMatchObject({
			supply_type: 'outward',
			document_type: 'tax invoice',
			transportation_mode: 'road',
			vehicle_type: 'Regular',
		});
	});
});

describe('by hand', () => {
	it('makes the e-invoice portal file and the e-way bill details to type', () => {
		expect(JSON.parse(eInvoicePortalFile(buildEInvoiceJson(sale())))).toHaveLength(1);
		const rows = eWayBillDetailsSheet(buildEWayBillJson(sale(), road));
		expect(rows.find((r) => r.label === 'Transport')?.value).toBe('Road · 1967 km');
		expect(rows.filter((r) => r.part === 'A').length).toBeGreaterThan(3);
	});
});
