import { z } from 'zod';

import { Id, IsoDateTime } from './common';
import { GstStateCode } from './gst';

/**
 * Locations (accounts brief K1–K3, L1–L3; owner-approved 2026-11-23). A location is a warehouse, a store
 * (always a warehouse too) or an office, with its own address, and in another State its own GSTIN. Users
 * work at one or more; staff see only theirs. Today's Stores page entries become locations: a location
 * links to the Stores entry the shop's Contact page shows (`storeLocationId`).
 */
export const LocationShortCode = z
	.string()
	.trim()
	.transform((value) => value.toUpperCase())
	.pipe(z.string().regex(/^[A-Z0-9]{2,6}$/, { message: 'short_code_shape' }));

export const Location = z.object({
	id: Id,
	name: z.string().trim().min(2).max(80),
	/** Shown on lists and in a per-location document series (TI/GRH/26-27/…). */
	shortCode: LocationShortCode,
	/** Holds stock. */
	warehouse: z.boolean().default(true),
	/** Sells at a counter; a store is always a warehouse too. */
	store: z.boolean().default(false),
	/** No stock. */
	office: z.boolean().default(false),
	courierPickup: z.boolean().default(false),
	shipsOnline: z.boolean().default(false),
	/** Shown on the shop's Stores (Contact) page, through the linked Stores entry. */
	showOnStoresPage: z.boolean().default(false),
	storeLocationId: Id.nullable().default(null),
	address: z.string().trim().max(400).default(''),
	pin: z
		.string()
		.regex(/^(\d{6})?$/, { message: 'pin_shape' })
		.default(''),
	city: z.string().trim().max(100).default(''),
	stateCode: GstStateCode,
	phone: z.string().trim().max(30).default(''),
	openingHours: z.string().trim().max(120).default(''),
	shopsEstablishmentNo: z.string().trim().max(60).default(''),
	/** The GST registration it bills under; must be in its State (J2). */
	gstRegistrationId: Id.nullable().default(null),
	/** Name and address on its invoices: the company's as registered, or this location's under the company name. */
	invoiceIdentity: z.enum(['company', 'location']).default('company'),
	/** One series for the whole GSTIN, or one per location; GST needs unique numbers per GSTIN per year. */
	numberSeries: z.enum(['gstin', 'location']).default('gstin'),
	counterCashBox: z.boolean().default(false),
	pettyCashFloatINR: z.number().nonnegative().max(10_000_000).default(0),
	/** Never deleted once used: switched off instead. */
	active: z.boolean().default(true),
	createdAt: IsoDateTime,
	updatedAt: IsoDateTime,
	updatedBy: Id.nullable().default(null),
});
export type Location = z.infer<typeof Location>;

export const LocationWrite = Location.omit({ id: true, createdAt: true, updatedAt: true, updatedBy: true }).extend({
	expectedUpdatedAt: IsoDateTime.nullable().default(null),
});
export type LocationWrite = z.infer<typeof LocationWrite>;

/** Where a user works (L1). Owners and admins may switch and see all; staff see only their locations. */
export const UserLocations = z.object({
	userId: Id,
	worksAt: z.array(Id).max(200).default([]),
	homeLocationId: Id.nullable().default(null),
	maySwitch: z.boolean().default(false),
	maySeeAll: z.boolean().default(false),
	/** The location chip's choice (L2); null = all locations (only with maySeeAll). */
	currentLocationId: Id.nullable().default(null),
	updatedAt: IsoDateTime.nullable().default(null),
});
export type UserLocations = z.infer<typeof UserLocations>;

export const UserLocationsWrite = UserLocations.pick({
	worksAt: true,
	homeLocationId: true,
	maySwitch: true,
	maySeeAll: true,
});
export type UserLocationsWrite = z.infer<typeof UserLocationsWrite>;

/** The location chip (L2, L3): what the signed-in user is looking at and what they may pick. */
export const LocationChip = z.object({
	current: z.object({ id: Id, name: z.string(), shortCode: z.string() }).nullable(),
	allLocations: z.boolean(),
	choices: z.array(z.object({ id: Id, name: z.string(), shortCode: z.string() })),
	maySwitch: z.boolean(),
	maySeeAll: z.boolean(),
});
export type LocationChip = z.infer<typeof LocationChip>;
