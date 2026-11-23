import type { EDocDocumentType, EWayBillPartB } from '@saha-textile/contracts';

import { istDay } from '../purchasing/fiscal-year';

/**
 * E-invoice and e-way bill rules (accounts brief addendum 2; owner 23 Nov 2026). Pure: the API builds the
 * government JSON with them for every path (by hand, direct, provider), and checks a document before it is sent.
 * Field names follow NIC's e-invoice schema INV-01 v1.1 (API v1.03) and the e-way bill API v1.03.
 */

export interface EDocParty {
	/** Null for an unregistered party (sent as "URP"). */
	gstin: string | null;
	legalName: string;
	tradeName?: string | null;
	line1: string;
	line2?: string | null;
	city: string;
	pin: string;
	stateCode: string;
	phone?: string | null;
	email?: string | null;
}

export interface EDocLine {
	description: string;
	hsn: string;
	isService: boolean;
	qty: number;
	/** Our unit ('pc', 'm', 'set'…); mapped to the government's UQC. */
	unit: string;
	unitPriceINR: number;
	grossINR: number;
	discountINR: number;
	taxableINR: number;
	gstRatePercent: number;
	igstINR: number;
	cgstINR: number;
	sgstINR: number;
	cessINR: number;
	totalINR: number;
}

export type GovSupplyType = 'B2B' | 'SEZWP' | 'SEZWOP' | 'EXPWP' | 'EXPWOP' | 'DEXP';

export interface EDocSale {
	documentType: EDocDocumentType;
	number: string;
	/** YYYY-MM-DD. */
	date: string;
	seller: EDocParty;
	buyer: EDocParty;
	placeOfSupply: string;
	shipTo?: EDocParty | null;
	dispatchFrom?: EDocParty | null;
	supplyType: GovSupplyType;
	reverseCharge: boolean;
	lines: EDocLine[];
	totals: {
		taxableINR: number;
		cgstINR: number;
		sgstINR: number;
		igstINR: number;
		cessINR: number;
		discountINR: number;
		otherINR: number;
		roundOffINR: number;
		totalINR: number;
	};
}

const r2 = (value: number): number => Math.round(value * 100) / 100;

/** 2026-11-22 → 22/11/2026 (the government's date format). */
export function toGovDate(isoDate: string): string {
	const [y, m, d] = isoDate.slice(0, 10).split('-');
	return `${d}/${m}/${y}`;
}

const IST_MINUTES = 330;

/**
 * The government's date-times are Indian time: "2026-11-22 16:31:04" (e-invoice) or
 * "22/11/2026 04:31:00 PM" / "22/11/2026 16:31:00" (e-way bill). Returns ISO (UTC) or null.
 */
export function fromGovDateTime(value: string | null | undefined): string | null {
	if (!value) return null;
	const text = value.trim().replace(/\s+/g, ' ');
	let y: number, mo: number, d: number, h: number, mi: number, s: number;
	let match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
	if (match) {
		[y, mo, d, h, mi, s] = [+match[1]!, +match[2]!, +match[3]!, +match[4]!, +match[5]!, +(match[6] ?? 0)];
	} else {
		match = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?(?: ?([AP]M))?$/i.exec(text);
		if (!match) return null;
		[d, mo, y, h, mi, s] = [+match[1]!, +match[2]!, +match[3]!, +match[4]!, +match[5]!, +(match[6] ?? 0)];
		const half = match[7]?.toUpperCase();
		if (half === 'PM' && h < 12) h += 12;
		if (half === 'AM' && h === 12) h = 0;
		// "23:59:00 PM" in the examples: a 24-hour time with a stray suffix stays as it is.
	}
	const utc = Date.UTC(y, mo - 1, d, h, mi, s) - IST_MINUTES * 60_000;
	return Number.isNaN(utc) ? null : new Date(utc).toISOString();
}

/**
 * An e-way bill's validity (Rule 138(10)): one day per 200 km (20 km for over-dimensional cargo), each day
 * ending at midnight; the first day ends at the midnight after the date of generation.
 */
export function eWayBillValidUntil(generatedAtIso: string, distanceKm: number, overDimension = false): string {
	const per = overDimension ? 20 : 200;
	const days = Math.max(1, Math.ceil(Math.max(distanceKm, 1) / per));
	const [y, m, d] = istDay(generatedAtIso).split('-').map(Number) as [number, number, number];
	const end = Date.UTC(y, m - 1, d + days, 23, 59, 59) - IST_MINUTES * 60_000;
	return new Date(end).toISOString();
}

