import { StockTransfer, TRANSFER_CHIPS, type TransferChip } from '@saha-textile/contracts';
import type { TransactionContext, TransferRepository } from '@saha-textile/core-domain';

import type { AggregateDoc } from '../models/purchasing.model';
import { StockTransferModel } from '../models/transfer.model';
import { sessionFrom } from '../transaction-manager';

const transferOf = (doc: AggregateDoc): StockTransfer => {
	const { _id, ...rest } = doc;
	return StockTransfer.parse({ ...rest, id: _id });
};
const docOf = (transfer: StockTransfer) => {
	const { id, ...rest } = transfer;
	return { _id: id, ...rest };
};
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The start of an India day as an instant, for a range on `createdAt`. */
const istStart = (day: string): string => new Date(`${day}T00:00:00+05:30`).toISOString();
const nextDay = (day: string): string => {
	const date = new Date(`${day}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + 1);
	return date.toISOString().slice(0, 10);
};

const CHIP_FILTERS: Record<TransferChip, Record<string, unknown>> = {
	all: {},
	requested: { status: 'requested' },
	packing: { status: 'packing' },
	in_transit: { status: 'in_transit' },
	received_short: { status: 'received_short' },
};

/** Stock transfers in MongoDB (`stockTransfers`); every write takes the caller's transaction. */
export class MongoTransferRepository implements TransferRepository {
	async insert(transfer: StockTransfer, context?: TransactionContext): Promise<void> {
		await StockTransferModel.create([docOf(transfer)], { session: sessionFrom(context) });
	}

	async get(id: string, context?: TransactionContext): Promise<StockTransfer | null> {
		const doc = await StockTransferModel.findById(id)
			.session(sessionFrom(context) ?? null)
			.lean<AggregateDoc>()
			.exec();
		return doc ? transferOf(doc) : null;
	}

	async save(transfer: StockTransfer, expectedVersion: number, context?: TransactionContext): Promise<StockTransfer> {
		const next = { ...transfer, version: expectedVersion + 1 };
		const result = await StockTransferModel.replaceOne(
			{ _id: transfer.id, version: expectedVersion },
			docOf(next),
			{
				session: sessionFrom(context),
			},
		).exec();
		if (result.matchedCount === 0) throw new Error('transfer_changed');
		return next;
	}

	async list(query: Parameters<TransferRepository['list']>[0]) {
		const re = query.search ? new RegExp(escapeRegex(query.search), 'i') : null;
		const base: Record<string, unknown> = {
			createdAt: { $gte: istStart(query.from), $lt: istStart(nextDay(query.to)) },
			...(query.locationIds
				? {
						$or: [
							{ fromLocationId: { $in: [...query.locationIds] } },
							{ toLocationId: { $in: [...query.locationIds] } },
						],
					}
				: {}),
			...(re
				? {
						$and: [
							{
								$or: [
									{ number: re },
									{ challanNumber: re },
									{ 'lines.sku': re },
									{ 'lines.title': re },
								],
							},
						],
					}
				: {}),
		};
		const [docs, total, ...counts] = await Promise.all([
			StockTransferModel.find({ ...base, ...CHIP_FILTERS[query.chip] })
				.sort({ createdAt: -1, _id: -1 })
				.skip((query.page - 1) * query.pageSize)
				.limit(query.pageSize)
				.lean<AggregateDoc[]>()
				.exec(),
			StockTransferModel.countDocuments({ ...base, ...CHIP_FILTERS[query.chip] }).exec(),
			...TRANSFER_CHIPS.map((chip) =>
				StockTransferModel.countDocuments({ ...base, ...CHIP_FILTERS[chip] }).exec(),
			),
		]);
		return {
			items: docs.map(transferOf),
			total,
			counts: Object.fromEntries(TRANSFER_CHIPS.map((chip, i) => [chip, counts[i] as number])) as Record<
				TransferChip,
				number
			>,
		};
	}

	async inTransit(variantIds: readonly string[]): Promise<Record<string, number>> {
		if (!variantIds.length) return {};
		const rows = await StockTransferModel.aggregate<{ _id: string; quantity: number }>([
			{ $match: { status: 'in_transit', 'lines.variantId': { $in: [...variantIds] } } },
			{ $unwind: '$lines' },
			{ $match: { 'lines.variantId': { $in: [...variantIds] } } },
			{ $group: { _id: '$lines.variantId', quantity: { $sum: '$lines.packed' } } },
		]).exec();
		return Object.fromEntries(rows.map((row) => [row._id, row.quantity]));
	}

	async inTransitFrom(month: string): Promise<StockTransfer[]> {
		const docs = await StockTransferModel.find({
			status: 'in_transit',
			timeline: {
				$elemMatch: {
					status: 'in_transit',
					at: { $gte: istStart(`${month}-01`), $lt: istStart(nextMonth(month)) },
				},
			},
		})
			.lean<AggregateDoc[]>()
			.exec();
		return docs.map(transferOf);
	}
}

/** The first day of the month after `YYYY-MM`. */
function nextMonth(month: string): string {
	const [y, m] = month.split('-').map(Number) as [number, number];
	return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}
