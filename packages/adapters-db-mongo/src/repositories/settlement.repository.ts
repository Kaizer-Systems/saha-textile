import { Settlement, type SettlementKind, type SettlementListQuery } from '@saha-textile/contracts';
import type { SettlementRepository, TransactionContext } from '@saha-textile/core-domain';

import { SettlementModel } from '../models/bank.model';
import type { AggregateDoc } from '../models/purchasing.model';
import { sessionFrom } from '../transaction-manager';

const withId = (doc: AggregateDoc) => {
	const { _id, ...rest } = doc;
	return Settlement.parse({ ...rest, id: _id });
};

/** Gateway payouts and courier COD remittances in MongoDB (`settlements`). */
export class MongoSettlementRepository implements SettlementRepository {
	async insert(settlement: Settlement, context?: TransactionContext): Promise<void> {
		const { id, ...rest } = settlement;
		await SettlementModel.create([{ _id: id, ...rest }], { session: sessionFrom(context) });
	}

	async get(id: string): Promise<Settlement | null> {
		const doc = await SettlementModel.findById(id).lean<AggregateDoc>().exec();
		return doc ? withId(doc) : null;
	}

	async list(query: SettlementListQuery) {
		const range = { date: { $gte: query.from, $lte: query.to } };
		const chosen = { ...range, kind: query.kind };
		const [docs, total, gateway, cod] = await Promise.all([
			SettlementModel.find(chosen)
				.sort({ date: -1, _id: -1 })
				.skip((query.page - 1) * query.pageSize)
				.limit(query.pageSize)
				.lean<AggregateDoc[]>()
				.exec(),
			SettlementModel.countDocuments(chosen).exec(),
			SettlementModel.countDocuments({ ...range, kind: 'gateway' }).exec(),
			SettlementModel.countDocuments({ ...range, kind: 'cod' }).exec(),
		]);
		const counts: Record<SettlementKind, number> = { gateway, cod };
		return { items: docs.map(withId), total, counts };
	}

	async payoutReferencesIn(kind: SettlementKind, provider: string, references: readonly string[]) {
		const docs = await SettlementModel.find(
			{ kind, provider, payoutReference: { $in: [...references] } },
			{ payoutReference: 1 },
		)
			.lean<Array<{ payoutReference: string }>>()
			.exec();
		return new Set(docs.map((d) => d.payoutReference));
	}

	async settledPaymentIds(paymentIds: readonly string[]): Promise<Set<string>> {
		const ids = await SettlementModel.distinct('rows.paymentId', {
			'rows.paymentId': { $in: [...paymentIds] },
		}).exec();
		const asked = new Set(paymentIds);
		return new Set(ids.map(String).filter((id) => asked.has(id)));
	}
}
