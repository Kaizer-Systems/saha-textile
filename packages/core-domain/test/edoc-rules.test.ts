import { describe, expect, it } from 'vitest';

import {
	buildEInvoiceJson,
	buildEWayBillJson,
	decodeSignedQr,
	eInvoiceProblems,
	eWayBillProblems,
	eWayBillValidUntil,
	eWayBillExtendOpen,
	fromGovDateTime,
	readSignedEInvoiceFile,
	withinGovTolerance,
	type EDocSale,
} from '../src/edocs/edoc-rules';

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
			unitPriceINR: 14057.14,
			grossINR: 14057.14,
			discountINR: 0,
			taxableINR: 14057.14,
			gstRatePercent: 5,
			igstINR: 702.86,
			cgstINR: 0,
			sgstINR: 0,
			cessINR: 0,
			totalINR: 14760,
		},
		{
			description: 'Gift box',
			hsn: '4819',
			isService: false,
			qty: 1,
			unit: 'pc',
			unitPriceINR: 211.86,
			grossINR: 211.86,
			discountINR: 0,
			taxableINR: 211.86,
			gstRatePercent: 18,
			igstINR: 38.14,
			cgstINR: 0,
			sgstINR: 0,
			cessINR: 0,
			totalINR: 250,
		},
	],
	totals: {
		taxableINR: 14269,
		cgstINR: 0,
		sgstINR: 0,
		igstINR: 741,
		cessINR: 0,
		discountINR: 0,
		otherINR: 0,
		roundOffINR: 0,
		totalINR: 15010,
	},
});
const road = {
	mode: 'road' as const,
	vehicleNo: 'wb 02 ak 4410',
	vehicleType: 'regular' as const,
	transporterId: null,
	transporterName: null,
	transportDocNo: null,
	transportDocDate: null,
	distanceKm: 1967,
};
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('e-invoice JSON (INV-01 v1.1)', () => {
	it('maps our invoice to the IRP schema, with Part B as EwbDtls', () => {
		expect(buildEInvoiceJson(sale(), road)).toMatchObject({
			Version: '1.1',
			TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' },
			DocDtls: { Typ: 'INV', No: 'TI/26-27/000125', Dt: '22/11/2026' },
			BuyerDtls: { Pos: '27' },
			ItemList: [
				{
					SlNo: '1',
					HsnCd: '5007',
					IsServc: 'N',
					Unit: 'PCS',
					AssAmt: 14057.14,
					IgstAmt: 702.86,
					TotItemVal: 14760,
				},
				{},
			],
			ValDtls: { TotInvVal: 15010 },
			EwbDtls: { Distance: 1967, TransMode: '1', VehNo: 'WB02AK4410', VehType: 'R' },
		});
	});
	it('sends an export to the IRP with URP, state 96 and PIN 999999', () => {
		const json = buildEInvoiceJson({
			...sale(),
			supplyType: 'EXPWOP',
			buyer: { ...sale().buyer, gstin: null },
		});
		expect(json).toMatchObject({ BuyerDtls: { Gstin: 'URP', Stcd: '96', Pin: 999999, Pos: '96' } });
	});
});

describe('checks before sending', () => {
	it('refuses a GSTIN that is not enabled, and a shopper without a GSTIN', () => {
		expect(eInvoiceProblems(sale(), { enabledFrom: null, todayIst: '2026-11-23' })).toContain(
			'einvoice_not_enabled',
		);
		const b2c = { ...sale(), buyer: { ...sale().buyer, gstin: null } };
		expect(eInvoiceProblems(b2c, { enabledFrom: '2026-04-01', todayIst: '2026-11-23' })).toContain(
			'einvoice_buyer_needs_gstin',
		);
		expect(eInvoiceProblems(sale(), { enabledFrom: '2026-04-01', todayIst: '2026-11-23' })).toEqual([]);
	});
	it('uses the government tolerance (one rupee either side of the rounded value)', () => {
		expect(withinGovTolerance(2344, 2345.04)).toBe(true);
		expect(withinGovTolerance(2347, 2345.04)).toBe(true);
		expect(withinGovTolerance(2343.99, 2345.04)).toBe(false);
		const bad = sale();
		bad.lines[0]!.igstINR = 650;
		expect(eInvoiceProblems(bad, { enabledFrom: '2026-04-01', todayIst: '2026-11-23' })).toContain(
			'item_value_mismatch',
		);
	});
	it('sends an enabled GSTIN’s business invoice through the IRN path for its e-way bill', () => {
		const ctx = { thresholdINR: 50_000, todayIst: '2026-11-23', eInvoiceEnabled: true, viaIrn: false };
		expect(eWayBillProblems(sale(), road, ctx)).toEqual(
			expect.arrayContaining(['ewb_below_threshold', 'ewb_use_einvoice_path']),
		);
		expect(eWayBillProblems(sale(), road, { ...ctx, thresholdINR: 10_000, eInvoiceEnabled: false })).toEqual([]);
		expect(
			eWayBillProblems(
				sale(),
				{ ...road, vehicleNo: null },
				{ ...ctx, thresholdINR: 10_000, eInvoiceEnabled: false },
			),
		).toEqual(['ewb_part_b_needed']);
	});
});