const HOUR = 3_600_000;
/** An IRN can be cancelled within 24 hours of its acknowledgement (and only with no active e-way bill). */
export const irnCancelOpenUntil = (ackDateIso: string): string =>
	new Date(new Date(ackDateIso).getTime() + 24 * HOUR).toISOString();
/** An e-way bill can be cancelled by its generator within 24 hours. */
export const eWayBillCancelOpenUntil = (generatedAtIso: string): string =>
	new Date(new Date(generatedAtIso).getTime() + 24 * HOUR).toISOString();
/** Validity can be extended from 8 hours before to 8 hours after it ends. */
export function eWayBillExtendOpen(validUntilIso: string, nowIso: string): boolean {
	const end = new Date(validUntilIso).getTime();
	const now = new Date(nowIso).getTime();
	return now >= end - 8 * HOUR && now <= end + 8 * HOUR;
}

/** Government unit codes (UQC) for our units. */
const UQC: Record<string, string> = {
	pc: 'PCS',
	pcs: 'PCS',
	piece: 'PCS',
	m: 'MTR',
	mtr: 'MTR',
	metre: 'MTR',
	set: 'SET',
	box: 'BOX',
	pair: 'PRS',
	kg: 'KGS',
	g: 'GMS',
	nos: 'NOS',
};
export const uqcFor = (unit: string): string => UQC[unit.trim().toLowerCase()] ?? 'OTH';

const GOV_DOC_TYPE: Partial<Record<EDocDocumentType, 'INV' | 'CRN' | 'DBN'>> = {
	taxInvoice: 'INV',
	creditNote: 'CRN',
	debitNote: 'DBN',
};

const party = (p: EDocParty) => ({
	Gstin: p.gstin ?? 'URP',
	LglNm: p.legalName.slice(0, 100),
	...(p.tradeName ? { TrdNm: p.tradeName.slice(0, 100) } : {}),
	Addr1: p.line1.slice(0, 100),
	...(p.line2 ? { Addr2: p.line2.slice(0, 100) } : {}),
	Loc: p.city.slice(0, 50),
	Pin: Number(p.pin),
	Stcd: p.stateCode,
	...(p.phone ? { Ph: p.phone.replace(/\D/g, '').slice(-12) } : {}),
	...(p.email ? { Em: p.email.slice(0, 100) } : {}),
});

const TRANS_MODE: Record<EWayBillPartB['mode'], string> = {
	road: '1',
	rail: '2',
	air: '3',
	ship: '4',
	inTransit: '5',
	metroRail: '6',
};
export const govTransMode = (mode: EWayBillPartB['mode']): string => TRANS_MODE[mode];

/** The e-invoice JSON (INV-01 v1.1) for the IRP; with Part B, the e-way bill is made in the same call. */
export function buildEInvoiceJson(sale: EDocSale, partB?: EWayBillPartB | null): Record<string, unknown> {
	const typ = GOV_DOC_TYPE[sale.documentType];
	if (!typ) throw new Error('edoc_document_type_not_einvoiced');
	const exportSale = sale.supplyType.startsWith('EXP');
	const json: Record<string, unknown> = {
		Version: '1.1',
		TranDtls: { TaxSch: 'GST', SupTyp: sale.supplyType, RegRev: sale.reverseCharge ? 'Y' : 'N', IgstOnIntra: 'N' },
		DocDtls: { Typ: typ, No: sale.number, Dt: toGovDate(sale.date) },
		SellerDtls: party(sale.seller),
		BuyerDtls: {
			...party(exportSale ? { ...sale.buyer, gstin: null, pin: '999999', stateCode: '96' } : sale.buyer),
			Pos: exportSale ? '96' : sale.placeOfSupply,
		},
		ItemList: sale.lines.map((line, index) => ({
			SlNo: String(index + 1),
			PrdDesc: line.description.slice(0, 300),
			IsServc: line.isService ? 'Y' : 'N',
			HsnCd: line.hsn,
			Qty: line.qty,
			Unit: uqcFor(line.unit),
			UnitPrice: r2(line.unitPriceINR),
			TotAmt: r2(line.grossINR),
			Discount: r2(line.discountINR),
			AssAmt: r2(line.taxableINR),
			GstRt: line.gstRatePercent,
			IgstAmt: r2(line.igstINR),
			CgstAmt: r2(line.cgstINR),
			SgstAmt: r2(line.sgstINR),
			CesAmt: r2(line.cessINR),
			TotItemVal: r2(line.totalINR),
		})),
		ValDtls: {
			AssVal: r2(sale.totals.taxableINR),
			CgstVal: r2(sale.totals.cgstINR),
			SgstVal: r2(sale.totals.sgstINR),
			IgstVal: r2(sale.totals.igstINR),
			CesVal: r2(sale.totals.cessINR),
			Discount: r2(sale.totals.discountINR),
			OthChrg: r2(sale.totals.otherINR),
			RndOffAmt: r2(sale.totals.roundOffINR),
			TotInvVal: r2(sale.totals.totalINR),
		},
	};
	if (sale.dispatchFrom) {
		const p = party(sale.dispatchFrom);
		json['DispDtls'] = {
			Nm: p.LglNm,
			Addr1: p.Addr1,
			...(p.Addr2 ? { Addr2: p.Addr2 } : {}),
			Loc: p.Loc,
			Pin: p.Pin,
			Stcd: p.Stcd,
		};
	}
	if (sale.shipTo) json['ShipDtls'] = party(sale.shipTo);
	if (partB) json['EwbDtls'] = eWayBillDetailsForIrp(partB);
	return json;
}

