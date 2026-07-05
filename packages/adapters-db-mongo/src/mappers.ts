import type { Cart, Category, Currency, Order, Product, Promotion, User } from '@saha-textile/contracts';

import type { CartDoc, CategoryDoc, CurrencyDoc, OrderDoc, ProductDoc, PromotionDoc, UserDoc } from './models/index';

function iso(d?: Date): string | undefined {
	return d ? new Date(d).toISOString() : undefined;
}

export function toCategory(doc: CategoryDoc): Category {
	return {
		id: doc._id,
		name: doc.name as Category['name'],
		slug: doc.slug,
		parentId: doc.parentId ?? null,
		path: doc.path ?? [],
		ancestors: doc.ancestors ?? [],
		depth: doc.depth ?? 0,
		isBannerCollection: doc.isBannerCollection ?? false,
		displayOrder: doc.displayOrder ?? 0,
		seo: doc.seo as Category['seo'],
		media: doc.media as Category['media'],
	};
}

export function toProduct(doc: ProductDoc): Product {
	return {
		id: doc._id,
		type: doc.type,
		sku: doc.sku,
		title: doc.title as Product['title'],
		slug: doc.slug,
		description: doc.description as Product['description'],
		categoryIds: doc.categoryIds ?? [],
		tags: doc.tags ?? [],
		basePriceINR: doc.basePriceINR,
		media: (doc.media ?? { gallery: [] }) as Product['media'],
		attributes: (doc.attributes ?? []) as Product['attributes'],
		variations: (doc.variations ?? []) as Product['variations'],
		addons: (doc.addons ?? []) as Product['addons'],
		relatedProductIds: doc.relatedProductIds ?? [],
		crossSellIds: doc.crossSellIds ?? [],
		upsellIds: doc.upsellIds ?? [],
		seo: doc.seo as Product['seo'],
		ratingsSummary: doc.ratingsSummary ?? { avg: 0, count: 0 },
		status: doc.status,
		createdAt: iso(doc.createdAt),
		updatedAt: iso(doc.updatedAt),
	};
}

export function toCurrency(doc: CurrencyDoc): Currency {
	return {
		code: doc._id,
		symbol: doc.symbol,
		enabled: doc.enabled,
		rateFromINR: doc.rateFromINR,
		paypalActive: doc.paypalActive ?? false,
		paypalPct: doc.paypalPct ?? 0,
		paypalFixed: doc.paypalFixed ?? 0,
		updatedAt: iso(doc.updatedAt),
	};
}

export function toPromotion(doc: PromotionDoc): Promotion {
	return {
		id: doc._id,
		name: doc.name,
		type: doc.type,
		value: doc.value,
		scope: doc.scope as Promotion['scope'],
		targetIds: doc.targetIds ?? [],
		couponCode: doc.couponCode ?? null,
		kind: doc.kind as Promotion['kind'],
		stackable: doc.stackable ?? false,
		priority: doc.priority ?? 0,
		startsAt: iso(doc.startsAt),
		endsAt: iso(doc.endsAt),
		conditions: doc.conditions ?? { minCartINR: 0, firstOrderOnly: false },
	};
}

export function toCart(doc: CartDoc): Cart {
	return {
		id: doc._id,
		userId: doc.userId ?? null,
		guestToken: doc.guestToken ?? null,
		currency: doc.currency ?? 'INR',
		lines: (doc.lines ?? []) as Cart['lines'],
		createdAt: iso(doc.createdAt),
		updatedAt: iso(doc.updatedAt),
	};
}

export function toOrder(doc: OrderDoc): Order {
	return {
		id: doc._id,
		orderNumber: doc.orderNumber,
		userId: doc.userId ?? null,
		currency: doc.currency,
		lines: (doc.lines ?? []) as Order['lines'],
		subtotalINR: doc.subtotalINR,
		subtotalPaid: doc.subtotalPaid,
		shipping: doc.shipping as Order['shipping'],
		promotionsApplied: (doc.promotionsApplied ?? []) as Order['promotionsApplied'],
		totalINR: doc.totalINR,
		totalPaid: doc.totalPaid,
		gateway: doc.gateway as Order['gateway'],
		status: doc.status as Order['status'],
		statusTimeline: (doc.statusTimeline ?? []) as Order['statusTimeline'],
		createdAt: iso(doc.createdAt),
		updatedAt: iso(doc.updatedAt),
	};
}

export function toUser(doc: UserDoc): User {
	return {
		id: doc._id,
		email: doc.email ?? null,
		emailVerified: doc.emailVerified ?? false,
		displayName: doc.displayName,
		role: doc.role as User['role'],
		identities: (doc.identities ?? []) as User['identities'],
		addresses: (doc.addresses ?? []) as User['addresses'],
		guestCartId: doc.guestCartId ?? null,
		consent: doc.consent as User['consent'],
		createdAt: iso(doc.createdAt),
		updatedAt: iso(doc.updatedAt),
	};
}
