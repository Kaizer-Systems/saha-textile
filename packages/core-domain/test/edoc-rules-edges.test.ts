import { describe, expect, it } from 'vitest';

import {
	buildEInvoiceJson,
	buildEWayBillJson,
	decodeSignedQr,
	eInvoiceNeeded,
	eInvoiceProblems,
	eWayBillCancelOpenUntil,
	eWayBillDetailsForIrp,
	eWayBillNeeded,
	eWayBillProblems,
	eWayBillValidUntil,
	fromGovDateTime,
	irnCancelOpenUntil,
	readSignedEInvoiceFile,
	uqcFor,
	type EDocParty,
	type EDocSale,
} from '../src/edocs/edoc-rules';

const seller: EDocParty = {
	gstin: '19DBYPS6736R1ZZ',
	legalName: 'K.R. Marketing',
	line1: 'No. 29, KB Basu Road',
	city: 'Barasat',
	pin: '700124',
	stateCode: '19',
};
const buyer: EDocParty = {
	gstin: '27AAKFR1234M1Z2',
	legalName: 'Rang Mahal Boutique LLP',
	line1: 'Shop 14',
	city: 'Mumbai',
	pin: '400050',
	stateCode: '27',
};
const line = (over: Partial<EDocSale['lines'][number]> = {}): EDocSale['lines'][number] => ({
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
	...over,
});
const sale = (over: Partial<EDocSale> = {}): EDocSale => ({
	documentType: 'taxInvoice',
	number: 'TI/26-27/000125',
	date: '2026-11-22',
	seller,
	buyer,
	placeOfSupply: '27',
	supplyType: 'B2B',
	reverseCharge: false,
	lines: [line()],
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
	...over,
});
const road = {
	mode: 'road' as const,
	vehicleNo: 'wb 02 ak 4410',
	vehicleType: 'regular' as const,
	transporterId: null,
	transporterName: null,
	transportDocNo: null,
	transportDocDate: null,
	distanceKm: 120,
};
const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jws = (data: unknown) => `h.${b64url({ data })}.s`;

describe('government dates and windows', () => {
	it('reads both NIC date styles, with or without seconds, and 12 AM as midnight', () => {
		expect(fromGovDateTime('')).toBeNull();
		expect(fromGovDateTime('2026-11-22 16:31')).toBe('2026-11-22T11:01:00.000Z');
		expect(fromGovDateTime('22/11/2026 12:05 AM')).toBe('2026-11-21T18:35:00.000Z');
		expect(fromGovDateTime('22/11/2026 12:05 PM')).toBe('2026-11-22T06:35:00.000Z');
		expect(fromGovDateTime('22/11/2026 16:05')).toBe('2026-11-22T10:35:00.000Z');
		expect(fromGovDateTime('next Tuesday')).toBeNull();
	});

	it('gives over-dimension cargo a day per 20 km, and opens cancelling for 24 hours', () => {
		expect(eWayBillValidUntil('2026-11-22T05:00:00Z', 40, true)).toBe('2026-11-24T18:29:59.000Z');
		expect(irnCancelOpenUntil('2026-11-22T05:00:00.000Z')).toBe('2026-11-23T05:00:00.000Z');
		expect(eWayBillCancelOpenUntil('2026-11-22T05:00:00.000Z')).toBe('2026-11-23T05:00:00.000Z');
		expect(uqcFor('  Bale ')).toBe('OTH');
	});
});

