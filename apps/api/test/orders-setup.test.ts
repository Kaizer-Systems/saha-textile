import {
	DEFAULT_DOCUMENT_NUMBERING,
	PriceZone,
	ZoneRule,
	type Coupon,
	type DocumentNumberingSettings,
} from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { BusinessesService, entryMoment } from '../src/orders-setup/businesses.service';
import { CouponsService } from '../src/orders-setup/coupons.service';
import { OrderSettingsService } from '../src/orders-setup/order-settings.service';
import { ZonePricingService } from '../src/orders-setup/zone-pricing.service';
import { ZonesService } from '../src/orders-setup/zones.service';

const coupon = (id: string, enabled = true): Coupon =>
	({
		id,
		code: id.toUpperCase(),
		title: id,
		kind: 'percentOff',
		value: 10,
		enabled,
		usedCount: 0,
		revision: 0,
	}) as unknown as Coupon;

function couponRepo(used: string[]) {
	const rows = new Map(['a', 'b', 'c'].map((id) => [id, coupon(id)]));
	return {
		rows,
		findById: async (id: string) => rows.get(id) ?? null,
		usedOnOrders: async (id: string) => used.includes(id),
		delete: async (ids: readonly string[]) => ids.filter((id) => rows.delete(id)),
		setEnabled: async (ids: readonly string[], enabled: boolean) =>
			ids.filter((id) => {
				const row = rows.get(id);
				if (row) rows.set(id, { ...row, enabled });
				return !!row;
			}),
	};
}

describe('coupons: bulk actions (owner, 2026-11-20)', () => {
	it('deletes unused coupons and turns used ones off instead', async () => {
		const repo = couponRepo(['b']);
		const service = new CouponsService(repo as never);
		const result = await service.bulk({ action: 'delete', ids: ['a', 'b', 'x'] }, 'adm');
		expect(result.done).toEqual(['a']);
		expect(result.refused).toEqual([
			{ id: 'b', code: 'B', reason: 'used_on_orders' },
			{ id: 'x', code: '', reason: 'not_found' },
		]);
		expect(repo.rows.get('b')?.enabled).toBe(false);
	});

	it('turns every ticked coupon on or off, on any page', async () => {
		const repo = couponRepo([]);
		const result = await new CouponsService(repo as never).bulk({ action: 'turnOff', ids: ['a', 'c'] }, 'adm');
		expect(result.done).toEqual(['a', 'c']);
		expect([...repo.rows.values()].filter((row) => !row.enabled).map((row) => row.id)).toEqual(['a', 'c']);
	});
});

const retail = PriceZone.parse({ id: 'zone_retail', code: 'RETAIL', name: 'Retail', system: true, status: 'live' });
const twentyOff = ZoneRule.parse({
	id: 'r1',
	scope: { tier: 'allProducts' },
	price: { kind: 'percentOffBase', base: 'regularSelling', percent: 20 },
});
const costRule = ZoneRule.parse({
	id: 'r2',
	scope: { tier: 'allProducts' },
	price: { kind: 'percentAboveCost', percent: 30 },
});
const broken = ZoneRule.parse({
	id: 'r3',
	scope: { tier: 'allProducts' },
	price: { kind: 'noPrice' },
	floorINR: 900,
	ceilingINR: 500,
});
const wholesale = PriceZone.parse({ id: 'zone_w', code: 'WHOLESALE', name: 'Wholesale', rules: [twentyOff] });

function zoneService(businesses = 0, stored: PriceZone = wholesale) {
	const zones = new Map([
		[retail.id, retail],
		[stored.id, stored],
	]);
	const repo = {
		list: async () => [...zones.values()],
		findById: async (id: string) => zones.get(id) ?? null,
		save: async (zone: PriceZone) => {
			zones.set(zone.id, zone);
			return zone;
		},
		delete: async (id: string) => void zones.delete(id),
	};
	return new ZonesService(repo as never, { countByZone: async () => businesses } as never);
}

