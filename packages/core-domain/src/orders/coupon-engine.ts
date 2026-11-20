import type {
	AppliedCoupon,
	AppliedCouponLine,
	CouponFields,
	CouponLineReason,
	CouponRefusal,
} from '@saha-textile/contracts';

/**
 * The coupon engine (`DEC-PROMO-STACK`, OD4 option A with the stacking switch; brief cp02–cp07,
 * shop12–shop13). Pure: the server hands it priced lines and the buyer's facts.
 *
 * Pricing order on the server: base price → the lowest sale price (automatic offers never stack) →
 * coupons → delivery. Coupons:
 * - one per order, unless every applied coupon combines;
 * - order of use: % off, then ₹ off, then free delivery; each on what is left, never below ₹0;
 * - pieces already on sale are left out unless the coupon includes them;
 * - pieces and their stitching only, never delivery (free delivery is its own kind);
 * - zone-priced lines take a coupon only when its "Usable on zone prices" switch is on (owner, 2026-11-20;
 *   off by default).
 */

const round2 = (amount: number): number => Math.round((amount + Number.EPSILON) * 100) / 100;

export interface CouponLine {
	lineId: string;
	productId: string;
	/** The product's categories with their parents. */
	categoryIds: readonly string[];
	/** Line total in rupees after the sale price, before coupons (pieces and stitching). */
	amountINR: number;
	onSale: boolean;
	/** Priced by a business zone (not RETAIL). */
	zonePriced: boolean;
}

export interface CouponContext {
	channel: 'shop' | 'admin';
	now: string;
	buyer:
		{ kind: 'person'; customerId: string | null; isFirstOrder: boolean } | { kind: 'business'; businessId: string };
	/** Uses so far, from the coupon's records. */
	usesByThisBuyer: number;
	usesInAll: number;
	deliveryINR: number;
}

export interface CouponDefinition extends CouponFields {
	id: string;
	enabled: boolean;
}

/** Whether a coupon can be used at all on this order, before any line is looked at. */
export function couponRefusal(coupon: CouponDefinition, ctx: CouponContext): CouponRefusal | null {
	if (!coupon.enabled) return 'off';
	if (coupon.validFrom && ctx.now < coupon.validFrom) return 'notStarted';
	if (coupon.validUntil && ctx.now > coupon.validUntil) return 'expired';
	if (!coupon.channels[ctx.channel]) return 'wrongChannel';
	const audience = coupon.audience;
	if (audience.kind === 'firstOrder') {
		if (ctx.buyer.kind !== 'person' || !ctx.buyer.isFirstOrder) return 'firstOrderOnly';
	} else if (audience.kind === 'customers') {
		if (
			ctx.buyer.kind !== 'person' ||
			!ctx.buyer.customerId ||
			!audience.customerIds.includes(ctx.buyer.customerId)
		) {
			return 'notForThisBuyer';
		}
	} else if (audience.kind === 'businesses') {
		if (ctx.buyer.kind !== 'business' || !audience.businessIds.includes(ctx.buyer.businessId))
			return 'notForThisBuyer';
	}
	if (coupon.usesPerCustomer !== null && ctx.usesByThisBuyer >= coupon.usesPerCustomer) return 'usedUpForCustomer';
	if (coupon.totalUses !== null && ctx.usesInAll >= coupon.totalUses) return 'usedUp';
	return null;
}

/** Why one line does or doesn't take a coupon (excluded, not in scope, on sale, zone line). */
export function couponLineReason(coupon: CouponDefinition, line: CouponLine): CouponLineReason {
	if (coupon.excludedProductIds.includes(line.productId)) return 'excluded';
	const scope = coupon.scope;
	if (scope.kind === 'products' && !scope.productIds.includes(line.productId)) return 'notInScope';
	if (scope.kind === 'categories' && !line.categoryIds.some((id) => scope.categoryIds.includes(id)))
		return 'notInScope';
	if (line.onSale && !coupon.includeSaleItems) return 'onSale';
	if (line.zonePriced && !coupon.usableOnZonePrices) return 'zoneLineNotAllowed';
	return 'applied';
}

const KIND_ORDER: Readonly<Record<CouponFields['kind'], number>> = { percentOff: 0, amountOff: 1, freeDelivery: 2 };

export interface CouponRun {
	applied: AppliedCoupon[];
	refused: Array<{ code: string; refusal: CouponRefusal }>;
	/** What is left on each line after every coupon, in rupees. */
	remainingByLine: Record<string, number>;
	deliveryLeftINR: number;
}

