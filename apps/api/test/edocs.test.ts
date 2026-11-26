import { BadRequestException } from '@nestjs/common';
import { OrderSettings, TaxInvoice, type EDocCall, type EDocSettings, type EDocument } from '@saha-textile/contracts';
import {
	EDocUnavailableError,
	type EDocKeyStore,
	type EDocListFilter,
	type EDocRepository,
	type EDocSecrets,
	EDocRefusedError,
	type EInvoiceGateway,
	type EInvoiceResult,
	type OrderSettingsRepository,
	type ShopDetailsRepository,
} from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

import type { AnyEDocGateway, EDocGatewayFactory } from '../src/edocs/edoc-gateways';
import { EDocsOrderBridge } from '../src/edocs/edocs-order-bridge';
import { EDocsService } from '../src/edocs/edocs.service';

const GSTIN = '19DBYPS6736R1ZZ';
const BARASAT = {
	id: 'loc_bar',
	name: 'Barasat warehouse',
	address: '11/1A K.B. Bose Road',
	city: 'Barasat',
	pin: '700124',
	phone: '',
};
const IRN_RESULT: EInvoiceResult = {
	irn: 'a'.repeat(64),
	ackNo: '112410123456789',
	ackDate: '2026-11-23T10:05:00.000Z',
	signedQr: 'eyJhbGciOiJSUzI1NiJ9.e30.sig',
	signedInvoice: null,
	ewb: null,
};
const INVOICE = TaxInvoice.parse({
	id: 'ti_1',
	number: 'TI/26-27/000001',
	date: '2026-11-23',
	gstRegistrationId: 'reg_wb',
	gstin: GSTIN,
	locationId: 'loc_bar',
	orderId: 'ord_1',
	orderNumber: 'ST-2611-482207',
	seller: { name: 'K.R. Marketing', gstin: GSTIN, address: 'Barasat', stateCode: '19' },
	buyer: { name: 'Rang Mahal Boutique LLP', gstin: '27AAKFR1234M1Z2', address: 'Mumbai', stateCode: '27' },
	placeOfSupply: '27',
	interState: true,
	lines: [
		{
			lineId: 'a',
			sku: 'S1',
			title: 'Saree',
			hsn: '5007',
			quantity: 1,
			unitPriceINR: 21_000,
			ratePercent: 5,
			taxableINR: 20_000,
			igstINR: 1_000,
			totalINR: 21_000,
		},
	],
	taxableINR: 20_000,
	cgstINR: 0,
	sgstINR: 0,
	igstINR: 1_000,
	roundOffINR: 0,
	totalINR: 21_000,
	createdAt: '2026-11-23T10:00:00.000Z',
});

class MemoryEDocs implements EDocRepository {
	settings: EDocSettings | null = null;
	docs: EDocument[] = [];
	calls: EDocCall[] = [];
	async getSettings() {
		return this.settings;
	}
	async saveSettings(s: EDocSettings) {
		this.settings = s;
		return s;
	}
	async findActive(kind: 'eInvoice' | 'eWayBill', documentId: string) {
		return this.docs.find((d) => d.kind === kind && d.documentId === documentId && d.status === 'active') ?? null;
	}
	async findById(id: string) {
		return this.docs.find((d) => d.id === id) ?? null;
	}
	async insert(d: EDocument) {
		this.docs.push(d);
	}
	async replace(d: EDocument) {
		this.docs = this.docs.map((x) => (x.id === d.id ? d : x));
	}
	async list(f: EDocListFilter) {
		const rows = this.docs.filter((d) => d.kind === f.kind);
		return { rows, total: rows.length };
	}
	async logCall(c: EDocCall) {
		this.calls.push(c);
	}
	async listCalls() {
		return { rows: this.calls, total: this.calls.length };
	}
}
class MemoryKeys implements EDocKeyStore {
	constructor(readonly available = true) {}
	stored = new Map<string, EDocSecrets>();
	async put(g: string, p: string, s: EDocSecrets) {
		this.stored.set(`${g}:${p}`, s);
	}
	async get(g: string, p: string) {
		return this.stored.get(`${g}:${p}`) ?? null;
	}
	async remove(g: string, p: string) {
		this.stored.delete(`${g}:${p}`);
	}
}