describe('the e-invoice JSON', () => {
	it('carries the optional party fields, reverse charge, services, dispatch, ship-to and full Part B', () => {
		const full = {
			...seller,
			tradeName: 'Saha Textile',
			line2: 'Near the station',
			phone: '+91 98300 12345',
			email: 'a@b.co',
		};
		const json = buildEInvoiceJson(
			sale({
				seller: full,
				reverseCharge: true,
				lines: [line({ isService: true })],
				dispatchFrom: { ...full, line2: 'Godown 2' },
				shipTo: buyer,
			}),
			{
				...road,
				transporterId: '19AAAAA1111A1Z1',
				transporterName: 'Fast Lines',
				transportDocNo: 'LR-9',
				transportDocDate: '2026-11-22',
				vehicleType: 'overDimension',
			},
		);
		expect(json).toMatchObject({
			TranDtls: { RegRev: 'Y' },
			SellerDtls: { TrdNm: 'Saha Textile', Addr2: 'Near the station', Ph: '919830012345', Em: 'a@b.co' },
			DispDtls: { Addr2: 'Godown 2' },
			ShipDtls: { LglNm: 'Rang Mahal Boutique LLP' },
			ItemList: [{ IsServc: 'Y' }],
			EwbDtls: {
				TransId: '19AAAAA1111A1Z1',
				TransName: 'Fast Lines',
				TransDocNo: 'LR-9',
				TransDocDt: '22/11/2026',
				VehType: 'O',
			},
		});
	});

	it('leaves the transport mode out of Part B without a vehicle or a document, and refuses a type the IRP does not take', () => {
		const json = buildEInvoiceJson(sale({ dispatchFrom: seller }), { ...road, vehicleNo: null });
		expect(json['EwbDtls']).not.toHaveProperty('TransMode');
		expect(json['DispDtls']).not.toHaveProperty('Addr2');
		expect(eWayBillDetailsForIrp({ ...road, vehicleNo: null })).not.toHaveProperty('VehNo');
		expect(() => buildEInvoiceJson(sale({ documentType: 'deliveryChallan' }))).toThrow(
			'edoc_document_type_not_einvoiced',
		);
	});
});

describe('the e-way bill JSON', () => {
	it('names the transaction type from bill-to and dispatch-from, and a challan as CHL', () => {
		const type = (over: Partial<EDocSale>) => buildEWayBillJson(sale(over), road)['transactionType'];
		expect(type({})).toBe(1);
		expect(type({ shipTo: buyer })).toBe(2);
		expect(type({ dispatchFrom: seller })).toBe(3);
		expect(type({ shipTo: buyer, dispatchFrom: seller })).toBe(4);
		expect(buildEWayBillJson(sale({ documentType: 'deliveryChallan' }), road)['docType']).toBe('CHL');
	});

	it('describes an “others” supply, an unregistered seller, a move without Part B, and an intra-state sale', () => {
		const json = buildEWayBillJson(
			sale({ seller: { ...seller, gstin: null }, placeOfSupply: '19' }),
			{ ...road, vehicleNo: null },
			{ subSupply: 'others' },
		);
		expect(json).toMatchObject({
			subSupplyDesc: '',
			fromGstin: 'URP',
			transDocNo: '',
			transMode: '',
			vehicleNo: '',
			vehicleType: '',
			itemList: [{ cgstRate: 2.5, sgstRate: 2.5, igstRate: 0 }],
		});
		const described = buildEWayBillJson(
			sale(),
			{ ...road, vehicleType: 'overDimension', transportDocNo: 'LR', transportDocDate: '2026-11-22' },
			{
				subSupply: 'others',
				subSupplyDesc: 'Sample sent for a fitting',
			},
		);
		expect(described).toMatchObject({
			subSupplyDesc: 'Sample sent for a fi',
			vehicleType: 'O',
			transDocNo: 'LR',
			transDocDate: '22/11/2026',
		});
	});
});