/** Part B as the IRP's EwbDtls / EWB-by-IRN fields. A transporter ID alone makes Part A only. */
export function eWayBillDetailsForIrp(partB: EWayBillPartB): Record<string, unknown> {
	return {
		Distance: partB.distanceKm,
		...(partB.transporterId ? { TransId: partB.transporterId } : {}),
		...(partB.transporterName ? { TransName: partB.transporterName.slice(0, 100) } : {}),
		...(partB.vehicleNo || partB.transportDocNo ? { TransMode: govTransMode(partB.mode) } : {}),
		...(partB.transportDocNo ? { TransDocNo: partB.transportDocNo } : {}),
		...(partB.transportDocDate ? { TransDocDt: toGovDate(partB.transportDocDate) } : {}),
		...(partB.vehicleNo
			? {
					VehNo: partB.vehicleNo.replace(/\s+/g, '').toUpperCase(),
					VehType: partB.vehicleType === 'overDimension' ? 'O' : 'R',
				}
			: {}),
	};
}

/** Sub-supply types of the e-way bill system (code list). */
export type EWayBillSubSupply = 'supply' | 'export' | 'jobWork' | 'ownUse' | 'salesReturn' | 'exhibition' | 'others';
const SUB_SUPPLY: Record<EWayBillSubSupply, string> = {
	supply: '1',
	export: '3',
	jobWork: '4',
	ownUse: '5',
	salesReturn: '7',
	others: '8',
	exhibition: '12',
};

