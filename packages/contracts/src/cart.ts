import { z } from 'zod';

import { Id, IsoDateTime } from './common';

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
export const CreateCartRequest = z.object({
	currency: z.string().length(3).optional(),
});
export type CreateCartRequest = z.infer<typeof CreateCartRequest>;

/** Mirrors `CartLine` minus the server-assigned `id`. */
export const AddCartLineRequest = z.object({
	productId: z.string().min(1),
	variationId: z.string().min(1).nullable().optional(),
	quantity: z.number().int().positive(),
	addons: z.array(CartAddonValue).optional(),
});
export type AddCartLineRequest = z.infer<typeof AddCartLineRequest>;

export const UpdateCartLineRequest = z.object({
	quantity: z.number().int().positive(),
});
export type UpdateCartLineRequest = z.infer<typeof UpdateCartLineRequest>;