/**
 * Applies coupons in the OD4 order. `contexts` holds each coupon's own use counts. A coupon that
 * doesn't combine is refused when another coupon is already on the order (the first typed wins),
 * and a combining coupon is refused next to one that doesn't.
 */
export function applyCoupons(
	coupons: readonly CouponDefinition[],
	lines: readonly CouponLine[],
	contexts: ReadonlyMap<string, CouponContext>,
): CouponRun {
	const remaining = new Map(lines.map((line) => [line.lineId, line.amountINR]));
	const refused: CouponRun['refused'] = [];
	const accepted: CouponDefinition[] = [];
	for (const coupon of coupons) {
		const ctx = contexts.get(coupon.id);
		if (!ctx) {
			refused.push({ code: coupon.code, refusal: 'unknown' });
			continue;
		}
		if (accepted.some((other) => other.id === coupon.id)) {
			refused.push({ code: coupon.code, refusal: 'alreadyApplied' });
			continue;
		}
		const refusal = couponRefusal(coupon, ctx);
		if (refusal) {
			refused.push({ code: coupon.code, refusal });
			continue;
		}
		if (accepted.length > 0 && (!coupon.combines || accepted.some((other) => !other.combines))) {
			refused.push({ code: coupon.code, refusal: 'doesNotCombine' });
			continue;
		}
		accepted.push(coupon);
	}
	const ordered = [...accepted].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
	const applied: AppliedCoupon[] = [];
	let deliveryLeft = contexts.values().next().value?.deliveryINR ?? 0;
	for (const coupon of ordered) {
		const reasons = lines.map((line) => ({ line, reason: couponLineReason(coupon, line) }));
		const eligible = reasons.filter((row) => row.reason === 'applied');
		const eligibleTotal = round2(eligible.reduce((sum, row) => sum + (remaining.get(row.line.lineId) ?? 0), 0));
		if (eligibleTotal < coupon.minOrderINR && coupon.kind !== 'freeDelivery') {
			refused.push({ code: coupon.code, refusal: 'belowMinimum' });
			continue;
		}
		if (coupon.kind === 'freeDelivery') {
			const goods = round2(lines.reduce((sum, line) => sum + (remaining.get(line.lineId) ?? 0), 0));
			if (goods < coupon.minOrderINR) {
				refused.push({ code: coupon.code, refusal: 'belowMinimum' });
				continue;
			}
			const off = round2(deliveryLeft);
			deliveryLeft = 0;
			applied.push({
				couponId: coupon.id,
				code: coupon.code,
				kind: coupon.kind,
				amountINR: 0,
				deliveryAmountINR: off,
				lines: reasons.map(({ line }) => ({ lineId: line.lineId, reason: 'applied', amountINR: 0 })),
				combines: coupon.combines,
				value: coupon.value,
			});
			continue;
		}
		if (eligibleTotal <= 0) {
			refused.push({ code: coupon.code, refusal: eligible.length ? 'nothingEligible' : 'nothingEligible' });
			continue;
		}
		let total =
			coupon.kind === 'percentOff'
				? round2((eligibleTotal * coupon.value) / 100)
				: Math.min(coupon.value, eligibleTotal);
		if (coupon.kind === 'percentOff' && coupon.capINR !== null) total = Math.min(total, coupon.capINR);
		total = round2(Math.min(total, eligibleTotal));
		// Share the money across eligible lines by what is left on each; the last line takes the rounding.
		const shares: AppliedCouponLine[] = [];
		let given = 0;
		eligible.forEach((row, index) => {
			const left = remaining.get(row.line.lineId) ?? 0;
			const share =
				index === eligible.length - 1 ? round2(total - given) : round2((total * left) / eligibleTotal);
			const amount = Math.min(share, left);
			given = round2(given + amount);
			remaining.set(row.line.lineId, round2(left - amount));
			shares.push({ lineId: row.line.lineId, reason: amount > 0 ? 'applied' : 'nothingLeft', amountINR: amount });
		});
		for (const row of reasons) {
			if (row.reason !== 'applied') shares.push({ lineId: row.line.lineId, reason: row.reason, amountINR: 0 });
		}
		applied.push({
			couponId: coupon.id,
			code: coupon.code,
			kind: coupon.kind,
			amountINR: given,
			deliveryAmountINR: 0,
			lines: lines.map((line) => shares.find((share) => share.lineId === line.lineId) as AppliedCouponLine),
			combines: coupon.combines,
			value: coupon.value,
		});
	}
	return { applied, refused, remainingByLine: Object.fromEntries(remaining), deliveryLeftINR: round2(deliveryLeft) };
}