describe('zones (DEC-B2B-ZONES): rules from the builder', () => {
	it('keeps RETAIL out of editing and deleting', async () => {
		const service = zoneService();
		await expect(
			service.update(
				'zone_retail',
				{ code: 'RETAIL', name: 'x', description: '', rules: [twentyOff], revision: 0 },
				'adm',
			),
		).rejects.toThrow();
		await expect(service.remove('zone_retail', 'adm')).rejects.toThrow();
	});

	it('goes live only when the builder finds no mistake in the rules', async () => {
		await expect(zoneService().setStatus('zone_w', 'live', 0, 'adm')).resolves.toMatchObject({ status: 'live' });
		const bad = PriceZone.parse({ ...wholesale, rules: [broken] });
		await expect(zoneService(0, bad).setStatus('zone_w', 'live', 0, 'adm')).rejects.toMatchObject({
			response: { issues: [{ code: 'zone_rule_problems', params: { rules: 'r3' } }] },
		});
	});

	it('raises the version when the rules change, not for a new name', async () => {
		const service = zoneService();
		const renamed = await service.update(
			'zone_w',
			{ code: 'WHOLESALE', name: 'Wholesale A', description: '', rules: [twentyOff], revision: 0 },
			'adm',
		);
		expect(renamed.version).toBe(1);
		const changed = await service.update(
			'zone_w',
			{
				code: 'WHOLESALE',
				name: 'Wholesale A',
				description: '',
				rules: [{ ...twentyOff, rounding: 'upToTen' }],
				revision: 0,
			},
			'adm',
		);
		expect(changed.version).toBe(2);
	});

	it('needs the cost permission for rules that read the purchase cost', async () => {
		const write = { code: 'COST', name: 'Cost plus', description: '', rules: [costRule] };
		await expect(zoneService().create(write, 'adm', false)).rejects.toMatchObject({
			response: { issues: [{ code: 'cost_permission_needed' }] },
		});
		await expect(zoneService().create(write, 'adm', true)).resolves.toMatchObject({ status: 'draft' });
	});

	it('lists rule counts and mistakes, none for RETAIL', async () => {
		const rows = await zoneService(0, PriceZone.parse({ ...wholesale, rules: [twentyOff, broken] })).list();
		expect(rows.find((row) => row.id === 'zone_retail')).toMatchObject({ ruleCount: 0, problems: [] });
		expect(rows.find((row) => row.id === 'zone_w')).toMatchObject({
			ruleCount: 2,
			problems: [{ ruleId: 'r3', problem: 'floor_above_ceiling' }],
		});
	});

	it('refuses deleting a zone businesses use', async () => {
		await expect(zoneService(2).remove('zone_w', 'adm')).rejects.toThrow();
	});
});

