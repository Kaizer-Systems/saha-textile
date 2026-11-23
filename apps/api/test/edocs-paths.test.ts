import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EDocSettings, OrderSettings, TaxInvoice, type EDocCall, type EDocument } from '@saha-textile/contracts';
import {
	EDocRefusedError,
	type EDocKeyStore,
	type EDocRepository,
	type EDocSecrets,
	type EInvoiceGateway,
	type EInvoiceResult,
	type OrderSettingsRepository,
	type ShopDetailsRepository,
} from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

import type { AnyEDocGateway, EDocGatewayFactory } from '../src/edocs/edoc-gateways';
import { EDocsOrderBridge, eInvoicePortFrom, eWayBillPortFrom } from '../src/edocs/edocs-order-bridge';
import { EDocsService } from '../src/edocs/edocs.service';

/** Every path through the e-document settings, records and the order page's Generate (addendum 2, D1). */

const GSTIN = '19DBYPS6736R1ZZ';
const IRN: EInvoiceResult = {
	irn: 'b'.repeat(64),
	ackNo: '112410123456789',
	ackDate: '2026-11-23T10:05:00.000Z',
	signedQr: 'x.y.z',
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
	orderNumber: 'ST-2611-000001',
	seller: { name: 'K.R. Marketing', gstin: GSTIN, address: 'Barasat', stateCode: '19' },
	buyer: { name: 'Rang Mahal', gstin: '27AAKFR1234M1Z2', address: 'Linking Road, Mumbai', stateCode: '27' },
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
const KEYS = {
	provider: 'irisIrp' as const,
	environment: 'sandbox' as const,
	baseUrl: 'https://sandbox.example',
	userName: 'api-user',
	password: 'pw',
	clientId: 'client-1234',
	clientSecret: 'secret',
	publicKeyPem: '-----BEGIN PUBLIC KEY-----x-----END PUBLIC KEY-----',
};

interface Options {
	gstin?: string | null;
	shopFails?: boolean;
	gatewayKind?: 'eInvoice' | 'eWayBill';
	noGateway?: boolean;
	testThrows?: unknown;
	generate?: () => Promise<EInvoiceResult>;
	byDocument?: () => Promise<EInvoiceResult | null>;
	invoices?: TaxInvoice[];
	locations?: unknown[];
	shop?: Record<string, unknown> | null;
}

function setup(options: Options = {}) {
	let settings: EDocSettings | null = null;
	const docs: EDocument[] = [];
	const calls: EDocCall[] = [];
	const repo = {
		getSettings: async () => settings,
		saveSettings: async (s: EDocSettings) => ((settings = s), s),
		findActive: async (kind: string, id: string) =>
			docs.find((d) => d.kind === kind && d.documentId === id && d.status === 'active') ?? null,
		insert: async (d: EDocument) => void docs.push(d),
		replace: async (d: EDocument) =>
			void docs.splice(
				docs.findIndex((x) => x.id === d.id),
				1,
				d,
			),
		list: async () => ({ rows: docs, total: docs.length }),
		logCall: async (c: EDocCall) => void calls.push(c),
		listCalls: async () => ({ rows: calls, total: calls.length }),
	} as unknown as EDocRepository;
	const stored = new Map<string, EDocSecrets>();
	const keys: EDocKeyStore = {
		available: true,
		put: async (g, p, s) => void stored.set(`${g}:${p}`, s),
		get: async (g, p) => stored.get(`${g}:${p}`) ?? null,
		remove: async (g, p) => void stored.delete(`${g}:${p}`),
	};
	const shop: ShopDetailsRepository = {
		get: async () => {
			if (options.shopFails) throw new Error('down');
			return 'shop' in options
				? (options.shop as never)
				: ({
						gstin: 'gstin' in options ? options.gstin : GSTIN,
						legalName: 'Legal',
						tradeName: 'K.R.',
					} as never);
		},
		save: async () => undefined,
	};
	let order = OrderSettings.parse({});
	const orderRepo: OrderSettingsRepository = { get: async () => order, save: async (s) => (order = s) };
	const sent: unknown[] = [];
	const gateway: EInvoiceGateway = {
		test: async () => {
			if ('testThrows' in options) throw options.testThrows;
		},
		generate: async (_g, json) => (sent.push(json), (options.generate ?? (async () => IRN))()),
		cancel: async () => ({ cancelledAt: '' }),
		byDocument: async () => (options.byDocument ?? (async () => IRN))(),
		gstinDetails: async () => ({}) as never,
		eWayBillByIrn: async () => ({}) as never,
	};
	const factory = {
		build: (): AnyEDocGateway | null =>
			options.noGateway ? null : ({ kind: options.gatewayKind ?? 'eInvoice', gateway } as AnyEDocGateway),
	} as unknown as EDocGatewayFactory;
	const service = new EDocsService(repo, keys, shop, orderRepo, factory);
	const bridge = new EDocsOrderBridge(
		service,
		{ listForOrder: async () => options.invoices ?? [] },
		{
			list: async () =>
				(options.locations ?? [
					{ id: 'loc_bar', address: 'K.B. Bose Road', city: 'Barasat', pin: '700124', phone: '' },
				]) as never,
		},
		shop,
	);
	const connect = async (path: 'irpDirect' | 'ewbDirect', enabledFrom: string | null = '2026-04-01') => {
		await service.saveKeys({ ...KEYS, path, provider: path === 'ewbDirect' ? 'nicEwb' : 'irisIrp' }, 'usr_1');
		const tested = await service.test(path, 'usr_1');
		const current = tested.settings ?? EDocSettings.parse({ gstin: GSTIN });
		await service.saveSettings(
			{
				eInvoicePath: path === 'irpDirect' ? path : current.eInvoicePath,
				eWayBillPath: path === 'ewbDirect' ? path : current.eWayBillPath,
				eWayBillWithEInvoice: true,
				eInvoiceEnabledFrom: enabledFrom,
				eWayBillThresholdINR: 50_000,
			},
			current.updatedAt,
			'usr_1',
		);
	};
	return {
		service,
		bridge,
		docs,
		calls,
		sent,
		stored,
		connect,
		settings: () => settings,
		setSettings: (s: EDocSettings) => (settings = s),
	};
}

const order = (patch: Record<string, unknown> = {}) =>
	({
		id: 'ord_1',
		orderNumber: 'ST-2611-000001',
		createdAt: '2026-11-22T10:00:00.000Z',
		buyer: { name: 'Rang Mahal', gstin: '27AAKFR1234M1Z2', email: 'a@b.test', mobile: { number: '9830012345' } },
		addresses: {
			delivery: { fullName: 'Rang Mahal', line1: 'Linking Road', city: 'Mumbai', postalCode: '400050' },
		},
		totalINR: 21_000,
		...patch,
	}) as never;

describe('e-document settings without a GSTIN, and their keys (addendum 2)', () => {
	it('works without a shop GSTIN only to say so', async () => {
		const { service } = setup({ gstin: null });
		expect(await service.view()).toMatchObject({ gstin: null, settings: null });
		expect(await service.eInvoiceEnabled()).toBe(false);
		expect(await service.automatic('eInvoice')).toBeNull();
		await expect(service.removeKeys('irpDirect')).rejects.toThrow('edoc_shop_gstin_needed');
		await service.recordForOrder(order(), 'eWayBill', 'manual', 'usr_1');
		expect(await setup({ shop: null }).service.gstin()).toBeNull();
	});

	it('refuses keys with no secrets at all, and dates a password only when one is typed', async () => {
		const { service, stored } = setup();
		await expect(
			service.saveKeys({ ...KEYS, path: 'irpDirect', password: '', clientId: '', clientSecret: '' }, null),
		).rejects.toBeInstanceOf(BadRequestException);
		stored.set(`${GSTIN}:irpProvider`, {
			password: 'pw',
			clientId: 'cid-9999',
			clientSecret: 's',
			publicKeyPem: null,
		});
		const view = await service.saveKeys(
			{ ...KEYS, path: 'irpProvider', provider: 'mastersIndia', password: '' },
			null,
		);
		expect(view.settings?.keys[0]).toMatchObject({ path: 'irpProvider', passwordSetOn: null, hasPublicKey: true });
	});

	it('switches a path back to by hand when its keys are removed, for either document', async () => {
		const { service, connect, settings } = setup();
		await connect('irpDirect');
		await connect('ewbDirect');
		expect(settings()).toMatchObject({ eInvoicePath: 'irpDirect', eWayBillPath: 'ewbDirect' });
		await service.removeKeys('irpDirect');
		await service.removeKeys('ewbDirect');
		expect(settings()).toMatchObject({ eInvoicePath: 'manual', eWayBillPath: 'manual', keys: [] });
	});

	it('needs keys and a buildable adapter to Test, and records each kind of failure', async () => {
		await expect(setup().service.test('irpDirect', null)).rejects.toBeInstanceOf(NotFoundException);
		const unbuildable = setup({ noGateway: true });
		await unbuildable.service.saveKeys({ ...KEYS, path: 'irpDirect' }, null);
		await expect(unbuildable.service.test('irpDirect', null)).rejects.toBeInstanceOf(NotFoundException);
		for (const [thrown, code, message] of [
			[new EDocRefusedError('2172', 'Wrong password'), '2172', 'Wrong password'],
			[new Error('boom'), 'error', 'boom'],
			['plain', 'error', 'error'],
		] as const) {
			const { service, calls } = setup({ testThrows: thrown });
			await service.saveKeys({ ...KEYS, path: 'irpDirect' }, null);
			await service.test('irpDirect', null);
			expect(calls.at(-1)).toMatchObject({ ok: false, code, message, by: 'system' });
		}
	});

	it('finds no automatic path when the chosen path has no keys or no adapter', async () => {
		const made = setup();
		made.setSettings(EDocSettings.parse({ gstin: GSTIN, eInvoicePath: 'irpDirect' }));
		expect(await made.service.automatic('eInvoice')).toBeNull();
		const unbuildable = setup();
		await unbuildable.connect('irpDirect');
		(unbuildable.stored as Map<string, EDocSecrets>).clear();
		expect(await unbuildable.service.automatic('eInvoice')).toBeNull();
	});

	it('lists records and the activity log', async () => {
		const { service } = setup();
		expect(await service.list({ kind: 'eInvoice' } as never)).toEqual({ rows: [], total: 0 });
		expect(await service.activity(1)).toEqual({ rows: [], total: 0 });
	});
});

describe('recording what was generated (D1)', () => {
	it('keeps an IRN made automatically, against the order before it has an invoice, dated today without an order date', async () => {
		const { service, docs, calls } = setup();
		const irn = { irn: IRN.irn, ackNo: IRN.ackNo, ackDate: IRN.ackDate, signedQr: IRN.signedQr };
		await service.recordForOrder(order({ eInvoice: irn, createdAt: undefined }), 'eInvoice', 'irpDirect', 'usr_1');
		expect(docs[0]).toMatchObject({
			kind: 'eInvoice',
			irn: IRN.irn,
			generatedAt: IRN.ackDate,
			ewbNumber: null,
			documentId: 'ord_1',
		});
		expect(calls.at(-1)).toMatchObject({ action: 'generate' });
		await service.recordForOrder(order({ eInvoice: null }), 'eInvoice', 'manual', 'usr_1', INVOICE);
		expect(docs.at(-1)).toMatchObject({ irn: null, generatedAt: null, documentNumber: INVOICE.number });
		await service.recordForOrder(order({ eWayBill: null, totalINR: undefined }), 'eWayBill', 'manual', 'usr_1');
		expect(docs.at(-1)).toMatchObject({ ewbNumber: null, validUntil: null, valueINR: null });
	});
});

describe('Generate on the order page through an automatic path (D1, AE7)', () => {
	it('starts quietly even when the shop can’t be read, and answers both ports', async () => {
		const failing = setup({ shopFails: true });
		await expect(failing.bridge.onModuleInit()).resolves.toBeUndefined();
		const { bridge, connect } = setup({ invoices: [INVOICE] });
		await connect('irpDirect');
		await bridge.onModuleInit();
		const eInvoice = eInvoicePortFrom(bridge);
		const eWayBill = eWayBillPortFrom(bridge);
		expect([eInvoice.connected, eWayBill.connected]).toEqual([true, false]);
		expect(await eInvoice.raise(order())).toMatchObject({ kind: 'raised' });
		expect(await eWayBill.raise(order())).toEqual({ kind: 'notConnected' });
	});

	it('leaves an automatic e-way bill by hand until Part B comes from the courier, and a wrong adapter too', async () => {
		const ewb = setup({ invoices: [INVOICE] });
		await ewb.connect('ewbDirect');
		expect(await ewb.bridge.raise(order(), 'eWayBill')).toEqual({ kind: 'notConnected' });
		expect(ewb.calls.at(-1)).toMatchObject({ code: 'part_b_needed', documentNumber: INVOICE.number });
		const wrong = setup({ invoices: [INVOICE], gatewayKind: 'eWayBill' });
		await wrong.connect('irpDirect');
		expect(await wrong.bridge.raise(order(), 'eInvoice')).toEqual({ kind: 'notConnected' });
	});

	it('cites the shipped invoice when none waits, and refuses before e-invoicing is enabled', async () => {
		const shipped = { ...INVOICE, shipmentId: 'shp_1' };
		const { bridge, connect, calls } = setup({ invoices: [shipped] });
		await connect('irpDirect', null);
		expect(await bridge.raise(order(), 'eInvoice')).toEqual({ kind: 'refused', message: 'einvoice_not_enabled' });
		expect(calls.at(-1)).toMatchObject({ code: 'einvoice_not_enabled' });
	});

	it('falls back to by hand when the IRP doesn’t answer, or its earlier IRN can’t be fetched', async () => {
		for (const thrown of [new Error('timeout'), 'no answer']) {
			const { bridge, connect, calls } = setup({
				invoices: [INVOICE],
				generate: async () => {
					throw thrown;
				},
			});
			await connect('irpDirect');
			expect(await bridge.raise(order(), 'eInvoice')).toEqual({ kind: 'notConnected' });
			expect(calls.at(-1)).toMatchObject({ code: 'unreachable' });
		}
		for (const byDocument of [async () => null, async () => Promise.reject(new Error('gone'))]) {
			const { bridge, connect, calls } = setup({
				invoices: [INVOICE],
				generate: async () => {
					throw new EDocRefusedError('2150', 'Duplicate IRN');
				},
				byDocument,
			});
			await connect('irpDirect');
			expect(await bridge.raise(order(), 'eInvoice')).toEqual({ kind: 'notConnected' });
			expect(calls.at(-1)).toMatchObject({ code: 'duplicate_not_found' });
		}
	});

	it('fills the parties from what is known, with stand-ins where nothing is', async () => {
		const { bridge, connect, sent } = setup({ invoices: [INVOICE], locations: [], shop: { gstin: GSTIN } });
		await connect('irpDirect');
		await bridge.raise(order({ addresses: undefined, buyer: undefined }), 'eInvoice');
		expect(sent[0]).toMatchObject({
			SellerDtls: { LglNm: 'K.R. Marketing', Addr1: 'Barasat', Loc: 'NA' },
			BuyerDtls: { LglNm: 'Rang Mahal', Addr1: 'Linking Road, Mumbai', Loc: 'NA' },
		});
	});
});