function setup(
	options: {
		keysAvailable?: boolean;
		testFails?: boolean;
		invoices?: TaxInvoice[];
		generate?: () => Promise<EInvoiceResult>;
	} = {},
) {
	const repo = new MemoryEDocs();
	const keys = new MemoryKeys(options.keysAvailable ?? true);
	let orderSettings = OrderSettings.parse({});
	const orderRepo: OrderSettingsRepository = {
		get: async () => orderSettings,
		save: async (s) => (orderSettings = { ...s, revision: s.revision + 1 }),
	};
	const shop: ShopDetailsRepository = { get: async () => ({ gstin: GSTIN }) as never, save: async () => undefined };
	const gateway: EInvoiceGateway = {
		test: async () => {
			if (options.testFails) throw new EDocUnavailableError('edoc_network');
		},
		generate: async (_gstin, json) => {
			sent.push(json);
			if (!options.generate) throw new Error('not used');
			return options.generate();
		},
		cancel: async () => ({ cancelledAt: '' }),
		byDocument: async () => (options.generate ? { ...IRN_RESULT, ackNo: 'fetched' } : null),
		gstinDetails: async () => {
			throw new Error('not used');
		},
		eWayBillByIrn: async () => {
			throw new Error('not used');
		},
	};
	const factory = { build: (): AnyEDocGateway => ({ kind: 'eInvoice', gateway }) } as unknown as EDocGatewayFactory;
	const service = new EDocsService(repo, keys, shop, orderRepo, factory);
	const sent: Record<string, unknown>[] = [];
	const bridge = new EDocsOrderBridge(
		service,
		{ listForOrder: async () => options.invoices ?? [] },
		{ list: async () => [BARASAT] as never },
		shop,
	);
	return { service, repo, keys, bridge, sent, orderSettings: () => orderSettings };
}

const irisKeys = {
	path: 'irpDirect' as const,
	provider: 'irisIrp' as const,
	environment: 'sandbox' as const,
	baseUrl: 'https://sandbox.einvoice6.gst.gov.in',
	userName: 'api-user',
	password: 'pw',
	clientId: 'client-1234',
	clientSecret: 'secret',
	publicKeyPem: '-----BEGIN PUBLIC KEY-----x-----END PUBLIC KEY-----',
};

