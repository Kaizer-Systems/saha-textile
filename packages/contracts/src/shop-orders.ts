import { z } from 'zod';

import { IsoDateTime } from './common';
import { OrderStatus } from './order';

/**
 * A shopper's own orders (bundle builder brief E05–E06, approved 2026-11-22): only what the shopper may see, in the
 * currency they paid; never staff notes, history or payment internals. A set's line comes first with its pieces,
 * their free items and its extras beneath it; a product's free items sit under the product.
 */
export const ShopOrderLine = z.object({
	lineId: z.string(),
	parentLineId: z.string().nullable(),
	role: z.enum(['product', 'bundle', 'piece', 'free', 'extra']),
	title: z.string(),
	/** Size, colour, add-ons and measurements, as the order kept them. */
	details: z.array(z.string()),
	quantity: z.number().int().positive(),
	/** In the order's currency: a set's price from its pieces, a piece's share, 0 for a free item. */
	unitPrice: z.number().nonnegative(),
	lineTotal: z.number().nonnegative(),
	/** The printed MRP of a free item (₹ orders only), shown struck beside "Free". */
	mrp: z.number().nonnegative().nullable(),
	imageUrl: z.string().nullable(),
	/** A set's line: its heading on the shop and what it saved against its pieces bought separately. */
	set: z.object({ heading: z.enum(['components', 'choose']), saved: z.number().nonnegative().nullable() }).nullable(),
});
export type ShopOrderLine = z.infer<typeof ShopOrderLine>;

export const ShopOrderSummary = z.object({
	orderNumber: z.string(),
	placedAt: IsoDateTime.nullable(),
	status: OrderStatus,
	currency: z.string(),
	total: z.number().nonnegative(),
	/** What the order holds: sets, products of their own, every physical piece, and free items among them. */
	sets: z.number().int().nonnegative(),
	products: z.number().int().nonnegative(),
	pieces: z.number().int().nonnegative(),
	freeItems: z.number().int().nonnegative(),
	/** The first line's title and picture, for the list. */
	firstTitle: z.string(),
	firstImageUrl: z.string().nullable(),
	/** Up to four pictures of what the order holds, one per line of its own (a set's, else its first piece's). */
	thumbs: z.array(z.string()).max(4).default([]),
	/** When the order reached the status it is in now; null when its timeline holds no such step. */
	statusAt: IsoDateTime.nullable().default(null),
});
export type ShopOrderSummary = z.infer<typeof ShopOrderSummary>;

export const ShopOrderView = ShopOrderSummary.extend({
	lines: z.array(ShopOrderLine),
	goods: z.number().nonnegative(),
	coupon: z.number().nonnegative(),
	shipping: z.number().nonnegative(),
	steps: z.array(z.object({ status: OrderStatus, at: IsoDateTime })),
	delivery: z.object({ name: z.string(), address: z.string(), phone: z.string().nullable() }).nullable(),
});
export type ShopOrderView = z.infer<typeof ShopOrderView>;

export const ShopOrderPage = z.object({
	items: z.array(ShopOrderSummary),
	total: z.number().int().nonnegative(),
	page: z.number().int().positive(),
	pageSize: z.number().int().positive(),
});
export type ShopOrderPage = z.infer<typeof ShopOrderPage>;