describe('e-way bill JSON and windows', () => {
	it('builds GENEWAYBILL for a shop parcel: URP buyer, IGST rates, string distance', () => {
		const json = buildEWayBillJson({ ...sale(), buyer: { ...sale().buyer, gstin: null } }, road);
		expect(json).toMatchObject({
			supplyType: 'O',
			subSupplyType: '1',
			docType: 'INV',
			docDate: '22/11/2026',
			toGstin: 'URP',
			fromStateCode: 19,
			toStateCode: 27,
			transactionType: 1,
			transMode: '1',
			transDistance: '1967',
			vehicleNo: 'WB02AK4410',
			totInvValue: 15010,
		});
		expect(json).toMatchObject({ itemList: [{}, { hsnCode: 4819, igstRate: 18, cgstRate: 0, qtyUnit: 'PCS' }] });
	});
	it('counts validity in days of 200 km ending at Indian midnight', () => {
		// Generated 22 Nov, 4:33 pm IST; 1,967 km = 10 days → 2 Dec, 11:59:59 pm IST.
		expect(eWayBillValidUntil('2026-11-22T11:03:00.000Z', 1967)).toBe('2026-12-02T18:29:59.000Z');
		expect(eWayBillValidUntil('2026-11-22T11:03:00.000Z', 150)).toBe('2026-11-23T18:29:59.000Z');
		expect(eWayBillExtendOpen('2026-12-02T18:29:59.000Z', '2026-12-02T12:00:00.000Z')).toBe(true);
		expect(eWayBillExtendOpen('2026-12-02T18:29:59.000Z', '2026-12-02T08:00:00.000Z')).toBe(false);
	});
	it('reads the government date-times as Indian time', () => {
		expect(fromGovDateTime('2026-11-22 16:31:04')).toBe('2026-11-22T11:01:04.000Z');
		expect(fromGovDateTime('22/11/2026 04:33:00 PM')).toBe('2026-11-22T11:03:00.000Z');
	});
});

describe('the portal’s signed file (by hand)', () => {
	const qr = (data: object) =>
		`${b64url({ alg: 'RS256' })}.${b64url({ data: JSON.stringify(data), iss: 'NIC' })}.sig`;
	const irn = 'a'.repeat(64);
	it('reads the IRN, acknowledgement and signed QR, and checks they are this invoice', () => {
		const signedQr = qr({
			SellerGstin: '19DBYPS6736R1ZZ',
			BuyerGstin: '27AAKFR1234M1Z2',
			DocNo: 'TI/26-27/000125',
			DocTyp: 'INV',
			DocDt: '22/11/2026',
			TotInvVal: 15010,
			Irn: irn,
		});
		expect(decodeSignedQr(signedQr)?.DocNo).toBe('TI/26-27/000125');
		const file = JSON.stringify([
			{
				AckNo: 112410123456789,
				AckDt: '2026-11-22 16:31:04',
				Irn: irn.toUpperCase(),
				SignedQRCode: signedQr,
				SignedInvoice: 'x.y.z',
			},
		]);
		const read = readSignedEInvoiceFile(file, sale());
		expect(read).toEqual({
			ok: true,
			value: expect.objectContaining({
				irn,
				ackNo: '112410123456789',
				ackDate: '2026-11-22T11:01:04.000Z',
				signedQr,
			}),
		});
	});
	it('refuses another invoice’s file', () => {
		const signedQr = qr({ DocNo: 'TI/26-27/000124', DocTyp: 'INV', DocDt: '22/11/2026' });
		expect(
			readSignedEInvoiceFile(JSON.stringify({ Irn: irn, AckNo: '1', SignedQRCode: signedQr }), sale()),
		).toEqual({ ok: false, problem: 'other_document' });
		expect(readSignedEInvoiceFile('not json', sale())).toEqual({ ok: false, problem: 'not_json' });
	});
});
