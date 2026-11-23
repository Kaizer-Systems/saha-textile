import { z } from 'zod';

import { Id, IsoDateTime } from './common';

/**
 * Settings › Order routing (accounts brief M2; D14 approved 2026-11-23): how a new online order gets its "ships
 * from" location. Recommended and default: assign by itself when one location has every piece; otherwise a
 * manager decides; never split by itself.
 */
export const OrderRoutingMode = z.enum(['manual', 'suggest', 'auto']);
export type OrderRoutingMode = z.infer<typeof OrderRoutingMode>;

export const OrderRoutingSettings = z.object({
	mode: OrderRoutingMode.default('auto'),
	split: z.enum(['never', 'under_limit']).default('never'),
	/** With `under_limit`: the most an extra parcel may cost us before a manager must decide. */
	splitLimitINR: z.number().nonnegative().max(100_000).default(0),
	nearestBy: z.enum(['pin_distance']).default('pin_distance'),
	updatedAt: IsoDateTime.nullable().default(null),
	updatedBy: Id.nullable().default(null),
});
export type OrderRoutingSettings = z.infer<typeof OrderRoutingSettings>;

export const OrderRoutingSettingsWrite = OrderRoutingSettings.omit({ updatedAt: true, updatedBy: true }).extend({
	expectedUpdatedAt: IsoDateTime.nullable().default(null),
});
export type OrderRoutingSettingsWrite = z.infer<typeof OrderRoutingSettingsWrite>;

/** One location's answer for an order: how many of its pieces it can send now. */
export const RoutingCandidate = z.object({
	locationId: Id,
	/** Pieces of the order this location holds free (on hand − held − kept for other orders). */
	has: z.number().int().nonnegative(),
	of: z.number().int().nonnegative(),
});
export type RoutingCandidate = z.infer<typeof RoutingCandidate>;
