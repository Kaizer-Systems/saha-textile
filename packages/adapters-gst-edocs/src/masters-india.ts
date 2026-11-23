import type { EDocCancelReason, EWayBillPartB, GstinDetails } from '@saha-textile/contracts';
import {
	EDocRefusedError,
	EDocUnavailableError,
	fromGovDateTime,
	toGovDate,
	type EInvoiceGateway,
	type EInvoiceResult,
	type EWayBillGateway,
	type EWayBillResult,
} from '@saha-textile/core-domain';

import { callJson, trimSlash, type HttpOptions } from './http';
import { IRN_CANCEL_CODE, toGstinDetails, toResult } from './irp-direct';

/**
 * The provider path through Masters India (AE3), from docs.mastersindia.co (read 23 Nov 2026). Plain JSON over
 * TLS; the token goes in the body ("access_token"). Their sandbox and production hosts are not published, so
 * the base address is a setting; field names marked "confirm" in the developer docs must be checked in their
 * sandbox before the path is switched on (Test does this).
 */
export interface MastersIndiaConfig extends HttpOptions {
	baseUrl: string;
	/** The token host when it differs from the API host (their e-invoice docs show a separate one). */
	tokenUrl?: string;
	userName: string;
	password: string;
	clientId: string;
	clientSecret: string;
	now?: () => Date;
}

interface Token {
	value: string;
	expiresAt: number;
}

type MiReply = {
	results?: { message?: unknown; errorMessage?: string; status?: string; code?: number; InfoDtls?: unknown };
};

class MastersIndiaClient {
	private token: Token | null = null;
	constructor(private readonly config: MastersIndiaConfig) {}

	private base(): string {
		return trimSlash(this.config.baseUrl);
	}

	async accessToken(force = false): Promise<string> {
		const now = (this.config.now ?? (() => new Date()))().getTime();
		if (this.token && !force && this.token.expiresAt - 60_000 > now) return this.token.value;
		const reply = (await callJson(
			this.config,
			'POST',
			this.config.tokenUrl ?? `${this.base()}/oauth/access_token`,
			{},
			{
				username: this.config.userName,
				password: this.config.password,
				client_id: this.config.clientId,
				client_secret: this.config.clientSecret,
				grant_type: 'password',
			},
		)) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
		if (!reply.access_token)
			throw new EDocRefusedError(reply.error ?? 'auth', reply.error_description ?? 'Sign-in refused');
		this.token = { value: reply.access_token, expiresAt: now + (reply.expires_in ?? 3600) * 1000 };
		return this.token.value;
	}

	/** Their envelope: results.message is the answer on success, or the error text (e-way bill) on failure. */
	async call(
		method: 'GET' | 'POST',
		path: string,
		params: Record<string, unknown>,
		retried = false,
	): Promise<Record<string, unknown>> {
		const token = await this.accessToken(retried);
		const withToken = { access_token: token, ...params };
		const url =
			method === 'GET'
				? `${this.base()}${path}?${new URLSearchParams(Object.entries(withToken).map(([k, v]): [string, string] => [k, String(v)])).toString()}`
				: `${this.base()}${path}`;
		const reply = (await callJson(
			this.config,
			method,
			url,
			{},
			method === 'POST' ? withToken : undefined,
		)) as MiReply;
		const results = reply.results;
		if (!results) throw new EDocUnavailableError('edoc_provider_reply');
		if (results.status === 'Success' && results.message && typeof results.message === 'object')
			return results.message as Record<string, unknown>;
		const text = results.errorMessage || (typeof results.message === 'string' ? results.message : '') || 'Refused';
		if (!retried && /token/i.test(text)) return this.call(method, path, params, true);
		const code = /^(\d{3,5})\s*:/.exec(text)?.[1] ?? 'provider';
		throw Object.assign(new EDocRefusedError(code, text), { info: results.InfoDtls });
	}
}

const lower = <T extends Record<string, unknown>>(o: T | undefined) => o ?? ({} as T);

