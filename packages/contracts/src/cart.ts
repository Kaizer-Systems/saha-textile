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
