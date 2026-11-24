import { randomUUID } from 'node:crypto';

import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
	AssetDisposal,
	DepreciationRow,
	DepreciationRun,
	FixedAsset,
	FixedAssetEdit,
	FixedAssetWrite,
} from '@saha-textile/contracts';
import {
	ASSET_CATEGORIES,
	monthlyDepreciation,
	resolveRole,
	type FixedAssetRepository,
	type GeneralLedgerRepository,
	type TransactionManagerPort,
} from '@saha-textile/core-domain';

import type { AuthenticatedPrincipal } from '../auth/session.guard';
import { FIXED_ASSET_REPOSITORY, GENERAL_LEDGER_REPOSITORY, TRANSACTION_MANAGER } from '../infra/tokens';
import { accountsRefusal } from '../ledger/accounts-refusal';
import { LedgerService } from '../ledger/ledger.service';

const refuse = (code: string) => new BadRequestException(accountsRefusal(code));
const paise = (inr: number) => Math.round(inr * 100);
const previousMonth = (month: string) => {
	const [y, m] = month.split('-').map(Number) as [number, number];
	return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
};
const monthEnd = (month: string) => {
	const [y, m] = month.split('-').map(Number) as [number, number];
	return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/** The ledger each kind of asset sits in, under Fixed assets, as the chart names it. */
export const ASSET_LEDGER_NAMES: Readonly<Record<string, string>> = {
	furniture: 'Furniture and fittings',
	computers: 'Computers',
	office_equipment: 'Office equipment',
	electrical: 'Electrical fittings',
	plant: 'Plant and machinery',
	vehicles: 'Vehicles',
	buildings: 'Buildings',
	software: 'Software',
};
export const ACCUMULATED_LEDGER_NAME = 'Accumulated depreciation';

/**
 * Fixed assets (accounts brief R1–R4). Each asset sits in its kind's ledger under Fixed assets; adding one either finds
 * its purchase already in the books or posts Asset Dr against the ledger it was paid from. Each month's depreciation is
 * posted once, as one journal: Depreciation Dr, Accumulated depreciation (under Fixed assets) Cr, per location; months
 * go in order.
 */
@Injectable()
export class AssetsService {
	constructor(
		@Inject(FIXED_ASSET_REPOSITORY) private readonly assets: FixedAssetRepository,
		@Inject(LedgerService) private readonly ledger: Pick<LedgerService, 'chart' | 'addLedger' | 'post'>,
		@Inject(GENERAL_LEDGER_REPOSITORY) private readonly books: Pick<GeneralLedgerRepository, 'findVoucherByKey'>,
		@Inject(TRANSACTION_MANAGER) private readonly transactions: TransactionManagerPort,
	) {}

	list(): Promise<FixedAsset[]> {
		return this.assets.list();
	}

	async get(id: string): Promise<FixedAsset> {
		const asset = await this.assets.get(id);
		if (!asset) throw new NotFoundException(accountsRefusal('fixed_asset_not_found'));
		return asset;
	}

	/** A ledger by name under Fixed assets, made when the chart doesn't have it yet. */
	private async ledgerUnderFixedAssets(name: string, by: string | null): Promise<string> {
		const chart = await this.ledger.chart();
		const group = chart.groups.find((g) => g.systemKey === 'fixed_assets');
		if (!group) throw refuse('books_not_set_up');
		const found = chart.ledgers.find((l) => l.groupId === group.id && l.name === name);
		if (found) return found.id;
		return (await this.ledger.addLedger({ name, groupId: group.id, active: true, expectedUpdatedAt: null }, by)).id;
	}

	private check(write: Pick<FixedAssetWrite, 'categoryKey' | 'residualINR'>, costINR: number) {
		if (!ASSET_CATEGORIES.some((c) => c.key === write.categoryKey)) throw refuse('asset_category_unknown');
		if (write.residualINR > costINR) throw refuse('asset_residual_above_cost');
	}

	/** R2 Save asset: its tag, its ledger, and its purchase posted when it isn't in the books yet. */
	async create(write: FixedAssetWrite, principal: AuthenticatedPrincipal | undefined, now = new Date()) {
		this.check(write, write.costINR);
		const by = principal?.userId ?? null;
		const assetLedgerId = await this.ledgerUnderFixedAssets(
			ASSET_LEDGER_NAMES[write.categoryKey] ?? write.categoryKey,
			by,
		);
		const id = `fa_${randomUUID()}`;
		const tag = `FA-${String((await this.assets.count()) + 1).padStart(4, '0')}`;
		const { acquisition, ...fields } = write;
		return this.transactions.withTransaction(async (context) => {
			const voucher =
				acquisition.kind === 'post'
					? await this.ledger.post(
							{
								kind: 'journal',
								date: write.putToUseOn,
								narration: `Fixed asset ${tag} · ${write.name}`,
								source: { type: 'fixedAsset', id, number: tag },
								idempotencyKey: `fixedAsset:${id}`,
								lines: [
									{
										ledger: { id: assetLedgerId },
										locationId: write.locationId,
										debitPaise: paise(write.costINR),
									},
									{
										ledger: { id: acquisition.ledgerId },
										locationId: write.locationId,
										creditPaise: paise(write.costINR),
									},
								],
							},
							context,
							by,
						)
					: null;
			const asset: FixedAsset = {
				...fields,
				id,
				tag,
				status: 'active',
				disposedOn: null,
				disposalINR: null,
				accumulatedPaise: 0,
				depreciatedThrough: null,
				assetLedgerId,
				acquisitionVoucherId: voucher?.id ?? null,
				createdBy: by,
				createdAt: now.toISOString(),
				updatedAt: now.toISOString(),
				version: 0,
			};
			try {
				await this.assets.insert(asset, context);
			} catch (error) {
				if (error instanceof Error && error.message === 'fixed_asset_tag_taken')
					throw new ConflictException(accountsRefusal('fixed_asset_changed'));
				throw error;
			}
			return asset;
		});
	}

	private async save(asset: FixedAsset, version: number) {
		try {
			return await this.assets.save(asset, version);
		} catch (error) {
			if (error instanceof Error && error.message === 'fixed_asset_changed')
				throw new ConflictException(accountsRefusal('fixed_asset_changed'));
			throw error;
		}
	}

	/** R4 Edit: the asset's details and its depreciation settings for the months still to come. */
	async update(id: string, edit: FixedAssetEdit, now = new Date()): Promise<FixedAsset> {
		const current = await this.get(id);
		if (current.status === 'disposed') throw refuse('fixed_asset_disposed');
		const { version, ...fields } = edit;
		this.check(fields, current.costINR);
		return this.save({ ...current, ...fields, updatedAt: now.toISOString() }, version);
	}

	/** R4 Dispose: depreciation stops after the month it goes; the sale itself is posted as a voucher. */
	async dispose(id: string, write: AssetDisposal, now = new Date()): Promise<FixedAsset> {
		const current = await this.get(id);
		if (current.status === 'disposed') throw refuse('fixed_asset_disposed');
		if (write.on < current.putToUseOn) throw refuse('fixed_asset_disposed_before_use');
		return this.save(
			{
				...current,
				status: 'disposed',
				disposedOn: write.on,
				disposalINR: write.proceedsINR,
				updatedAt: now.toISOString(),
			},
			write.version,
		);
	}

	/** Each asset's depreciation for the month, skipping ones already depreciated for it. */
	private async rows(month: string): Promise<{ asset: FixedAsset; row: DepreciationRow }[]> {
		const out: { asset: FixedAsset; row: DepreciationRow }[] = [];
		for (const asset of await this.assets.list()) {
			if (asset.depreciatedThrough && asset.depreciatedThrough >= month) continue;
			const amount = monthlyDepreciation(
				{
					costPaise: paise(asset.costINR),
					residualPaise: paise(asset.residualINR),
					putToUseOn: asset.putToUseOn,
					method: asset.method,
					lifeMonths: asset.lifeMonths,
					accumulatedPaise: asset.accumulatedPaise,
					disposedOn: asset.disposedOn,
				},
				month,
			);
			if (!amount) continue;
			out.push({
				asset,
				row: {
					assetId: asset.id,
					tag: asset.tag,
					name: asset.name,
					method: asset.method,
					lifeMonths: asset.lifeMonths,
					costPaise: paise(asset.costINR),
					thisMonthPaise: amount,
					bookValueAfterPaise: paise(asset.costINR) - asset.accumulatedPaise - amount,
				},
			});
		}
		return out;
	}

	/** R3 Preview: the month's depreciation, or the journal it was posted in. */
	async preview(month: string): Promise<DepreciationRun> {
		const posted = await this.books.findVoucherByKey(`depreciation:${month}`);
		const rows = posted ? [] : (await this.rows(month)).map((r) => r.row);
		return {
			month,
			rows,
			totalPaise: rows.reduce((sum, r) => sum + r.thisMonthPaise, 0),
			voucherId: posted?.id ?? null,
		};
	}

	/** R3 Post: once per month, months in order; each asset keeps what it has taken. */
	async post(
		month: string,
		principal: AuthenticatedPrincipal | undefined,
		now = new Date(),
	): Promise<DepreciationRun> {
		if (await this.books.findVoucherByKey(`depreciation:${month}`)) throw refuse('depreciation_posted');
		const rows = await this.rows(month);
		if (!rows.length) throw refuse('depreciation_nothing');
		const before = previousMonth(month);
		const behind = rows.find(
			({ asset }) => (asset.depreciatedThrough ?? previousMonth(asset.putToUseOn.slice(0, 7))) < before,
		);
		if (behind) throw refuse('depreciation_earlier_month_first');
		const chart = await this.ledger.chart();
		let expense: string;
		try {
			expense = resolveRole(chart.ledgers, 'depreciation').id;
		} catch {
			throw refuse('books_not_set_up');
		}
		const by = principal?.userId ?? null;
		const accumulated = await this.ledgerUnderFixedAssets(ACCUMULATED_LEDGER_NAME, by);
		const byLocation = new Map<string, number>();
		for (const { asset, row } of rows)
			byLocation.set(asset.locationId, (byLocation.get(asset.locationId) ?? 0) + row.thisMonthPaise);
		const voucher = await this.transactions.withTransaction(async (context) => {
			const posted = await this.ledger.post(
				{
					kind: 'journal',
					date: monthEnd(month),
					narration: `Depreciation for ${month}`,
					source: { type: 'depreciation', id: month, number: null },
					idempotencyKey: `depreciation:${month}`,
					lines: [...byLocation.entries()].flatMap(([locationId, amount]) => [
						{ ledger: { id: expense }, locationId, debitPaise: amount },
						{ ledger: { id: accumulated }, locationId, creditPaise: amount },
					]),
				},
				context,
				by,
			);
			for (const { asset, row } of rows)
				await this.assets.save(
					{
						...asset,
						accumulatedPaise: asset.accumulatedPaise + row.thisMonthPaise,
						depreciatedThrough: month,
						updatedAt: now.toISOString(),
					},
					asset.version,
					context,
				);
			return posted;
		});
		return {
			month,
			rows: rows.map((r) => r.row),
			totalPaise: rows.reduce((sum, r) => sum + r.row.thisMonthPaise, 0),
			voucherId: voucher.id,
		};
	}
}