describe('zone Try it and the facts rules read', () => {
	const product = (id: string, soldBy: 'piece' | 'metre') => ({
		id,
		title: { en: id === 'p_saree' ? 'Kanjivaram saree' : 'Cotton fabric' },
		categoryIds: ['cat_kanjivaram'],
		soldBy,
	});
	const variant = (productId: string, sku: string, priceINR: number, salePriceINR: number | null) => ({
		id: `v_${sku}`,
		productId,
		sku,
		isBaseVariant: true,
		priceINR,
		compareAtPriceINR: 12_000,
		salePriceINR,
	});
	const rows = new Map([
		['p_saree', [variant('p_saree', 'SAR-1', 12_000, 10_000)]],
		['p_cloth', [variant('p_cloth', 'CLO-1', 500, null)]],
	]);
	const service = new ZonePricingService(
		{ findById: async (id: string) => product(id, id === 'p_saree' ? 'piece' : 'metre') } as never,
		{ listForProduct: async (id: string) => rows.get(id) ?? [] } as never,
		{
			tree: async () => [
				{ id: 'cat_silk', path: ['cat_silk'], ancestors: [] },
				{ id: 'cat_kanjivaram', path: ['cat_silk', 'cat_kanjivaram'], ancestors: ['cat_silk'] },
			],
		} as never,
		{
			priceFor: (row: { sku: string }) =>
				row.sku === 'SAR-1' ? { saleINR: 8_500, eventId: 'e1', endsAt: 'x' } : null,
		} as never,
		{
			listOpenLayers: async (variantId: string) =>
				variantId === 'v_CLO-1'
					? [{ unitCostINR: 30, quantityRemaining: 100 }]
					: [{ unitCostINR: 6_000, quantityRemaining: 2 }],
		} as never,
	);

	it('reads the regular price from the stored row and the sale price from the sale book', async () => {
		const [saree, cloth] = await service.factsFor([
			{ productId: 'p_saree', variantId: null, quantity: 2 },
			{ productId: 'p_cloth', variantId: null, quantity: 2.5 },
		]);
		expect(saree?.facts).toMatchObject({
			regularSellingINR: 10_000,
			currentSaleINR: 8_500,
			mrpINR: 12_000,
			purchaseCostINR: 6_000,
			categoryPaths: [['cat_kanjivaram', 'cat_silk']],
			metres: null,
		});
		expect(cloth?.facts).toMatchObject({
			regularSellingINR: 500,
			currentSaleINR: null,
			purchaseCostINR: 300,
			metres: 2.5,
		});
		expect(saree?.facts.orderGoodsINR).toBe(8_500 * 2 + 500 * 2.5);
	});

	it('tries unsaved rules line by line, with the trace', async () => {
		const result = await service.tryRules({
			rules: [
				ZoneRule.parse({
					id: 'cat',
					scope: { tier: 'category', categoryIds: ['cat_silk'] },
					price: { kind: 'percentOffBase', base: 'regularSelling', percent: 20 },
				}),
			],
			items: [
				{ productId: 'p_saree', variantId: null, quantity: 1 },
				{ productId: 'p_cloth', variantId: null, quantity: 1 },
			],
		});
		expect(result.lines[0]).toMatchObject({
			title: 'Kanjivaram saree',
			price: { kind: 'priced', unitPriceINR: 8_000, retailUnitPriceINR: 8_500 },
		});
		expect(result.lines[0]?.trace).toEqual(['tier:category', 'rule:cat', 'formula:percentOffBase']);
	});
});

describe('document numbers (DEC-NUMBERING)', () => {
	function service(stored: DocumentNumberingSettings) {
		let current = stored;
		return new OrderSettingsService(
			{} as never,
			{
				get: async () => current,
				save: async (next: DocumentNumberingSettings, revision: number) => {
					current = { ...next, revision: revision + 1 };
					return current;
				},
			} as never,
		);
	}

	it('shows an example of every row, the order row from the interim format', async () => {
		const { rows } = await service(DEFAULT_DOCUMENT_NUMBERING).getNumbering();
		expect(rows.find((row) => row.type === 'order')?.example).toMatch(/^ST-\d{4}-\d{6}$/);
		expect(rows.find((row) => row.type === 'taxInvoice')).toMatchObject({
			gst: true,
			resetsEachYear: true,
			locked: false,
		});
	});

	it('refuses a GST format over 16 characters and a change to a locked series', async () => {
		const { lockedTypes, updatedAt, updatedBy, ...write } = {
			...DEFAULT_DOCUMENT_NUMBERING,
			lockedTypes: [],
		};
		void lockedTypes;
		void updatedAt;
		void updatedBy;
		const tooLong = {
			...write,
			series: { ...write.series, taxInvoice: { ...write.series.taxInvoice, prefix: 'TAXINV', digits: 8 } },
		};
		await expect(service(DEFAULT_DOCUMENT_NUMBERING).saveNumbering(tooLong, 'adm')).rejects.toThrow();
		const locked = { ...DEFAULT_DOCUMENT_NUMBERING, lockedTypes: ['purchaseEntry' as const] };
		const changed = {
			...write,
			series: { ...write.series, purchaseEntry: { ...write.series.purchaseEntry, digits: 6 } },
		};
		await expect(service(locked).saveNumbering(changed, 'adm')).rejects.toThrow();
		await expect(service(locked).saveNumbering(write, 'adm')).resolves.toBeTruthy();
	});
});