/** NIC's INV-01 JSON (built by core) → Masters India's snake_case body. */
export function mastersIndiaInvoiceBody(gstin: string, nic: Record<string, unknown>): Record<string, unknown> {
	const tran = lower(nic['TranDtls'] as Record<string, unknown>);
	const doc = lower(nic['DocDtls'] as Record<string, unknown>);
	const seller = lower(nic['SellerDtls'] as Record<string, unknown>);
	const buyer = lower(nic['BuyerDtls'] as Record<string, unknown>);
	const val = lower(nic['ValDtls'] as Record<string, unknown>);
	const ewb = nic['EwbDtls'] as Record<string, unknown> | undefined;
	const partyOf = (p: Record<string, unknown>) => ({
		gstin: p['Gstin'],
		legal_name: p['LglNm'],
		trade_name: p['TrdNm'] ?? p['LglNm'],
		address1: p['Addr1'],
		address2: p['Addr2'] ?? '',
		location: p['Loc'],
		pincode: p['Pin'],
		state_code: p['Stcd'],
		...(p['Ph'] ? { phone_number: p['Ph'] } : {}),
		...(p['Em'] ? { email: p['Em'] } : {}),
	});
	return {
		user_gstin: gstin,
		data_source: 'erp',
		transaction_details: {
			supply_type: tran['SupTyp'],
			charge_type: tran['RegRev'],
			igst_on_intra: tran['IgstOnIntra'],
			ecommerce_gstin: '',
		},
		document_details: { document_type: doc['Typ'], document_number: doc['No'], document_date: doc['Dt'] },
		seller_details: partyOf(seller),
		buyer_details: { ...partyOf(buyer), place_of_supply: buyer['Pos'] },
		...(nic['DispDtls']
			? {
					dispatch_details: {
						company_name: (nic['DispDtls'] as Record<string, unknown>)['Nm'],
						...partyOf(nic['DispDtls'] as Record<string, unknown>),
					},
				}
			: {}),
		...(nic['ShipDtls'] ? { ship_details: partyOf(nic['ShipDtls'] as Record<string, unknown>) } : {}),
		value_details: {
			total_assessable_value: val['AssVal'],
			total_cgst_value: val['CgstVal'],
			total_sgst_value: val['SgstVal'],
			total_igst_value: val['IgstVal'],
			total_cess_value: val['CesVal'],
			total_discount: val['Discount'],
			total_other_charge: val['OthChrg'],
			round_off_amount: val['RndOffAmt'],
			total_invoice_value: val['TotInvVal'],
		},
		...(ewb
			? {
					ewaybill_details: {
						transporter_id: ewb['TransId'] ?? '',
						transporter_name: ewb['TransName'] ?? '',
						transportation_mode: ewb['TransMode'] ?? '',
						transportation_distance: ewb['Distance'],
						transporter_document_number: ewb['TransDocNo'] ?? '',
						transporter_document_date: ewb['TransDocDt'] ?? '',
						vehicle_number: ewb['VehNo'] ?? '',
						vehicle_type: ewb['VehType'] ?? '',
					},
				}
			: {}),
		item_list: ((nic['ItemList'] as Record<string, unknown>[]) ?? []).map((i) => ({
			item_serial_number: i['SlNo'],
			product_description: i['PrdDesc'],
			is_service: i['IsServc'],
			hsn_code: i['HsnCd'],
			quantity: i['Qty'],
			unit: i['Unit'],
			unit_price: i['UnitPrice'],
			total_amount: i['TotAmt'],
			discount: i['Discount'],
			assessable_value: i['AssAmt'],
			gst_rate: i['GstRt'],
			igst_amount: i['IgstAmt'],
			cgst_amount: i['CgstAmt'],
			sgst_amount: i['SgstAmt'],
			cess_amount: i['CesAmt'],
			total_item_value: i['TotItemVal'],
		})),
	};
}

