import { ProductRelation } from '@saha-textile/contracts';
import {
	OrderModel,
	ProductModel,
	ProductRelationModel,
	ProductVariantModel,
	CustomerModel,
} from '@saha-textile/adapters-db-mongo';
import { MongoProductRelationRepository } from '@saha-textile/adapters-db-mongo';
import { ConsoleNotificationAdapter } from '../infra/console-notification.adapter';
import { boughtTogetherPairs, insightWeekId, weeklyBadges } from '@saha-textile/core-domain';

/**
 * Monday job on the media worker. The same week id replaces the same rows.
 * No orders writes an empty set and clears the flags.
 */
export async function runWeeklyInsight(
	now = new Date(),
): Promise<{ insightSetId: string; relations: number; alerts: { sent: number; held: number } }> {
	const insightSetId = insightWeekId(now);
	const orders = await OrderModel.find()
		.select('lines')
		.lean<Array<{ lines?: Array<{ productId?: string }> }>>()
		.exec();
	const parsed = orders.map((order) => ({
		productIds: (order.lines ?? []).map((line) => line.productId).filter((id): id is string => !!id),
	}));
	const counts = new Map<string, number>();
	for (const order of parsed) {
		for (const id of new Set(order.productIds)) counts.set(id, (counts.get(id) ?? 0) + 1);
	}
	const badges = weeklyBadges([...counts.entries()].map(([productId, units]) => ({ productId, units })));
	await ProductModel.updateMany(
		{ insightBadges: { $in: ['bestseller', 'trending'] } },
		{ $set: { insightBadges: [] } },
	).exec();
	if (badges.bestseller.length > 0) {
		await ProductModel.updateMany(
			{ _id: { $in: badges.bestseller } },
			{ $addToSet: { insightBadges: 'bestseller' } },
		).exec();
	}
	if (badges.trending.length > 0) {
		await ProductModel.updateMany(
			{ _id: { $in: badges.trending } },
			{ $addToSet: { insightBadges: 'trending' } },
		).exec();
	}

	const pairs = boughtTogetherPairs(parsed);
	const relations = pairs.flatMap((pair, rank) =>
		(['cross_sell', 'bought_together'] as const).map((relationType) =>
			ProductRelation.parse({
				id: `rel_${insightSetId}_${relationType}_${pair.sourceProductId}_${pair.targetId}`,
				sourceProductId: pair.sourceProductId,
				relationType,
				targetType: 'product',
				targetId: pair.targetId,
				surfaces: ['product_detail'],
				rank,
				source: 'insight_set',
				insightSetId,
				reason: null,
				startsAt: null,
				endsAt: null,
				status: 'live',
			}),
		),
	);
	await ProductRelationModel.deleteMany({ source: 'insight_set', insightSetId: { $ne: insightSetId } }).exec();
	const written = await new MongoProductRelationRepository().replaceFromInsightSet({ insightSetId, relations });
	const alerts = await deliverStockAlerts();
	return { insightSetId, relations: written, alerts };
}

/** Tells signed-in customers when a variant they asked about can be bought. The row stays if mail cannot be sent. */
export async function deliverStockAlerts(): Promise<{ sent: number; held: number }> {
	const alerts = ProductModel.db.collection<{
		_id: string;
		customerId: string;
		variantId: string;
		notifiedAt?: Date;
		lastError?: string;
	}>('stockAlerts');
	const pending = await alerts
		.find({ notifiedAt: { $exists: false } })
		.limit(50)
		.toArray();
	let sent = 0;
	let held = 0;
	for (const alert of pending) {
		const variant = await ProductVariantModel.findById(alert.variantId)
			.lean<{ stock?: { quantity?: number } }>()
			.exec();
		if (!variant || (variant.stock?.quantity ?? 0) <= 0) continue;
		const customer = await CustomerModel.findById(alert.customerId)
			.select('email')
			.lean<{ email?: string | null }>()
			.exec();
		if (!customer?.email) {
			await alerts.updateOne({ _id: alert._id }, { $set: { lastError: 'could not send' } });
			held += 1;
			continue;
		}
		try {
			await new ConsoleNotificationAdapter().send({
				channel: 'email',
				category: 'transactional',
				templateKey: 'back-in-stock',
				destination: customer.email,
				userId: alert.customerId,
				idempotencyKey: `stock:${alert._id}`,
			});
			await alerts.updateOne({ _id: alert._id }, { $set: { notifiedAt: new Date() }, $unset: { lastError: '' } });
			sent += 1;
		} catch {
			await alerts.updateOne({ _id: alert._id }, { $set: { lastError: 'could not send' } });
			held += 1;
		}
	}
	return { sent, held };
}
