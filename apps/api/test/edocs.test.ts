import { BadRequestException } from '@nestjs/common';
import { OrderSettings, type EDocCall, type EDocSettings, type EDocument } from '@saha-textile/contracts';
import {
	EDocUnavailableError,
	type EDocKeyStore,
	type EDocListFilter,
	type EDocRepository,
	type EDocSecrets,
	type EInvoiceGateway,
	type OrderSettingsRepository,
	type ShopDetailsRepository,
} from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

import type { AnyEDocGateway, EDocGatewayFactory } from '../src/edocs/edoc-gateways';
import { EDocsOrderBridge } from '../src/edocs/edocs-order-bridge';
import { EDocsService } from '../src/edocs/edocs.service';

const GSTIN = '19DBYPS6736R1ZZ';

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

function setup(options: { keysAvailable?: boolean; testFails?: boolean } = {}) {
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
		generate: async () => {
			throw new Error('not used');
		},
		cancel: async () => ({ cancelledAt: '' }),
		byDocument: async () => null,
		gstinDetails: async () => {
			throw new Error('not used');
		},
		eWayBillByIrn: async () => {
			throw new Error('not used');
		},
	};
	const factory = { build: (): AnyEDocGateway => ({ kind: 'eInvoice', gateway }) } as unknown as EDocGatewayFactory;
	const service = new EDocsService(repo, keys, shop, orderRepo, factory);
	return { service, repo, keys, bridge: new EDocsOrderBridge(service), orderSettings: () => orderSettings };
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

	it('the order page’s Raise opens the by-hand popup on the by-hand path and, until D1, on an automatic path too', async () => {
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
});