describe('when a receipt or set-off sits in a business statement', () => {
	const now = new Date('2026-11-21T07:10:00Z'); // 12:40 in India
	it('dated today: the moment it is recorded, after this morning’s and this afternoon’s orders', () => {
		expect(entryMoment('2026-11-21', now)).toBe('2026-11-21T07:10:00.000Z');
	});
	it('dated earlier: the end of that day in India, after that day’s orders', () => {
		expect(entryMoment('2026-11-12', now)).toBe('2026-11-12T18:29:59.999Z');
	});
});

describe('businesses (bz02, bz05, so02; DEC-B2B-ZONES)', () => {
	const write = {
		legalName: 'Boutique Ltd',
		tradeName: 'Boutique',
		businessType: 'privateLimited' as const,
		kind: 'regular' as const,
		gstin: '27AAPFU0939F1ZV',
		pan: null,
		stateCode: '27',
		registeredAddress: { line: '1 Road', city: 'Mumbai', pin: '400001' },
		contacts: [],
		sellsToUs: false,
		customer: { zoneId: 'zone_w', creditLimitINR: 200000, creditDays: 30 },
		supplier: null,
		notes: null,
		active: true,
	};

	async function setup(balances: { receivable: number; payable: number } = { receivable: 0, payable: 0 }) {
		const saved: unknown[] = [];
		const entries: unknown[] = [];
		const zones = new Map([
			['zone_retail', { id: 'zone_retail', code: 'RETAIL', name: 'Retail', status: 'live' }],
			['zone_w', { id: 'zone_w', code: 'W', name: 'Wholesale', status: 'live' }],
		]);
		const service = new BusinessesService(
			{
				save: async (business: unknown) => (saved.push(business), business),
				findById: async () => saved.at(-1) ?? null,
			} as never,
			{
				balance: async (_id: string, side: 'receivable' | 'payable') => balances[side],
				append: async (entry: unknown) => (entries.push(entry), entry),
			} as never,
			{ findById: async (id: string) => zones.get(id) ?? null, list: async () => [...zones.values()] } as never,
			{ withTransaction: (work: (context: object) => Promise<unknown>) => work({}) } as never,
			{ issue: async (type: string) => (type === 'journal' ? 'JV/26-27/000001' : 'RC/26-27/000001') } as never,
		);
		return { service, saved, entries };
	}

	it('puts a business on RETAIL unless the admin may assign zones', async () => {
		const { service } = await setup();
		await expect(service.create(write, 'adm', false, true)).rejects.toThrow();
		const retail = await service.create(
			{ ...write, customer: { ...write.customer, zoneId: 'zone_retail' } },
			'adm',
			false,
			true,
		);
		expect(retail.roles.customer?.zoneId).toBe('zone_retail');
		const assigned = await service.create(write, 'adm', true, false);
		expect(assigned.roles.customer).toMatchObject({ zoneId: 'zone_w', creditLimitINR: 0 });
	});

	it('records a receipt as a credit on the receivable account with an RC number', async () => {
		const { service, entries } = await setup();
		await service.create({ ...write, customer: { ...write.customer, zoneId: 'zone_retail' } }, 'adm', false, true);
		const entry = await service.recordReceipt(
			'x',
			{
				method: 'upi',
				amountINR: 5000,
				reference: 'UTR1',
				receivedOn: '2026-11-20',
				note: null,
				allocations: [],
			},
			'adm',
		);
		expect(entry).toMatchObject({ side: 'receivable', amountINR: -5000, documentNumber: 'RC/26-27/000001' });
		expect(entries).toHaveLength(1);
	});

	it('refuses a set-off while the setting is never, and records one in both accounts under an agreement', async () => {
		const { service } = await setup({ receivable: 50000, payable: 20000 });
		await service.create(write, 'adm', true, true);
		const input = {
			amountINR: 20000,
			basis: { kind: 'standingAgreement' as const },
			note: 'agreed in writing',
			on: null,
		};
		await expect(service.recordSetOff('x', input, 'adm')).rejects.toThrow();
		const withAgreement = await setup({ receivable: 50000, payable: 20000 });
		const business = await withAgreement.service.create(write, 'adm', true, true);
		withAgreement.saved.push({
			...business,
			setOff: {
				mode: 'agreement',
				reference: 'SO-1',
				signedOn: '2026-04-01',
				validUntil: null,
				mediaId: 'med_1',
			},
		});
		const entries = await withAgreement.service.recordSetOff('x', input, 'adm');
		expect(entries.map((entry) => [entry.side, entry.amountINR, entry.documentNumber])).toEqual([
			['receivable', -20000, 'JV/26-27/000001'],
			['payable', -20000, 'JV/26-27/000001'],
		]);
	});
});

