import type { ProductRelation } from '@saha-textile/contracts';

import type { ProductInsightSetRepository, ProductRelationRepository } from '../ports/catalog-extended.repository';
import type { ProductRepository } from '../ports/catalog.repository';
import type { OrderRepository, PurchasedOrder } from '../ports/order.repository';
import { boughtTogetherPairs, insightWeekId, weeklyBadges, type UnitCount } from './weekly-badges';

const RECENT_DAYS = 30;
const DAY_MS = 86_400_000;

export interface WeeklyInsightDeps {
	orders: Pick<OrderRepository, 'listPurchased'>;
	products: Pick<ProductRepository, 'setInsightBadges'>;
	relations: Pick<ProductRelationRepository, 'replaceFromInsightSet'>;
	insightSets: ProductInsightSetRepository;
	now: () => Date;
}

function unitsSold(orders: readonly PurchasedOrder[]): UnitCount[] {
	const units = new Map<string, number>();
	for (const order of orders) {
		for (const line of order.lines) units.set(line.productId, (units.get(line.productId) ?? 0) + line.quantity);
	}
	return [...units].map(([productId, count]) => ({ productId, units: count }));
}

/** Monday job. The same week id replaces the same rows, and no orders clears the badges. */
export async function runWeeklyInsight(deps: WeeklyInsightDeps) {
	const now = deps.now();
	const insightSetId = insightWeekId(now);
	const orders = await deps.orders.listPurchased();
	const since = now.getTime() - RECENT_DAYS * DAY_MS;
	const recent = orders.filter((order) => new Date(order.placedAt).getTime() >= since);
	const badges = weeklyBadges(unitsSold(orders), unitsSold(recent));
	await deps.products.setInsightBadges(badges);

	const pairs = boughtTogetherPairs(
		orders.map((order) => ({ productIds: order.lines.map((line) => line.productId) })),
	);
	const relations = pairs.flatMap((pair, rank) =>
		(['cross_sell', 'bought_together'] as const).map((relationType): ProductRelation => ({
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
		})),
	);
	const written = await deps.relations.replaceFromInsightSet({ insightSetId, relations });
	await deps.insightSets.save({
		id: insightSetId,
		generatedAt: now.toISOString(),
		bestseller: badges.bestseller,
		trending: badges.trending,
		relations: written,
	});
	return { insightSetId, relations: written };
}