/** The e-way bill JSON (GENEWAYBILL, API v1.03) for a document without an IRN: shop parcels, transfers, challans. */
export function buildEWayBillJson(
	sale: EDocSale,
	partB: EWayBillPartB,
	options: { subSupply?: EWayBillSubSupply; subSupplyDesc?: string } = {},
): Record<string, unknown> {
	const subSupply = options.subSupply ?? 'supply';
	const ship = sale.shipTo ?? sale.buyer;
	const from = sale.dispatchFrom ?? sale.seller;
	const billToShip = !!sale.shipTo;
	const dispatchFrom = !!sale.dispatchFrom;
	const transactionType = billToShip && dispatchFrom ? 4 : billToShip ? 2 : dispatchFrom ? 3 : 1;
	const docType = sale.documentType === 'deliveryChallan' ? 'CHL' : 'INV';
	const interState = sale.seller.stateCode !== sale.placeOfSupply;
	return {
		supplyType: 'O',
		subSupplyType: SUB_SUPPLY[subSupply],
		subSupplyDesc: subSupply === 'others' ? (options.subSupplyDesc ?? '').slice(0, 20) : '',
		docType,
		docNo: sale.number,
		docDate: toGovDate(sale.date),
		fromGstin: sale.seller.gstin ?? 'URP',
		fromTrdName: (sale.seller.tradeName || sale.seller.legalName).slice(0, 100),
		fromAddr1: from.line1.slice(0, 120),
		fromAddr2: (from.line2 ?? '').slice(0, 120),
		fromPlace: from.city.slice(0, 50),
		fromPincode: Number(from.pin),
		fromStateCode: Number(sale.seller.stateCode),
		actFromStateCode: Number(from.stateCode),
		toGstin: sale.buyer.gstin ?? 'URP',
		toTrdName: (sale.buyer.tradeName || sale.buyer.legalName).slice(0, 100),
		toAddr1: ship.line1.slice(0, 120),
		toAddr2: (ship.line2 ?? '').slice(0, 120),
		toPlace: ship.city.slice(0, 50),
		toPincode: Number(ship.pin),
		toStateCode: Number(sale.placeOfSupply),
		actToStateCode: Number(ship.stateCode),
		transactionType,
		otherValue: r2(sale.totals.otherINR + sale.totals.roundOffINR - sale.totals.discountINR),
		totalValue: r2(sale.totals.taxableINR),
		cgstValue: r2(sale.totals.cgstINR),
		sgstValue: r2(sale.totals.sgstINR),
		igstValue: r2(sale.totals.igstINR),
		cessValue: r2(sale.totals.cessINR),
		cessNonAdvolValue: 0,
		totInvValue: r2(sale.totals.totalINR),
		transporterId: partB.transporterId ?? '',
		transporterName: partB.transporterName ?? '',
		transDocNo: partB.vehicleNo || partB.transportDocNo ? (partB.transportDocNo ?? '') : '',
		transMode: partB.vehicleNo || partB.transportDocNo ? govTransMode(partB.mode) : '',
		transDistance: String(partB.distanceKm),
		transDocDate: partB.transportDocDate ? toGovDate(partB.transportDocDate) : '',
		vehicleNo: partB.vehicleNo ? partB.vehicleNo.replace(/\s+/g, '').toUpperCase() : '',
		vehicleType: partB.vehicleNo ? (partB.vehicleType === 'overDimension' ? 'O' : 'R') : '',
		itemList: sale.lines
			.filter((line) => !line.isService)
			.map((line) => ({
				productName: line.description.slice(0, 100),
				productDesc: line.description.slice(0, 100),
				hsnCode: Number(line.hsn),
				quantity: line.qty,
				qtyUnit: uqcFor(line.unit).slice(0, 3),
				cgstRate: interState ? 0 : line.gstRatePercent / 2,
				sgstRate: interState ? 0 : line.gstRatePercent / 2,
				igstRate: interState ? line.gstRatePercent : 0,
				cessRate: 0,
				cessNonadvol: 0,
				taxableAmount: r2(line.taxableINR),
			})),
	};
}

export type EDocProblem =
	| 'einvoice_not_enabled'
	| 'einvoice_buyer_needs_gstin'
	| 'einvoice_document_type'
	| 'doc_number_shape'
	| 'doc_date_too_old'
	| 'doc_date_in_future'
	| 'gstin_state_mismatch'
	| 'hsn_digits'
	| 'unit_needed_for_goods'
	| 'too_many_items'
	| 'item_value_mismatch'
	| 'invoice_total_mismatch'
	| 'ewb_below_threshold'
	| 'ewb_goods_needed'
	| 'ewb_too_late'
	| 'ewb_distance'
	| 'ewb_part_b_needed'
	| 'ewb_use_einvoice_path'
	| 'ewb_too_many_items';

/** The government's tolerance: from one rupee below the rupee part to one rupee above the next rupee. */
export function withinGovTolerance(passed: number, calculated: number): boolean {
	return passed >= Math.floor(calculated) - 1 && passed <= Math.ceil(calculated) + 1;
}

const DOC_NUMBER = /^[a-zA-Z1-9][a-zA-Z0-9/-]{0,15}$/;
const daysBetween = (fromIsoDay: string, toIsoDay: string): number =>
	Math.round(
		(Date.UTC(...(toIsoDay.split('-').map(Number) as [number, number, number])) -
			Date.UTC(...(fromIsoDay.split('-').map(Number) as [number, number, number]))) /
			86_400_000,
	);

