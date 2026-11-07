/**
 * One promotional badge and one stock fact on a card.
 *
 * A pin chooses among badges that already qualify. It does not invent a Sale
 * without a lower price, or a Low stock badge the quantity rule refuses.
 * Bestseller and Trending qualify only when a saved weekly insight says so.
 */

export const PROMOTION_ORDER = ['sale', 'featured', 'bestseller', 'trending', 'new'] as const;
export type PromotionBadge = (typeof PROMOTION_ORDER)[number];

export const FACT_ORDER = ['low_stock', 'back_in_stock'] as const;
export type FactBadge = (typeof FACT_ORDER)[number];

export const SHOP_LOW_STOCK_THRESHOLD = 2;
const NEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const BACK_IN_STOCK_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export interface BadgeInput {
	now: Date;
	sellingBelowMrp: boolean;
	featured: boolean;
	bestseller: boolean;
	trending: boolean;
	publishedAt: Date | null;
	backInStockAt: Date | null;
	/** Units that can be bought now, across every variant. */
	sellableQuantity: number;
	/** Null uses the shop default of 2. */
	lowStockThreshold: number | null;
	/** Units the product has ever held. A one-off that only ever had 1 stays quiet. */
	lifetimeUnitsReceived: number;
	pinned: readonly string[];
	hidden: readonly string[];
}

export interface BadgeSlots {
	primary: PromotionBadge | null;
	secondary: FactBadge | null;
}

function within(from: Date | null, now: Date, windowMs: number): boolean {
	if (!from) return false;
	const age = now.getTime() - from.getTime();
	return age >= 0 && age <= windowMs;
}

function qualifies(input: BadgeInput): { promotions: Set<PromotionBadge>; facts: Set<FactBadge> } {
	const promotions = new Set<PromotionBadge>();
	const facts = new Set<FactBadge>();
	const hidden = new Set(input.hidden);

	if (input.sellingBelowMrp && !hidden.has('sale')) promotions.add('sale');
	if (input.featured && !hidden.has('featured')) promotions.add('featured');
	if (input.bestseller && !hidden.has('bestseller')) promotions.add('bestseller');
	if (input.trending && !hidden.has('trending')) promotions.add('trending');
	const published = input.publishedAt;
	const pinnedNew = input.pinned.includes('new') && published !== null && input.now.getTime() >= published.getTime();
	if ((within(published, input.now, NEW_WINDOW_MS) || pinnedNew) && !hidden.has('new')) promotions.add('new');

	const threshold = input.lowStockThreshold ?? SHOP_LOW_STOCK_THRESHOLD;
	const ownThreshold = input.lowStockThreshold !== null;
	const replenished = input.lifetimeUnitsReceived > 1 || ownThreshold;
	const low =
		replenished && input.sellableQuantity > 0 && input.sellableQuantity <= threshold && !hidden.has('low_stock');
	if (low) facts.add('low_stock');
	const buyable = input.sellableQuantity > 0;
	if (buyable && within(input.backInStockAt, input.now, BACK_IN_STOCK_WINDOW_MS) && !hidden.has('back_in_stock')) {
		facts.add('back_in_stock');
	}
	return { promotions, facts };
}

function pick<T extends string>(order: readonly T[], eligible: Set<T>, pinned: ReadonlySet<string>): T | null {
	const pinnedHit = order.find((code) => eligible.has(code) && pinned.has(code));
	if (pinnedHit) return pinnedHit;
	return order.find((code) => eligible.has(code)) ?? null;
}

export function badgeSlots(input: BadgeInput): BadgeSlots {
	const { promotions, facts } = qualifies(input);
	const pinned = new Set(input.pinned);
	return {
		primary: pick(PROMOTION_ORDER, promotions, pinned),
		secondary: pick(FACT_ORDER, facts, pinned),
	};
}