export class MastersIndiaEInvoiceGateway implements EInvoiceGateway {
	private readonly client: MastersIndiaClient;
	constructor(config: MastersIndiaConfig) {
		this.client = new MastersIndiaClient(config);
	}
	async test(gstin: string): Promise<void> {
		await this.client.accessToken(true);
		await this.gstinDetails(gstin, gstin);
	}
	async generate(gstin: string, invoiceJson: Record<string, unknown>): Promise<EInvoiceResult> {
		try {
			return toResult(
				await this.client.call('POST', '/generateEinvoice', mastersIndiaInvoiceBody(gstin, invoiceJson)),
			);
		} catch (error) {
			if (error instanceof EDocRefusedError && error.code === '2150') {
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
		const body = await this.client.call('POST', '/cancelEinvoice', {
			user_gstin: gstin,
			irn,
			cancel_reason: IRN_CANCEL_CODE[reason],
			cancel_remarks: remark.slice(0, 100),
		});
		return { cancelledAt: fromGovDateTime(String(body['CancelDate'] ?? '')) ?? new Date().toISOString() };
	}
	async byDocument(
		gstin: string,
		docType: 'INV' | 'CRN' | 'DBN',
		docNo: string,
		docDateGov: string,
	): Promise<EInvoiceResult | null> {
		try {
			return toResult(
				await this.client.call('GET', '/getIrnDetailsByDocDetails', {
					user_gstin: gstin,
					document_type: docType,
					document_number: docNo,
					document_date: docDateGov,
				}),
			);
		} catch (error) {
			if (error instanceof EDocRefusedError && ['2148', '2283', '3001'].includes(error.code)) return null;
			throw error;
		}
	}
	async gstinDetails(gstin: string, of: string): Promise<GstinDetails> {
		return toGstinDetails(await this.client.call('GET', '/gstinDetails', { user_gstin: gstin, gstin: of }));
	}
	async eWayBillByIrn(): Promise<EWayBillResult> {
		// Their plain-JSON docs only list e-way bill by IRN as SOAP: send Part B with Generate instead (ewaybill_details).
		throw new EDocRefusedError(
			'provider_ewb_by_irn',
			'This provider makes the e-way bill together with the e-invoice only',
		);
	}
}

const MI_MODE: Record<string, string> = {
	'1': 'road',
	'2': 'rail',
	'3': 'air',
	'4': 'ship',
	'5': 'inTransit',
	'6': 'metro rail',
};
const MI_DOC: Record<string, string> = {
	INV: 'tax invoice',
	CHL: 'delivery challan',
	BIL: 'bill of supply',
	BOE: 'bill of entry',
	OTH: 'others',
};
const MI_SUB: Record<string, string> = {
	'1': 'Supply',
	'3': 'Export',
	'4': 'Job Work',
	'5': 'For Own Use',
	'7': 'Sales Return',
	'8': 'Others',
	'12': 'Exhibition or Fairs',
};

/** NIC's GENEWAYBILL JSON (built by core) → Masters India's body (state fields: confirm codes vs names in their sandbox). */
export function mastersIndiaEWayBillBody(gstin: string, nic: Record<string, unknown>): Record<string, unknown> {
	return {
		userGstin: gstin,
		data_source: 'erp',
		supply_type: nic['supplyType'] === 'I' ? 'inward' : 'outward',
		sub_supply_type: MI_SUB[String(nic['subSupplyType'])] ?? 'Supply',
		sub_supply_description: nic['subSupplyDesc'] ?? '',
		document_type: MI_DOC[String(nic['docType'])] ?? 'tax invoice',
		document_number: nic['docNo'],
		document_date: nic['docDate'],
		gstin_of_consignor: nic['fromGstin'],
		legal_name_of_consignor: nic['fromTrdName'],
		address1_of_consignor: nic['fromAddr1'],
		address2_of_consignor: nic['fromAddr2'],
		place_of_consignor: nic['fromPlace'],
		pincode_of_consignor: nic['fromPincode'],
		state_of_consignor: nic['fromStateCode'],
		actual_from_state_name: nic['actFromStateCode'],
		gstin_of_consignee: nic['toGstin'],
		legal_name_of_consignee: nic['toTrdName'],
		address1_of_consignee: nic['toAddr1'],
		address2_of_consignee: nic['toAddr2'],
		place_of_consignee: nic['toPlace'],
		pincode_of_consignee: nic['toPincode'],
		state_of_supply: nic['toStateCode'],
		actual_to_state_name: nic['actToStateCode'],
		transaction_type: nic['transactionType'],
		other_value: nic['otherValue'],
		total_invoice_value: nic['totInvValue'],
		taxable_amount: nic['totalValue'],
		cgst_amount: nic['cgstValue'],
		sgst_amount: nic['sgstValue'],
		igst_amount: nic['igstValue'],
		cess_amount: nic['cessValue'],
		cess_nonadvol_value: nic['cessNonAdvolValue'],
		transporter_id: nic['transporterId'],
		transporter_name: nic['transporterName'],
		transporter_document_number: nic['transDocNo'],
		transporter_document_date: nic['transDocDate'],
		transportation_mode: MI_MODE[String(nic['transMode'])] ?? '',
		transportation_distance: nic['transDistance'],
		vehicle_number: nic['vehicleNo'],
		vehicle_type: nic['vehicleType'] === 'O' ? 'ODC' : nic['vehicleType'] ? 'Regular' : '',
		generate_status: 1,
		itemList: ((nic['itemList'] as Record<string, unknown>[]) ?? []).map((i) => ({
			product_name: i['productName'],
			product_description: i['productDesc'],
			hsn_code: String(i['hsnCode']),
			quantity: i['quantity'],
			unit_of_product: i['qtyUnit'],
			cgst_rate: i['cgstRate'],
			sgst_rate: i['sgstRate'],
			igst_rate: i['igstRate'],
			cess_rate: i['cessRate'],
			cessNonAdvol: i['cessNonadvol'],
			taxable_amount: i['taxableAmount'],
		})),
	};
}

const MI_CANCEL: Record<EDocCancelReason, string> = {
	duplicate: 'Duplicate',
	orderCancelled: 'Order Cancelled',
	dataEntryMistake: 'Data Entry mistake',
	other: 'Others',
};
const MI_PART_B_REASON = {
	breakdown: 'Due to Break Down',
	transhipment: 'Due to Transhipment',
	others: 'Others',
	firstTime: 'First Time',
} as const;

export class MastersIndiaEWayBillGateway implements EWayBillGateway {
	private readonly client: MastersIndiaClient;
	constructor(config: MastersIndiaConfig) {
		this.client = new MastersIndiaClient(config);
	}
	async test(): Promise<void> {
		await this.client.accessToken(true);
	}
	async generate(gstin: string, ewbJson: Record<string, unknown>): Promise<EWayBillResult> {
		const body = await this.client.call('POST', '/ewayBillsGenerate', mastersIndiaEWayBillBody(gstin, ewbJson));
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
		c: {
			partB: EWayBillPartB;
			fromPlace: string;
			fromStateCode: string;
			reason: keyof typeof MI_PART_B_REASON;
			remark: string;
		},
	): Promise<{ updatedAt: string; validUntil: string | null }> {
		const body = await this.client.call('POST', '/updateVehicleNumber', {
			userGstin: gstin,
			eway_bill_number: Number(ewbNo),
			vehicle_number: c.partB.vehicleNo ?? '',
			vehicle_type: c.partB.vehicleType === 'overDimension' ? 'ODC' : 'Regular',
			place_of_consignor: c.fromPlace,
			state_of_consignor: c.fromStateCode,
			reason_code_for_vehicle_updation: MI_PART_B_REASON[c.reason],
			reason_for_vehicle_updation: c.remark,
			transporter_document_number: c.partB.transportDocNo ?? '',
			transporter_document_date: c.partB.transportDocDate ? toGovDate(c.partB.transportDocDate) : '',
			mode_of_transport:
				MI_MODE[String({ road: 1, rail: 2, air: 3, ship: 4, inTransit: 5, metroRail: 6 }[c.partB.mode])] ??
				'road',
			data_source: 'erp',
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
			reason: string;
			remark: string;
		},
	): Promise<{ validUntil: string }> {
		const inTransit = x.partB.mode === 'inTransit';
		const body = await this.client.call('POST', '/ewayBillValidityExtend', {
			userGstin: gstin,
			eway_bill_number: Number(ewbNo),
			vehicle_number: x.partB.vehicleNo ?? '',
			place_of_consignor: x.fromPlace,
			state_of_consignor: x.fromStateCode,
			remaining_distance: x.remainingKm,
			transporter_document_number: x.partB.transportDocNo ?? '',
			transporter_document_date: x.partB.transportDocDate ? toGovDate(x.partB.transportDocDate) : '',
			mode_of_transport: inTransit ? 'In Transit' : 'road',
			extend_validity_reason: x.reason,
			extend_remarks: x.remark,
			from_pincode: Number(x.fromPin),
			consignment_status: inTransit ? 'T' : 'M',
			transit_type: inTransit ? 'Road' : '',
			address_line1: x.fromPlace,
			address_line2: '',
			address_line3: '',
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
		const body = await this.client.call('POST', '/ewayBillCancel', {
			userGstin: gstin,
			eway_bill_number: Number(ewbNo),
			reason_of_cancel: MI_CANCEL[reason],
			cancel_remark: remark.slice(0, 50),
			data_source: 'erp',
		});
		return { cancelledAt: fromGovDateTime(String(body['cancelDate'] ?? '')) ?? new Date().toISOString() };
	}
}