describe('what the IRP and the e-way bill system would refuse', () => {
	const today = { enabledFrom: '2025-04-01', todayIst: '2026-11-23' };

	it('lists every e-invoice problem once', () => {
		const problems = eInvoiceProblems(
			sale({
				documentType: 'deliveryChallan',
				number: '0bad number',
				date: '2025-01-01',
				buyer: { ...buyer, gstin: null },
				seller: { ...seller, stateCode: '27' },
				lines: [line({ hsn: '12', unit: '', qty: 0, totalINR: 1 })],
			}),
			{ enabledFrom: null, todayIst: '2026-11-23' },
		);
		expect(problems).toEqual(
			expect.arrayContaining([
				'einvoice_not_enabled',
				'einvoice_document_type',
				'einvoice_buyer_needs_gstin',
				'doc_number_shape',
				'doc_date_too_old',
				'gstin_state_mismatch',
				'hsn_digits',
				'unit_needed_for_goods',
				'invoice_total_mismatch',
			]),
		);
		expect(eInvoiceProblems(sale({ date: '2026-12-01' }), today)).toContain('doc_date_in_future');
		expect(eInvoiceProblems(sale({ lines: Array.from({ length: 1001 }, () => line()) }), today)).toContain(
			'too_many_items',
		);
		expect(eInvoiceProblems(sale({ lines: [line({ igstINR: 1 })] }), today)).toContain('item_value_mismatch');
		expect(eInvoiceProblems(sale({ supplyType: 'EXPWP', buyer: { ...buyer, stateCode: '96' } }), today)).toEqual(
			[],
		);
	});

	it('lists every e-way bill problem once', () => {
		const ctx = { thresholdINR: 50000, todayIst: '2026-11-23', eInvoiceEnabled: true, viaIrn: false };
		expect(
			eWayBillProblems(
				sale({
					number: '0bad',
					date: '2026-01-01',
					lines: [line({ isService: true })],
					totals: { ...sale().totals, totalINR: 100 },
				}),
				{ ...road, distanceKm: 5000, vehicleNo: null },
				ctx,
			),
		).toEqual(
			expect.arrayContaining([
				'ewb_below_threshold',
				'ewb_goods_needed',
				'ewb_too_late',
				'doc_number_shape',
				'ewb_distance',
				'ewb_part_b_needed',
				'ewb_use_einvoice_path',
			]),
		);
		expect(eWayBillProblems(sale({ lines: Array.from({ length: 251 }, () => line()) }), null, ctx)).toEqual(
			expect.arrayContaining(['ewb_too_many_items', 'ewb_part_b_needed']),
		);
		const rail = { ...road, mode: 'rail' as const, vehicleNo: null, transportDocNo: 'RR-1' };
		expect(
			eWayBillProblems(sale({ documentType: 'deliveryChallan', buyer: { ...buyer, gstin: null } }), rail, ctx),
		).toEqual([]);
		expect(
			eWayBillProblems(
				sale({ supplyType: 'EXPWP', buyer: { ...buyer, gstin: null } }),
				{ ...road, vehicleNo: null, transporterId: 'T' },
				ctx,
			),
		).toEqual(['ewb_use_einvoice_path']);
	});

	it('knows when each document is needed at all', () => {
		expect(eWayBillNeeded(sale({ lines: [line({ isService: true })] }), 1)).toBe(false);
		expect(eWayBillNeeded(sale(), 100000)).toBe(false);
		expect(eWayBillNeeded(sale(), 50000)).toBe(true);
		expect(eInvoiceNeeded(sale(), null)).toBe(false);
		expect(eInvoiceNeeded(sale(), '2027-01-01')).toBe(false);
		expect(eInvoiceNeeded(sale({ documentType: 'deliveryChallan' }), '2025-04-01')).toBe(false);
		expect(eInvoiceNeeded(sale(), '2025-04-01')).toBe(true);
		expect(eInvoiceNeeded(sale({ buyer: { ...buyer, gstin: null } }), '2025-04-01')).toBe(false);
		expect(eInvoiceNeeded(sale({ buyer: { ...buyer, gstin: null }, supplyType: 'EXPWOP' }), '2025-04-01')).toBe(
			true,
		);
	});
});

