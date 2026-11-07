import { z } from 'zod';

import { Id, IsoDateTime } from './common';
import { ResolvedImage } from './media';

/** A shop line, not a wholesale order. */
const LineQuantity = z.number().int().positive().max(99);

/** Captured value for a tailoring add-on on a cart line. */
export const CartAddonValue = z.object({
	code: z.string().min(1),
	value: z.union([z.string(), z.number()]),
});
export type CartAddonValue = z.infer<typeof CartAddonValue>;

export const CartLine = z.object({
	id: Id,
	productId: Id,
	/** null for simple products. */
	variationId: Id.nullable().default(null),
	quantity: z.number().int().positive(),
	addons: z.array(CartAddonValue).default([]),
});
export type CartLine = z.infer<typeof CartLine>;

/**
 * Server-persistent cart, keyed by userId (logged-in) or guestToken (guest).
 * On login the guest cart merges into the user cart and is deleted.
 *
 * `guestToken` holds the HMAC hash of the opaque `st_guest` cookie value — never the
 * raw bearer. API responses must null this field so the hash is not broadly queryable
 * client-side material.
 */
export const Cart = z.object({
	id: Id,
	userId: Id.nullable().default(null),
	guestToken: z.string().nullable().default(null),
	currency: z.string().length(3).default('INR'),
	lines: z.array(CartLine).default([]),
	createdAt: IsoDateTime.optional(),
	updatedAt: IsoDateTime.optional(),
});
export type Cart = z.infer<typeof Cart>;

/**
 * Request shapes for the cart routes.
 *
 * These lived as anonymous Zod objects inside `apps/api/src/cart/cart.controller.ts` until
 * the route/contract reconciliation (auth pass 4e). A request shape declared in a controller
 * is invisible to every other consumer: the Angular gateways cannot import it, the OpenAPI
 * document cannot name it, and nothing stops it drifting from the entity it writes to. The
 * add-on shape in particular was re-declared inline, character for character, beside the
 * `CartAddonValue` above.
 */
/** Mirrors `CartLine` minus the server-assigned `id`. */
export const AddCartLineRequest = z.object({
	productId: z.string().min(1),
	variationId: z.string().min(1).nullable().optional(),
	quantity: LineQuantity,
	addons: z.array(CartAddonValue).max(40).optional(),
});
export type AddCartLineRequest = z.infer<typeof AddCartLineRequest>;

/** Sets the quantity. An edit also sends the new choices. */
export const UpdateCartLineRequest = z.object({
	quantity: LineQuantity,
	variationId: z.string().min(1).nullable().optional(),
	addons: z.array(CartAddonValue).max(40).optional(),
});
export type UpdateCartLineRequest = z.infer<typeof UpdateCartLineRequest>;

/** Why a line cannot be bought as it stands. */
export const CartLineProblem = z.enum(['unavailable', 'out_of_stock', 'limited']);
export type CartLineProblem = z.infer<typeof CartLineProblem>;

const money = z.number().nonnegative();

/** One line as the shopper sees it, priced by the server from the live product. */
export const CartViewLine = z.object({
	id: Id,
	productId: Id,
	slug: z.string(),
	title: z.string(),
	image: ResolvedImage.nullable(),
	sku: z.string(),
	variationId: Id.nullable(),
	variantLabel: z.string().nullable(),
	quantity: z.number().int().positive(),
	/** Units that can be bought now. Null means no limit. */
	available: z.number().int().nonnegative().nullable(),
	basePriceINR: money,
	unitPriceINR: money,
	mrpINR: money.nullable(),
	lineTotalINR: money,
	options: z.array(
		z.object({
			code: z.string(),
			termCode: z.string(),
			group: z.string(),
			value: z.string(),
			role: z.enum(['named_add_on', 'bundle_component_option']),
			priceDeltaINR: z.number(),
		}),
	),
	measurements: z.array(
		z.object({ code: z.string(), label: z.string(), value: z.number(), unit: z.enum(['in', 'cm']) }),
	),
	components: z.array(z.object({ title: z.string(), sku: z.string(), priceINR: money })),
	addons: z.array(CartAddonValue),
	problem: CartLineProblem.nullable(),
});
export type CartViewLine = z.infer<typeof CartViewLine>;

/** The shopper's cart. `id` is null until something is added. */
export const CartView = z.object({
	id: Id.nullable(),
	currency: z.string().length(3),
	lines: z.array(CartViewLine),
	subtotalINR: money,
	count: z.number().int().nonnegative(),
});
export type CartView = z.infer<typeof CartView>;
