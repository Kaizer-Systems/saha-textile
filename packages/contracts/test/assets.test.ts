import { describe, expect, it } from 'vitest';

import {
	AssetAcquisition,
	AssetDisposal,
	AssetMethod,
	AssetStatus,
	DepreciationRow,
	DepreciationRun,
	FixedAsset,
	FixedAssetEdit,
	FixedAssetWrite,
} from '../src/assets';

/** Fixed assets (accounts brief R1–R4): the register, its edits and disposals, and the month's depreciation run. */

const accepted = (input: unknown) => expect(input).toBe(true);
const refused = (input: unknown) => expect(input).toBe(false);

/** The approved R3 picture's machine: ₹3,50,000, ₹17,500 residual, ten years. */
const write = {
	name: '  Embroidery machine ',
	categoryKey: 'plant',
	locationId: 'loc_kolkata',
	costINR: 350_000,
	putToUseOn: '2026-08-15',
	lifeMonths: 120,
	residualINR: 17_500,
	taxRatePct: 15,
};

describe('how an asset is depreciated and where it stands', () => {
	it('is depreciated by straight line or written-down value, and is active or disposed', () => {
		expect(AssetMethod.options).toEqual(['slm', 'wdv']);
		expect(AssetStatus.options).toEqual(['active', 'disposed']);
	});

	it('reaches the books through a purchase already posted, or by posting against a ledger', () => {
		expect(AssetAcquisition.parse({ kind: 'books' })).toEqual({ kind: 'books' });
		expect(AssetAcquisition.parse({ kind: 'post', ledgerId: 'led_capital' })).toEqual({
			kind: 'post',
			ledgerId: 'led_capital',
		});
		refused(AssetAcquisition.safeParse({ kind: 'post' }).success);
		refused(AssetAcquisition.safeParse({ kind: 'post', ledgerId: '' }).success);
		refused(AssetAcquisition.safeParse({ kind: 'gift' }).success);
	});
});

describe('adding an asset', () => {
	it('takes a name and the money, straight line monthly, input GST claimed and the purchase already in the books', () => {
		expect(FixedAssetWrite.parse(write)).toEqual({
			...write,
			name: 'Embroidery machine',
			method: 'slm',
			run: 'monthly',
			inputGst: 'claimed',
			reference: '',
			acquisition: { kind: 'books' },
		});
		expect(
			FixedAssetWrite.parse({
				...write,
				method: 'wdv',
				run: 'yearly',
				inputGst: 'blocked',
				reference: ' PE/26-27/0012 line 1 ',
				acquisition: { kind: 'post', ledgerId: 'led_capital' },
			}),
		).toMatchObject({
			method: 'wdv',
			run: 'yearly',
			inputGst: 'blocked',
			reference: 'PE/26-27/0012 line 1',
			acquisition: { kind: 'post', ledgerId: 'led_capital' },
		});
	});

	it('takes a name of 2 to 120 letters and a category of 2 to 40', () => {
		refused(FixedAssetWrite.safeParse({ ...write, name: ' A ' }).success);
		accepted(FixedAssetWrite.safeParse({ ...write, name: 'x'.repeat(120) }).success);
		refused(FixedAssetWrite.safeParse({ ...write, name: 'x'.repeat(121) }).success);
		refused(FixedAssetWrite.safeParse({ ...write, categoryKey: 'p' }).success);
		refused(FixedAssetWrite.safeParse({ ...write, categoryKey: 'x'.repeat(41) }).success);
		refused(FixedAssetWrite.safeParse({ ...write, locationId: '' }).success);
	});

	it('takes a cost above nothing up to ₹10,000 crore, and a residual of nothing or more', () => {
		refused(FixedAssetWrite.safeParse({ ...write, costINR: 0 }).success);
		refused(FixedAssetWrite.safeParse({ ...write, costINR: -1 }).success);
		accepted(FixedAssetWrite.safeParse({ ...write, costINR: 100_000_000_000 }).success);
		refused(FixedAssetWrite.safeParse({ ...write, costINR: 100_000_000_001 }).success);
		accepted(FixedAssetWrite.safeParse({ ...write, residualINR: 0 }).success);
		refused(FixedAssetWrite.safeParse({ ...write, residualINR: -1 }).success);
	});

	it('takes a life of 1 to 1,200 whole months and a tax rate of 0 to 100%', () => {
		accepted(FixedAssetWrite.safeParse({ ...write, lifeMonths: 1 }).success);
		accepted(FixedAssetWrite.safeParse({ ...write, lifeMonths: 1_200 }).success);
		refused(FixedAssetWrite.safeParse({ ...write, lifeMonths: 0 }).success);
		refused(FixedAssetWrite.safeParse({ ...write, lifeMonths: 1_201 }).success);
		refused(FixedAssetWrite.safeParse({ ...write, lifeMonths: 12.5 }).success);
		accepted(FixedAssetWrite.safeParse({ ...write, taxRatePct: 0 }).success);
		accepted(FixedAssetWrite.safeParse({ ...write, taxRatePct: 100 }).success);
		refused(FixedAssetWrite.safeParse({ ...write, taxRatePct: 101 }).success);
		refused(FixedAssetWrite.safeParse({ ...write, taxRatePct: -1 }).success);
	});

	it('refuses an unknown method, run or GST treatment, a day in the wrong shape and a long reference', () => {
		refused(FixedAssetWrite.safeParse({ ...write, method: 'sum_of_years' }).success);
		refused(FixedAssetWrite.safeParse({ ...write, run: 'weekly' }).success);
		refused(FixedAssetWrite.safeParse({ ...write, inputGst: 'partial' }).success);
		refused(FixedAssetWrite.safeParse({ ...write, putToUseOn: '15-08-2026' }).success);
		refused(FixedAssetWrite.safeParse({ ...write, reference: 'x'.repeat(121) }).success);
	});
});

