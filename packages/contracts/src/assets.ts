import { z } from 'zod';

import { Id, IsoDateTime } from './common';
import { YearMonth } from './ledger';
import { IsoDate } from './purchasing';

/**
 * Fixed assets (accounts brief R1–R4): the register, each asset's book and tax depreciation, and the month's
 * depreciation run posted once as one journal.
 */

export const AssetMethod = z.enum(['slm', 'wdv']);
export type AssetMethod = z.infer<typeof AssetMethod>;

export const AssetStatus = z.enum(['active', 'disposed']);
export type AssetStatus = z.infer<typeof AssetStatus>;

/** How the asset reaches the books: its purchase is already posted, or this posts Asset Dr against a ledger. */
export const AssetAcquisition = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('books') }),
	z.object({ kind: z.literal('post'), ledgerId: Id }),
]);
export type AssetAcquisition = z.infer<typeof AssetAcquisition>;

export const FixedAssetWrite = z.object({
	name: z.string().trim().min(2).max(120),
	categoryKey: z.string().trim().min(2).max(40),
	locationId: Id,
	costINR: z.number().positive().max(100_000_000_000),
	putToUseOn: IsoDate,
	method: AssetMethod.default('slm'),
	lifeMonths: z.number().int().min(1).max(1200),
	residualINR: z.number().nonnegative(),
	run: z.enum(['monthly', 'yearly']).default('monthly'),
	taxRatePct: z.number().min(0).max(100),
	inputGst: z.enum(['claimed', 'blocked']).default('claimed'),
	/** Where it came from, as the owner wrote it (a purchase entry and line, a bill). */
	reference: z.string().trim().max(120).default(''),
	acquisition: AssetAcquisition.default({ kind: 'books' }),
});
export type FixedAssetWrite = z.infer<typeof FixedAssetWrite>;
export type FixedAssetWriteInput = z.input<typeof FixedAssetWrite>;

export const FixedAsset = FixedAssetWrite.omit({ acquisition: true }).extend({
	id: Id,
	/** FA-0007. */
	tag: z.string(),
	status: AssetStatus,
	disposedOn: IsoDate.nullable().default(null),
	disposalINR: z.number().nonnegative().nullable().default(null),
	/** Book depreciation taken so far (paise), and the last month it was taken for. */
	accumulatedPaise: z.number().int().nonnegative().default(0),
	depreciatedThrough: YearMonth.nullable().default(null),
	assetLedgerId: Id,
	acquisitionVoucherId: Id.nullable().default(null),
	createdBy: Id.nullable(),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
	version: z.number().int().nonnegative(),
});
export type FixedAsset = z.infer<typeof FixedAsset>;

export const FixedAssetEdit = FixedAssetWrite.omit({ acquisition: true, costINR: true, putToUseOn: true }).extend({
	version: z.number().int().nonnegative(),
});
export type FixedAssetEdit = z.infer<typeof FixedAssetEdit>;

export const AssetDisposal = z.object({
	on: IsoDate,
	/** What it sold for (0 when scrapped). */
	proceedsINR: z.number().nonnegative(),
	version: z.number().int().nonnegative(),
});
export type AssetDisposal = z.infer<typeof AssetDisposal>;

export const DepreciationRow = z.object({
	assetId: Id,
	tag: z.string(),
	name: z.string(),
	method: AssetMethod,
	lifeMonths: z.number().int(),
	costPaise: z.number().int(),
	thisMonthPaise: z.number().int(),
	bookValueAfterPaise: z.number().int(),
});
export type DepreciationRow = z.infer<typeof DepreciationRow>;

/** R3: a month's depreciation, before or after it is posted. */
export const DepreciationRun = z.object({
	month: YearMonth,
	rows: z.array(DepreciationRow),
	totalPaise: z.number().int(),
	/** The journal, once posted for the month. */
	voucherId: Id.nullable(),
});
export type DepreciationRun = z.infer<typeof DepreciationRun>;

/** R2's presets: each kind's Schedule II life and Income Tax block rate, and the residual % suggested. */
export const AssetCategories = z.object({
	categories: z.array(z.object({ key: z.string(), lifeYears: z.number(), taxRatePct: z.number() })),
	residualPercent: z.number(),
});
export type AssetCategories = z.infer<typeof AssetCategories>;
