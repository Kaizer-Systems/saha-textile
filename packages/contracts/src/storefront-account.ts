import { z } from 'zod';

import { Address } from './customer';

/**
 * Storefront self-service account contracts.
 *
 * ## Why these are not the admin ones
 *
 * `admin-customer.ts` already carries address bodies, and the JSON they accept is nearly the
 * same. They are kept apart anyway, because the two surfaces answer different questions and are
 * free to diverge without either one quietly changing the other:
 *
 *   - the CRM collects on someone's behalf and insists on a reachable phone and a state, because
 *     an operator typing a half-address is a support call later;
 *   - a shopper is entering their own delivery address and may legitimately have neither to hand
 *     at that moment. Forcing the CRM's stricter rule onto checkout would block a real order.
 *
 * There is no customer id in any of these. It comes from the SESSION, never from the request —
 * see `storefront-addresses.controller.ts`.
 */

/** `POST /storefront/account/addresses` — the server assigns `id`. */
export const CreateOwnAddressRequest = Address.omit({ id: true });
export type CreateOwnAddressRequest = z.infer<typeof CreateOwnAddressRequest>;

/** `PATCH /storefront/account/addresses/:addressId` — every field optional. */
export const UpdateOwnAddressRequest = Address.omit({ id: true }).partial();
export type UpdateOwnAddressRequest = z.infer<typeof UpdateOwnAddressRequest>;

/**
 * `PATCH /storefront/account/profile`
 *
 * DISPLAY NAME ONLY, deliberately.
 *
 * Email and phone are login credentials under `DEC-SIGNUP-VERIFICATION`, and the security matrix
 * requires an address change to carry recent credential proof, mint its own verification token,
 * keep the old address live until the new one is proven, and write an audit entry. None of that
 * is expressible as a field on a patch body, and accepting either here would let a stolen
 * session move an account's recovery channel with one request — the exact move an attacker makes
 * first. They get their own endpoint when that flow is built.
 */
export const UpdateOwnProfileRequest = z.object({
	displayName: z.string().min(1).max(120),
});
export type UpdateOwnProfileRequest = z.infer<typeof UpdateOwnProfileRequest>;
