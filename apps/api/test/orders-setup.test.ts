import {
	DEFAULT_DOCUMENT_NUMBERING,
	PriceZone,
	ZonePricingSettings,
	type Coupon,
	type DocumentNumberingSettings,
} from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { CouponsService } from '../src/orders-setup/coupons.service';
import { OrderSettingsService } from '../src/orders-setup/order-settings.service';
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
const wholesale = PriceZone.parse({
	id: 'zone_w',
	code: 'WHOLESALE',
	name: 'Wholesale',
	priceList: { allProducts: { kind: 'percentOffRetail', percent: 20 }, categories: [], products: [] },
});

function zoneService(settings = ZonePricingSettings.parse({}), businesses = 0) {
	const zones = new Map([
		[retail.id, retail],
		[wholesale.id, wholesale],
	]);
	const repo = {
		list: async () => [...zones.values()],
		findById: async (id: string) => zones.get(id) ?? null,
		save: async (zone: PriceZone) => {
			zones.set(zone.id, zone);
			return zone;
		},
		delete: async (id: string) => void zones.delete(id),
		getSettings: async () => settings,
	};
	return new ZonesService(repo as never, { countByZone: async () => businesses } as never);
}

describe('zones (DEC-B2B-ZONES)', () => {
	it('keeps RETAIL out of editing and deleting', async () => {
		const service = zoneService();
		await expect(
			service.update(
				'zone_retail',
				{ code: 'RETAIL', name: 'x', description: '', priceList: wholesale.priceList, revision: 0 },
				'adm',
			),
		).rejects.toThrow();
		await expect(service.remove('zone_retail', 'adm')).rejects.toThrow();
	});

	it('refuses Go live while a zone setting is unchosen, and allows it once chosen', async () => {
		await expect(zoneService().setStatus('zone_w', 'live', 0, 'adm')).rejects.toThrow();
		const chosen = ZonePricingSettings.parse({ saleMeetsZone: 'lowerOfTheTwo', gstInZonePrice: 'included' });
		await expect(zoneService(chosen).setStatus('zone_w', 'live', 0, 'adm')).resolves.toMatchObject({
			status: 'live',
		});
	});

	it('lists the settings each zone still needs, none for RETAIL', async () => {
		const rows = await zoneService().list();
		expect(rows.find((row) => row.id === 'zone_retail')?.settingsNeeded).toEqual([]);
		expect(rows.find((row) => row.id === 'zone_w')?.settingsNeeded).toEqual(['gstInZonePrice', 'saleMeetsZone']);
	});

	it('refuses deleting a zone businesses use', async () => {
		await expect(zoneService(ZonePricingSettings.parse({}), 2).remove('zone_w', 'adm')).rejects.toThrow();
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
		expect(rows.find((row) => row.type === 'order')?.example).toMatch(/^ST-\d{5}-\d{5}$/);
		expect(rows.find((row) => row.type === 'taxInvoice')).toMatchObject({
			gst: true,
			resetsEachYear: true,
			locked: false,
		});
	});

	it('refuses a GST format over 16 characters and a change to a locked series', async () => {
		const { lockedTypes, updatedAt, updatedBy, orderFormatChosenByOwner, ...write } = {
			...DEFAULT_DOCUMENT_NUMBERING,
			lockedTypes: [],
		};
		void lockedTypes;
		void updatedAt;
		void updatedBy;
		void orderFormatChosenByOwner;
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