/** Before an e-invoice is sent (or its portal file made): what the IRP would refuse. */
export function eInvoiceProblems(
	sale: EDocSale,
	context: { enabledFrom: string | null; todayIst: string },
): EDocProblem[] {
	const problems: EDocProblem[] = [];
	if (!context.enabledFrom || sale.date < context.enabledFrom) problems.push('einvoice_not_enabled');
	if (!GOV_DOC_TYPE[sale.documentType]) problems.push('einvoice_document_type');
	if (sale.supplyType === 'B2B' && !sale.buyer.gstin) problems.push('einvoice_buyer_needs_gstin');
	if (!DOC_NUMBER.test(sale.number)) problems.push('doc_number_shape');
	if (sale.date < '2025-04-01') problems.push('doc_date_too_old');
	if (sale.date > context.todayIst) problems.push('doc_date_in_future');
	for (const p of [sale.seller, ...(sale.supplyType.startsWith('EXP') ? [] : [sale.buyer])])
		if (p.gstin && p.gstin.slice(0, 2) !== p.stateCode) problems.push('gstin_state_mismatch');
	if (sale.lines.length > 1000) problems.push('too_many_items');
	if (sale.lines.some((l) => !/^(\d{4}|\d{6}|\d{8})$/.test(l.hsn))) problems.push('hsn_digits');
	if (sale.lines.some((l) => !l.isService && (!l.unit || !(l.qty > 0)))) problems.push('unit_needed_for_goods');
	const lineOk = (l: EDocLine): boolean => {
		const tax = (l.taxableINR * l.gstRatePercent) / 100;
		const passedTax = l.igstINR + l.cgstINR + l.sgstINR;
		return (
			withinGovTolerance(passedTax, tax) && withinGovTolerance(l.totalINR, l.taxableINR + passedTax + l.cessINR)
		);
	};
	if (sale.documentType === 'taxInvoice' && sale.lines.some((l) => !lineOk(l))) problems.push('item_value_mismatch');
	const sum =
		sale.lines.reduce((s, l) => s + l.totalINR, 0) -
		sale.totals.discountINR +
		sale.totals.otherINR +
		sale.totals.roundOffINR;
	if (!withinGovTolerance(sale.totals.totalINR, sum)) problems.push('invoice_total_mismatch');
	return [...new Set(problems)];
}

/** Before an e-way bill is made by any path. */
export function eWayBillProblems(
	sale: EDocSale,
	partB: EWayBillPartB | null,
	context: { thresholdINR: number; todayIst: string; eInvoiceEnabled: boolean; viaIrn: boolean },
): EDocProblem[] {
	const problems: EDocProblem[] = [];
	if (sale.totals.totalINR < context.thresholdINR && sale.documentType !== 'deliveryChallan')
		problems.push('ewb_below_threshold');
	if (!sale.lines.some((l) => !l.isService)) problems.push('ewb_goods_needed');
	if (daysBetween(sale.date, context.todayIst) > 180) problems.push('ewb_too_late');
	if (sale.lines.length > 250) problems.push('ewb_too_many_items');
	if (!DOC_NUMBER.test(sale.number)) problems.push('doc_number_shape');
	if (partB) {
		if (partB.distanceKm > 4000) problems.push('ewb_distance');
		const hasMove = partB.mode === 'road' ? !!partB.vehicleNo : !!partB.transportDocNo;
		if (!hasMove && !partB.transporterId) problems.push('ewb_part_b_needed');
	} else problems.push('ewb_part_b_needed');
	// NIC: an e-invoice-enabled supplier's B2B or export tax invoice gets its e-way bill only through the IRN.
	if (
		!context.viaIrn &&
		context.eInvoiceEnabled &&
		sale.documentType === 'taxInvoice' &&
		(sale.buyer.gstin || sale.supplyType.startsWith('EXP'))
	)
		problems.push('ewb_use_einvoice_path');
	return [...new Set(problems)];
}

/** Whether a document needs an e-way bill at all (goods of the threshold or more on the move). */
export function eWayBillNeeded(
	sale: Pick<EDocSale, 'lines' | 'totals' | 'documentType'>,
	thresholdINR: number,
): boolean {
	return sale.lines.some((l) => !l.isService) && sale.totals.totalINR >= thresholdINR;
}

/** Whether a document needs an e-invoice: business buyer, export or SEZ, from an enabled GSTIN. */
export function eInvoiceNeeded(
	sale: Pick<EDocSale, 'documentType' | 'buyer' | 'supplyType' | 'date'>,
	enabledFrom: string | null,
): boolean {
	if (!enabledFrom || sale.date < enabledFrom) return false;
	if (!GOV_DOC_TYPE[sale.documentType]) return false;
	return !!sale.buyer.gstin || sale.supplyType !== 'B2B';
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** base64 / base64url → UTF-8 text, without Buffer or atob (core runs in the browser too). */
export function decodeBase64Text(input: string): string {
	const clean = input
		.replace(/-/g, '+')
		.replace(/_/g, '/')
		.replace(/[^A-Za-z0-9+/]/g, '');
	const bytes: number[] = [];
	let buffer = 0;
	let bits = 0;
	for (const ch of clean) {
		buffer = (buffer << 6) | B64.indexOf(ch);
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			bytes.push((buffer >> bits) & 0xff);
		}
	}
	// UTF-8 without TextDecoder (core's lib is plain ES2023): percent-encode the bytes and let the standard decoder read them.
	return decodeURIComponent(bytes.map((b) => '%' + b.toString(16).padStart(2, '0')).join(''));
}