describe('signed QR codes and the portal’s e-invoice file', () => {
	const IRN = 'A'.repeat(64);
	const qr = (data: Record<string, unknown>) =>
		jws({
			SellerGstin: seller.gstin,
			BuyerGstin: buyer.gstin,
			DocNo: 'TI/26-27/000125',
			DocTyp: 'INV',
			DocDt: '22/11/2026',
			TotInvVal: 52500,
			...data,
		});

	it('reads a QR whose data is a string or an object, and nothing else', () => {
		expect(decodeSignedQr('only.two')).toBeNull();
		expect(decodeSignedQr(`h.${b64url({ data: JSON.stringify({ Irn: 'x' }) })}.s`)).toEqual({ Irn: 'x' });
		expect(decodeSignedQr(jws({ Irn: 'y' }))).toEqual({ Irn: 'y' });
		expect(decodeSignedQr(jws(5))).toBeNull();
		expect(decodeSignedQr('h.!!!.s')).toBeNull();
	});

	it('takes the IRN from a wrapped answer in a list, with dates from the file or the QR', () => {
		const file = JSON.stringify([
			{ nothing: true },
			{
				data: {
					irn: IRN,
					SignedQRCode: qr({ IrnDt: '2026-11-22 16:00:00' }),
					ackNo: '9',
					EwbNo: '341',
					EwbDt: '2026-11-22 17:00:00',
				},
			},
		]);
		const read = readSignedEInvoiceFile(file, sale());
		expect(read).toMatchObject({
			ok: true,
			value: {
				irn: 'a'.repeat(64),
				ackNo: '9',
				ackDate: '2026-11-22T10:30:00.000Z',
				ewb: { number: '341', validUntil: null },
			},
		});
		const bare = readSignedEInvoiceFile(JSON.stringify({ Irn: IRN, SignedQRCode: 'not.a-jws.x' }), sale());
		expect(bare).toMatchObject({
			ok: true,
			value: { ackNo: '', ackDate: new Date(0).toISOString(), ewb: null, signedInvoice: null },
		});
	});

	it('says the file holds no IRN when no entry has one', () => {
		expect(readSignedEInvoiceFile(JSON.stringify([{ AckNo: 1 }, { Data: { Status: 'ACT' } }]), sale())).toEqual({
			ok: false,
			problem: 'no_irn',
		});
		expect(readSignedEInvoiceFile('{', sale())).toEqual({ ok: false, problem: 'not_json' });
	});

	it('refuses a file without a signed QR, or one for another document, seller, buyer or total', () => {
		const one = (signedQr: string | null) =>
			readSignedEInvoiceFile(JSON.stringify({ Irn: IRN, SignedQRCode: signedQr }), sale());
		expect(one(null)).toEqual({ ok: false, problem: 'no_signed_qr' });
		expect(one(qr({ DocTyp: 'CRN' }))).toEqual({ ok: false, problem: 'other_document' });
		expect(one(qr({ DocDt: '01/01/2026' }))).toEqual({ ok: false, problem: 'other_document' });
		expect(one(qr({ SellerGstin: '29AAAAA0000A1Z5' }))).toEqual({ ok: false, problem: 'other_seller' });
		expect(one(qr({ BuyerGstin: 'URP' }))).toEqual({ ok: false, problem: 'other_buyer' });
		expect(
			readSignedEInvoiceFile(
				JSON.stringify({ Irn: IRN, SignedQRCode: qr({ BuyerGstin: 'URP' }) }),
				sale({ buyer: { ...buyer, gstin: null } }),
			),
		).toMatchObject({ ok: true });
		expect(one(qr({ TotInvVal: 1 }))).toEqual({ ok: false, problem: 'other_total' });
		expect(
			one(
				qr({
					SellerGstin: undefined,
					BuyerGstin: undefined,
					DocNo: undefined,
					DocTyp: undefined,
					DocDt: undefined,
					TotInvVal: undefined,
				}),
			),
		).toMatchObject({
			ok: true,
		});
	});
});