describe('what we owe a business, and reversing a set-off (bz01, so02, so04)', () => {
	const ledgerRows: Array<Record<string, unknown>> = [];
	const service = new BusinessesService(
		{ findById: async () => ({ id: 'biz_1', roles: { customer: null, supplier: true } }) } as never,
		{
			balance: async (_id: string, side: string) =>
				ledgerRows.filter((row) => row.side === side).reduce((sum, row) => sum + (row.amountINR as number), 0),
			list: async (_id: string, side: string) => ({
				rows: ledgerRows.filter((row) => row.side === side),
				total: 0,
				openingINR: 0,
			}),
			append: async (entry: Record<string, unknown>) => (ledgerRows.push(entry), entry),
		} as never,
		{ list: async () => [] } as never,
		{ withTransaction: (work: (context: object) => Promise<unknown>) => work({}) } as never,
		{ issue: async () => 'JV/26-27/000002' } as never,
		null,
		{
			forSupplier: async () => [
				{ status: 'posted', totals: { totalINR: 84_500 }, paidINR: 0, creditedINR: 0 },
				{ status: 'posted', totals: { totalINR: 40_000 }, paidINR: 0, creditedINR: 0 },
				{ status: 'draft', totals: { totalINR: 9_999 }, paidINR: 0, creditedINR: 0 },
			],
		} as never,
	);

	it('counts the unpaid posted purchase bills and our set-off entries', async () => {
		expect(await service.payableINR('biz_1')).toBe(124_500);
		ledgerRows.push({ id: 'led_1', side: 'payable', kind: 'setOff', amountINR: -18_400, documentId: 'jv_1' });
		ledgerRows.push({ id: 'led_2', side: 'receivable', kind: 'setOff', amountINR: -18_400, documentId: 'jv_1' });
		expect(await service.payableINR('biz_1')).toBe(106_100);
	});

	it('reverses a set-off once, in both accounts', async () => {
		const reversed = await service.reverseSetOff('biz_1', 'jv_1', 'Typed against the wrong business', 'adm');
		expect(reversed.map((row) => [row.side, row.amountINR, row.reversalOf])).toEqual([
			['receivable', 18_400, 'led_2'],
			['payable', 18_400, 'led_1'],
		]);
		expect(await service.payableINR('biz_1')).toBe(124_500);
		await expect(service.reverseSetOff('biz_1', 'jv_1', 'Again', 'adm')).rejects.toMatchObject({
			response: { issues: [{ code: 'setoff_already_reversed' }] },
		});
	});
});