describe('e-invoice and e-way bill settings (addendum 2)', () => {
	it('starts by hand, with the threshold taken from Order settings', async () => {
		const { service } = setup();
		const view = await service.view();
		expect(view).toMatchObject({
			gstin: GSTIN,
			keysAvailable: true,
			settings: { eInvoicePath: 'manual', eWayBillPath: 'manual', eWayBillThresholdINR: 50_000 },
		});
	});

	it('refuses an automatic path until its keys pass Test (AE1), then switches it on', async () => {
		const { service } = setup();
		const write = {
			eInvoicePath: 'irpDirect' as const,
			eWayBillPath: 'manual' as const,
			eWayBillWithEInvoice: true,
			eInvoiceEnabledFrom: '2027-04-01',
			eWayBillThresholdINR: 50_000,
		};
		await expect(service.saveSettings(write, null, 'usr_1')).rejects.toBeInstanceOf(BadRequestException);
		await service.saveKeys(irisKeys, 'usr_1');
		let view = await service.view();
		expect(view.settings?.keys[0]).toMatchObject({
			path: 'irpDirect',
			clientIdHint: '…1234',
			hasClientSecret: true,
			testOk: null,
		});
		expect(JSON.stringify(view)).not.toContain('secret');
		view = await service.test('irpDirect', 'usr_1');
		expect(view.settings?.keys[0]?.testOk).toBe(true);
		view = await service.saveSettings(write, view.settings!.updatedAt, 'usr_1');
		expect(view.settings?.eInvoicePath).toBe('irpDirect');
	});

	it('keeps stored secrets when blanks are sent, and needs the public key for a direct path', async () => {
		const { service, keys } = setup();
		await service.saveKeys(irisKeys, 'usr_1');
		await service.saveKeys({ ...irisKeys, password: '', clientSecret: undefined }, 'usr_1');
		expect(await keys.get(GSTIN, 'irpDirect')).toMatchObject({ password: 'pw', clientSecret: 'secret' });
		const { service: fresh } = setup();
		await expect(fresh.saveKeys({ ...irisKeys, publicKeyPem: undefined }, 'usr_1')).rejects.toBeInstanceOf(
			BadRequestException,
		);
	});

	it('says automatic paths need the server key when EDOC_KEYS_KEY is missing', async () => {
		const { service } = setup({ keysAvailable: false });
		expect((await service.view()).keysAvailable).toBe(false);
		await expect(service.saveKeys(irisKeys, 'usr_1')).rejects.toThrow('edoc_keys_key_missing');
	});

	it('records a failed Test with its reason and keeps the path by hand', async () => {
		const { service, repo } = setup({ testFails: true });
		await service.saveKeys(irisKeys, 'usr_1');
		const view = await service.test('irpDirect', 'usr_1');
		expect(view.settings?.keys[0]).toMatchObject({ testOk: false, testMessage: 'edoc_network' });
		expect(repo.calls.at(-1)).toMatchObject({ action: 'test', ok: false, code: 'unavailable' });
	});

	it('moves the e-way bill threshold into Order settings too, so the Shipped gate follows (AE8)', async () => {
		const { service, orderSettings } = setup();
		await service.saveSettings(
			{
				eInvoicePath: 'manual',
				eWayBillPath: 'manual',
				eWayBillWithEInvoice: true,
				eInvoiceEnabledFrom: null,
				eWayBillThresholdINR: 100_000,
			},
			null,
			'usr_1',
		);
		expect(orderSettings().eWayBillThresholdINR).toBe(100_000);
	});

	it('the order page’s Raise opens the by-hand popup on the by-hand path, and on an automatic path until the order has its tax invoice', async () => {
		const { service, bridge, repo } = setup();
		const order = { id: 'ord_1', orderNumber: 'ST-2611-482207', createdAt: '2026-11-22T10:00:00.000Z' } as never;
		expect(await bridge.raise(order, 'eInvoice')).toEqual({ kind: 'notConnected' });
		await service.saveKeys(irisKeys, 'usr_1');
		const tested = await service.test('irpDirect', 'usr_1');
		await service.saveSettings(
			{
				eInvoicePath: 'irpDirect',
				eWayBillPath: 'manual',
				eWayBillWithEInvoice: true,
				eInvoiceEnabledFrom: '2026-04-01',
				eWayBillThresholdINR: 50_000,
			},
			tested.settings!.updatedAt,
			'usr_1',
		);
		await bridge.refresh();
		expect(bridge.connected('eInvoice')).toBe(true);
		expect(await bridge.raise(order, 'eInvoice')).toEqual({ kind: 'notConnected' });
		expect(repo.calls.at(-1)).toMatchObject({ action: 'generate', ok: false, code: 'invoice_not_issued' });
	});

	it('keeps one active record per order and document kind when entered by hand again', async () => {
		const { service, repo } = setup();
		const order = {
			id: 'ord_1',
			orderNumber: 'ST-2611-482207',
			createdAt: '2026-11-22T10:00:00.000Z',
			eWayBill: {
				number: '34101234567890',
				generatedOn: '2026-11-22T11:03:00.000Z',
				validUntil: '2026-12-02T18:29:59.000Z',
			},
		} as never;
		await service.recordForOrder(order, 'eWayBill', 'manual', 'usr_1');
		await service.recordForOrder(order, 'eWayBill', 'manual', 'usr_1');
		expect(repo.docs.filter((d) => d.status === 'active')).toHaveLength(1);
		expect(repo.docs.find((d) => d.status === 'active')).toMatchObject({
			ewbNumber: '34101234567890',
			documentNumber: 'ST-2611-482207',
			path: 'manual',
		});
		expect(repo.calls.at(-1)).toMatchObject({ action: 'manualEntry', ok: true });
	});
	it('needs an IRN only once the GSTIN is e-invoice enabled (K.R. Marketing isn’t)', async () => {
		const { service } = setup();
		expect(await service.eInvoiceEnabled('2026-11-23')).toBe(false);
		await service.saveSettings(
			{
				eInvoicePath: 'manual',
				eWayBillPath: 'manual',
				eWayBillWithEInvoice: true,
				eInvoiceEnabledFrom: '2027-04-01',
				eWayBillThresholdINR: 50_000,
			},
			null,
			'usr_1',
		);
		expect(await service.eInvoiceEnabled('2026-11-23')).toBe(false);
		expect(await service.eInvoiceEnabled('2027-04-01')).toBe(true);
	});

	async function connectIris(service: EDocsService) {
		await service.saveKeys(irisKeys, 'usr_1');
		const tested = await service.test('irpDirect', 'usr_1');
		await service.saveSettings(
			{
				eInvoicePath: 'irpDirect',
				eWayBillPath: 'manual',
				eWayBillWithEInvoice: true,
				eInvoiceEnabledFrom: '2026-04-01',
				eWayBillThresholdINR: 50_000,
			},
			tested.settings!.updatedAt,
			'usr_1',
		);
	}
	const order = {
		id: 'ord_1',
		orderNumber: 'ST-2611-482207',
		createdAt: '2026-11-22T10:00:00.000Z',
		addresses: {
			delivery: { fullName: 'Rang Mahal', line1: 'Linking Road', city: 'Mumbai', postalCode: '400050' },
		},
	} as never;

	it('registers the order’s tax invoice when connected: the same number and lines (D1, EI4A)', async () => {
		const { service, bridge, sent } = setup({ invoices: [INVOICE], generate: async () => IRN_RESULT });
		await connectIris(service);
		const outcome = await bridge.raise(order, 'eInvoice');
		expect(outcome).toEqual({
			kind: 'raised',
			record: {
				irn: IRN_RESULT.irn,
				ackNo: IRN_RESULT.ackNo,
				ackDate: IRN_RESULT.ackDate,
				signedQr: IRN_RESULT.signedQr,
				source: 'api',
			},
		});
		expect(sent[0]).toMatchObject({ DocDtls: { No: 'TI/26-27/000001', Dt: '23/11/2026' } });
		// The e-way bill needs Part B from the courier booking: by hand for now.
		expect(await bridge.raise(order, 'eWayBill')).toEqual({ kind: 'notConnected' });
	});

	it('fetches the IRN of an invoice the IRP already has, and shows a refusal as it is (AE7)', async () => {
		const duplicate = setup({
			invoices: [INVOICE],
			generate: async () => {
				throw new EDocRefusedError('2150', 'Duplicate IRN');
			},
		});
		await connectIris(duplicate.service);
		expect(await duplicate.bridge.raise(order, 'eInvoice')).toMatchObject({
			kind: 'raised',
			record: { ackNo: 'fetched' },
		});
		const refused = setup({
			invoices: [INVOICE],
			generate: async () => {
				throw new EDocRefusedError('2265', 'Recipient GSTIN is not valid');
			},
		});
		await connectIris(refused.service);
		expect(await refused.bridge.raise(order, 'eInvoice')).toEqual({
			kind: 'refused',
			message: '2265: Recipient GSTIN is not valid',
		});
	});

	it('records the e-document against the tax invoice once there is one', async () => {
		const { service, repo } = setup();
		const withEwb = {
			...(order as object),
			eWayBill: {
				number: '34101234567890',
				generatedOn: '2026-11-23T11:03:00.000Z',
				validUntil: '2026-12-02T18:29:59.000Z',
			},
		} as never;
		await service.recordForOrder(withEwb, 'eWayBill', 'manual', 'usr_1');
		await service.recordForOrder(withEwb, 'eWayBill', 'manual', 'usr_1', INVOICE);
		const active = repo.docs.filter((d) => d.status === 'active');
		expect(active).toHaveLength(1);
		expect(active[0]).toMatchObject({ documentId: 'ti_1', documentNumber: 'TI/26-27/000001', valueINR: 21_000 });
	});
});
