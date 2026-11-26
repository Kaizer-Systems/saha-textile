import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	makeSuppliersBusinesses,
	prepareOrdersBusinessesAndZones,
	seedDocumentNumbering,
	seedRetailZone,
} from '../src/migrations/orders-businesses-zones';

/** The models the migration reads and writes, as in-memory stand-ins: every branch, no database. */
const state = vi.hoisted(() => ({
	suppliers: [] as Array<{ _id: string; shortName?: string }>,
	numberingExists: false,
	inventory: null as null | { numberFormats?: Record<string, string> },
	issued: [] as string[],
	zoneUpserted: 1,
	writes: [] as unknown[][],
}));
const lean = (value: () => unknown) => ({ lean: () => ({ exec: async () => value() }) });
const write = (...args: unknown[]) => ({ exec: async () => void state.writes.push(args) });

vi.mock('../src/models/orders-build.model', () => ({
	PriceZoneModel: { updateOne: () => ({ exec: async () => ({ upsertedCount: state.zoneUpserted }) }) },
}));
vi.mock('../src/models/purchasing.model', () => ({
	SupplierModel: { find: () => lean(() => state.suppliers), updateOne: (...args: unknown[]) => write(...args) },
	InventorySettingsModel: { findById: () => lean(() => state.inventory) },
	SequenceModel: {
		exists: (query: { _id: { $regex: string } }) => ({
			exec: async () => state.issued.some((key) => new RegExp(query._id.$regex).test(key)),
		}),
	},
}));
vi.mock('../src/models/index', () => ({
	SiteSettingModel: {
		exists: () => ({ exec: async () => state.numberingExists }),
		updateOne: (...args: unknown[]) => write(...args),
	},
}));

beforeEach(() => {
	state.suppliers = [];
	state.numberingExists = false;
	state.inventory = null;
	state.issued = [];
	state.zoneUpserted = 1;
	state.writes = [];
});

describe('the orders, businesses and zones migration (no database)', () => {
	it('makes each supplier a business, with an empty trade name when it had no short name', async () => {
		state.suppliers = [{ _id: 's1', shortName: 'Weavers' }, { _id: 's2' }];
		expect(await makeSuppliersBusinesses()).toBe(2);
		expect(state.writes.map((args) => (args[1] as { $set: { tradeName: string } }).$set.tradeName)).toEqual([
			'Weavers',
			'',
		]);
	});

	it('writes the RETAIL zone once, with or without a given time', async () => {
		expect(await seedRetailZone('2026-11-20T00:00:00.000Z')).toBe(true);
		state.zoneUpserted = 0;
		expect(await seedRetailZone()).toBe(false);
	});

	it('leaves numbering already written alone', async () => {
		state.numberingExists = true;
		expect(await seedDocumentNumbering()).toEqual([]);
		expect(state.writes).toEqual([]);
	});

	it('keeps the format each issued purchases series used, its stored one or the default, and skips an odd one', async () => {
		state.issued = ['PE:2026-27', 'PO:2026-27', 'OS:2026-27'];
		state.inventory = { numberFormats: { purchaseOrder: 'PO-{seq5}', openingStock: 'odd' } };
		expect(await seedDocumentNumbering()).toEqual(['purchaseEntry', 'purchaseOrder', 'openingStock']);
		const value = (
			state.writes[0]?.[1] as {
				$setOnInsert: { value: { series: Record<string, unknown>; lockedTypes: string[] } };
			}
		).$setOnInsert.value;
		expect(value.series.purchaseEntry).toMatchObject({ prefix: 'PE', includeFinancialYear: true, digits: 6 });
		expect(value.series.purchaseOrder).toMatchObject({
			prefix: 'PO',
			separator: '-',
			includeFinancialYear: false,
			digits: 5,
		});
		expect(value.lockedTypes).toEqual(expect.arrayContaining(['purchaseEntry', 'purchaseOrder', 'openingStock']));
	});

	it('reads a database without stock settings as using the default formats', async () => {
		state.issued = ['SC:2026-27'];
		expect(await seedDocumentNumbering()).toEqual(['stockCount']);
	});

	it('reports in words: one or several suppliers, the zone written or not, numbering kept or not', async () => {
		state.suppliers = [{ _id: 's1' }];
		expect(await prepareOrdersBusinessesAndZones()).toBe(
			'1 supplier made business; RETAIL zone written; numbering as the accepted table',
		);
		state.suppliers = [{ _id: 's1' }, { _id: 's2' }];
		state.zoneUpserted = 0;
		state.issued = ['DN:2026-27'];
		expect(await prepareOrdersBusinessesAndZones()).toBe(
			'2 suppliers made businesses; RETAIL zone already there; kept the issued format of debitNote',
		);
	});
});
