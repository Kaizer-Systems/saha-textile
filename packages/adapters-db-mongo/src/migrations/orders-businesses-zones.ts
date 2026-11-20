import {
	DEFAULT_DOCUMENT_NUMBERING,
	DocumentNumberingSettings,
	PriceZone,
	RETAIL_ZONE_CODE,
	RETAIL_ZONE_ID,
	type NumberedDocumentType,
	type SeriesFormat,
} from '@saha-textile/contracts';

import { PriceZoneModel } from '../models/orders-build.model';
import { InventorySettingsModel, SequenceModel, SupplierModel } from '../models/purchasing.model';
import { SiteSettingModel } from '../models/index';

/**
 * Migration 0010 (orders and checkout brief, approved 2026-11-20). Expand only; nothing is removed.
 *
 * 1. Every supplier row becomes a business with the supplier role: `roles.supplier = true`, no
 *    customer side, set-off off, its trade name from the short name. Rows already carrying roles are
 *    left alone. The purchases module reads the same row as before.
 * 2. The RETAIL zone (`DEC-B2B-ZONES`): a live system zone with no rules, written once.
 * 3. Document numbers (`DEC-NUMBERING`): the accepted table, written once. A purchases series that
 *    has already issued numbers in this database keeps the format it issued them with and is locked,
 *    so one type never runs two formats (GSTR-1 Table 13 reports one series per type).
 */

/** The purchases module's counters, by document type. */
const PURCHASE_SERIES: ReadonlyArray<{ type: NumberedDocumentType; series: string; formatKey: string }> = [
	{ type: 'purchaseEntry', series: 'PE', formatKey: 'purchaseEntry' },
	{ type: 'purchaseOrder', series: 'PO', formatKey: 'purchaseOrder' },
	{ type: 'openingStock', series: 'OS', formatKey: 'openingStock' },
	{ type: 'stockCount', series: 'SC', formatKey: 'stockCount' },
	{ type: 'debitNote', series: 'DN', formatKey: 'debitNote' },
	{ type: 'deliveryChallan', series: 'DC', formatKey: 'deliveryChallan' },
];

/** `PE/{fy}/{seq6}` → a series format. Null when the stored format has another shape. */
export function seriesFromPurchaseFormat(format: string): SeriesFormat | null {
	const match = /^([A-Z][A-Z0-9]{0,5})([/-])(?:\{fy\}\2)?\{seq(\d)\}$/.exec(format);
	if (!match) return null;
	return {
		prefix: match[1] as string,
		separator: match[2] as '/' | '-',
		includeFinancialYear: format.includes('{fy}'),
		digits: Number(match[3]),
		reset: 'fy',
	};
}

export async function makeSuppliersBusinesses(): Promise<number> {
	const docs = await SupplierModel.find({ roles: { $exists: false } }, { _id: 1, shortName: 1 })
		.lean<Array<{ _id: string; shortName?: string }>>()
		.exec();
	for (const doc of docs) {
		await SupplierModel.updateOne(
			{ _id: doc._id, roles: { $exists: false } },
			{
				$set: {
					roles: { supplier: true, customer: null },
					tradeName: doc.shortName ?? '',
					businessType: 'other',
					setOff: { mode: 'never' },
					businessRevision: 0,
				},
			},
		).exec();
	}
	return docs.length;
}

export async function seedRetailZone(now = new Date().toISOString()): Promise<boolean> {
	const zone = PriceZone.parse({
		id: RETAIL_ZONE_ID,
		code: RETAIL_ZONE_CODE,
		name: 'Retail',
		description: 'Normal shop pricing, sale events included. Every business starts here.',
		system: true,
		status: 'live',
		priceList: { allProducts: null, categories: [], products: [] },
		version: 1,
		revision: 0,
		createdAt: now,
		updatedAt: now,
		updatedBy: null,
	});
	const { id, ...rest } = zone;
	const result = await PriceZoneModel.updateOne({ _id: id }, { $setOnInsert: rest }, { upsert: true }).exec();
	return result.upsertedCount > 0;
}

export async function seedDocumentNumbering(): Promise<string[]> {
	if (await SiteSettingModel.exists({ _id: 'orders.numbering' }).exec()) return [];
	const settings: DocumentNumberingSettings = structuredClone(DEFAULT_DOCUMENT_NUMBERING);
	const inventory = await InventorySettingsModel.findById('inventory')
		.lean<{ numberFormats?: Record<string, string> }>()
		.exec();
	const kept: string[] = [];
	for (const row of PURCHASE_SERIES) {
		const issued = await SequenceModel.exists({ _id: { $regex: `^${row.series}:` } }).exec();
		if (!issued) continue;
		const stored = inventory?.numberFormats?.[row.formatKey] ?? `${row.series}/{fy}/{seq6}`;
		const format = seriesFromPurchaseFormat(stored);
		if (format) settings.series[row.type] = format;
		settings.lockedTypes.push(row.type);
		kept.push(row.type);
	}
	await SiteSettingModel.updateOne(
		{ _id: 'orders.numbering' },
		{ $setOnInsert: { value: DocumentNumberingSettings.parse(settings) } },
		{ upsert: true },
	).exec();
	return kept;
}

export async function prepareOrdersBusinessesAndZones(): Promise<string> {
	const businesses = await makeSuppliersBusinesses();
	const retail = await seedRetailZone();
	const kept = await seedDocumentNumbering();
	return [
		`${businesses} supplier${businesses === 1 ? '' : 's'} made business${businesses === 1 ? '' : 'es'}`,
		retail ? 'RETAIL zone written' : 'RETAIL zone already there',
		kept.length ? `kept the issued format of ${kept.join(', ')}` : 'numbering as the accepted table',
	].join('; ');
}