describe('an asset in the register', () => {
	const saved = {
		...FixedAssetWrite.parse(write),
		id: 'fa_7',
		tag: 'FA-0007',
		status: 'active',
		assetLedgerId: 'led_plant',
		createdBy: 'adm_1',
		createdAt: '2026-08-15T05:00:00.000Z',
		updatedAt: '2026-08-15T05:00:00.000Z',
		version: 0,
	};

	it('keeps its tag, ledger and version; not disposed, no depreciation yet, no voucher of its own', () => {
		const { acquisition: _acquisition, ...register } = saved;
		expect(FixedAsset.parse(saved)).toEqual({
			...register,
			disposedOn: null,
			disposalINR: null,
			accumulatedPaise: 0,
			depreciatedThrough: null,
			acquisitionVoucherId: null,
		});
	});

	it('keeps its depreciation so far and its disposal once there is one', () => {
		const disposed = {
			...saved,
			status: 'disposed',
			disposedOn: '2027-03-10',
			disposalINR: 300_000,
			accumulatedPaise: 2_216_664,
			depreciatedThrough: '2027-03',
			acquisitionVoucherId: 'vch_acq',
		};
		expect(FixedAsset.parse(disposed)).toMatchObject({
			status: 'disposed',
			disposedOn: '2027-03-10',
			disposalINR: 300_000,
			accumulatedPaise: 2_216_664,
			depreciatedThrough: '2027-03',
		});
		refused(FixedAsset.safeParse({ ...saved, accumulatedPaise: -1 }).success);
		refused(FixedAsset.safeParse({ ...saved, accumulatedPaise: 0.5 }).success);
		refused(FixedAsset.safeParse({ ...saved, depreciatedThrough: '2027-3' }).success);
		refused(FixedAsset.safeParse({ ...saved, disposalINR: -1 }).success);
		refused(FixedAsset.safeParse({ ...saved, status: 'sold' }).success);
		refused(FixedAsset.safeParse({ ...saved, createdBy: undefined }).success);
	});

	it('edits everything but its cost, the day put to use and how it reached the books, at its version', () => {
		const { costINR: _cost, putToUseOn: _day, ...rest } = write;
		const edit = FixedAssetEdit.parse({
			...write,
			acquisition: { kind: 'post', ledgerId: 'led_capital' },
			lifeMonths: 96,
			version: 2,
		});
		expect(edit).toEqual({
			...rest,
			name: 'Embroidery machine',
			lifeMonths: 96,
			method: 'slm',
			run: 'monthly',
			inputGst: 'claimed',
			reference: '',
			version: 2,
		});
		expect(edit).not.toHaveProperty('costINR');
		expect(edit).not.toHaveProperty('putToUseOn');
		expect(edit).not.toHaveProperty('acquisition');
		accepted(FixedAssetEdit.safeParse({ ...rest, version: 0 }).success);
		refused(FixedAssetEdit.safeParse(rest).success);
		refused(FixedAssetEdit.safeParse({ ...rest, version: -1 }).success);
	});
});

describe('disposing of an asset and the month’s depreciation', () => {
	it('disposes on a day for what it sold for, nothing when scrapped, at its version', () => {
		const sold = { on: '2027-03-10', proceedsINR: 300_000, version: 3 };
		expect(AssetDisposal.parse(sold)).toEqual(sold);
		accepted(AssetDisposal.safeParse({ ...sold, proceedsINR: 0 }).success);
		refused(AssetDisposal.safeParse({ ...sold, proceedsINR: -1 }).success);
		refused(AssetDisposal.safeParse({ ...sold, on: '10/03/2027' }).success);
		refused(AssetDisposal.safeParse({ ...sold, version: undefined }).success);
	});

	it('shows each asset’s depreciation for the month and its book value after, in whole paise, and the journal once posted', () => {
		const row = {
			assetId: 'fa_7',
			tag: 'FA-0007',
			name: 'Embroidery machine',
			method: 'slm',
			lifeMonths: 120,
			costPaise: 35_000_000,
			thisMonthPaise: 277_083,
			bookValueAfterPaise: 34_722_917,
		};
		expect(DepreciationRow.parse(row)).toEqual(row);
		refused(DepreciationRow.safeParse({ ...row, thisMonthPaise: 277_083.33 }).success);
		refused(DepreciationRow.safeParse({ ...row, method: 'units' }).success);
		const run = { month: '2026-08', rows: [row], totalPaise: 277_083, voucherId: null };
		expect(DepreciationRun.parse(run)).toEqual(run);
		expect(DepreciationRun.parse({ ...run, voucherId: 'vch_dep_2608' }).voucherId).toBe('vch_dep_2608');
		refused(DepreciationRun.safeParse({ ...run, month: '2026-13' }).success);
		refused(DepreciationRun.safeParse({ ...run, voucherId: undefined }).success);
	});
});