export interface SignedQrData {
	SellerGstin?: string;
	BuyerGstin?: string;
	DocNo?: string;
	DocTyp?: string;
	DocDt?: string;
	TotInvVal?: number;
	ItemCnt?: number;
	MainHsnCode?: string;
	Irn?: string;
	IrnDt?: string;
}

/** The data inside an IRP signed QR (a JWS whose payload's "data" is a JSON string). Null when it isn't one. */
export function decodeSignedQr(jws: string): SignedQrData | null {
	const parts = jws.trim().split('.');
	if (parts.length !== 3) return null;
	try {
		const payload = JSON.parse(decodeBase64Text(parts[1]!)) as { data?: unknown };
		const data = typeof payload.data === 'string' ? JSON.parse(payload.data) : payload.data;
		return data && typeof data === 'object' ? (data as SignedQrData) : null;
	} catch {
		return null;
	}
}

export type SignedFileProblem =
	'not_json' | 'no_irn' | 'no_signed_qr' | 'other_document' | 'other_seller' | 'other_buyer' | 'other_total';

export interface SignedEInvoice {
	irn: string;
	ackNo: string;
	ackDate: string;
	signedQr: string;
	signedInvoice: string | null;
	ewb: { number: string; generatedAt: string | null; validUntil: string | null } | null;
}

/** The e-invoice JSON downloaded from the portal (EI4B): one result, a {Data: …} wrapper, or a list. */
export function readSignedEInvoiceFile(
	text: string,
	sale: EDocSale,
): { ok: true; value: SignedEInvoice } | { ok: false; problem: SignedFileProblem } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { ok: false, problem: 'not_json' };
	}
	const candidates = (Array.isArray(parsed) ? parsed : [parsed]).flatMap((item) => {
		const obj = item as Record<string, unknown>;
		return [obj, (obj?.['Data'] ?? obj?.['data']) as Record<string, unknown> | undefined].filter(Boolean) as Record<
			string,
			unknown
		>[];
	});
	const pick = (o: Record<string, unknown>, ...keys: string[]): string | null => {
		for (const k of keys) if (o[k] != null && String(o[k]).trim()) return String(o[k]).trim();
		return null;
	};
	const docTyp = GOV_DOC_TYPE[sale.documentType];
	for (const c of candidates) {
		const irn = pick(c, 'Irn', 'irn', 'IRN');
		if (!irn) continue;
		const signedQr = pick(c, 'SignedQRCode', 'signedQRCode', 'SignedQrCode');
		if (!signedQr) return { ok: false, problem: 'no_signed_qr' };
		const qr = decodeSignedQr(signedQr);
		if (qr) {
			if (
				(qr.DocNo && qr.DocNo !== sale.number) ||
				(qr.DocTyp && qr.DocTyp !== docTyp) ||
				(qr.DocDt && qr.DocDt !== toGovDate(sale.date))
			)
				return { ok: false, problem: 'other_document' };
			if (qr.SellerGstin && qr.SellerGstin !== sale.seller.gstin) return { ok: false, problem: 'other_seller' };
			if (qr.BuyerGstin && qr.BuyerGstin !== (sale.buyer.gstin ?? 'URP'))
				return { ok: false, problem: 'other_buyer' };
			if (typeof qr.TotInvVal === 'number' && !withinGovTolerance(qr.TotInvVal, sale.totals.totalINR))
				return { ok: false, problem: 'other_total' };
		}
		const ewbNo = pick(c, 'EwbNo', 'ewbNo');
		return {
			ok: true,
			value: {
				irn: irn.toLowerCase(),
				ackNo: pick(c, 'AckNo', 'ackNo') ?? '',
				ackDate:
					fromGovDateTime(pick(c, 'AckDt', 'ackDt')) ??
					fromGovDateTime(qr?.IrnDt) ??
					new Date(0).toISOString(),
				signedQr,
				signedInvoice: pick(c, 'SignedInvoice', 'signedInvoice'),
				ewb: ewbNo
					? {
							number: ewbNo,
							generatedAt: fromGovDateTime(pick(c, 'EwbDt')),
							validUntil: fromGovDateTime(pick(c, 'EwbValidTill')),
						}
					: null,
			},
		};
	}
	return { ok: false, problem: 'no_irn' };
}
