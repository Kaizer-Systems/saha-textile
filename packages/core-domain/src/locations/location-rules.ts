import type { Location, LocationWrite, UserLocations } from '@saha-textile/contracts';

import { GST_STATES } from '../company/gst-identity';

/**
 * Location rules (accounts brief K1–K3, L1–L3; owner-approved 2026-11-23). Pure: the API checks saves with them
 * and the admin shows the same problems.
 */

export type LocationProblem =
	| 'kind_needed'
	| 'office_holds_no_stock'
	| 'short_code_taken'
	| 'gstin_other_state'
	| 'stores_page_needs_store'
	| 'address_needed'
	| 'used_cannot_stop_holding_stock';

/** A store is always a warehouse (K2 rules); an office holds no stock. */
export function normaliseKinds<T extends Pick<LocationWrite, 'warehouse' | 'store' | 'office' | 'showOnStoresPage'>>(
	write: T,
): T {
	const store = write.store;
	return {
		...write,
		warehouse: store ? true : write.warehouse,
		office: store || write.warehouse ? false : write.office,
	};
}

export function locationProblems(
	write: Pick<
		LocationWrite,
		| 'warehouse'
		| 'store'
		| 'office'
		| 'showOnStoresPage'
		| 'shortCode'
		| 'stateCode'
		| 'gstRegistrationId'
		| 'address'
		| 'pin'
	>,
	context: {
		/** Other locations' short codes. */
		otherShortCodes: readonly string[];
		/** The State of the GST registration picked, if any. */
		registrationStateCode: string | null;
		/** Stock held there now (F4); turning Warehouse off needs zero. */
		stockUnits?: number;
		wasWarehouse?: boolean;
	},
): LocationProblem[] {
	const problems: LocationProblem[] = [];
	if (!write.warehouse && !write.store && !write.office) problems.push('kind_needed');
	if (write.office && (write.warehouse || write.store)) problems.push('office_holds_no_stock');
	if (context.otherShortCodes.includes(write.shortCode.toUpperCase())) problems.push('short_code_taken');
	if (write.gstRegistrationId && context.registrationStateCode && context.registrationStateCode !== write.stateCode)
		problems.push('gstin_other_state');
	if (write.showOnStoresPage && !write.store) problems.push('stores_page_needs_store');
	if ((write.store || write.showOnStoresPage) && (!write.address.trim() || !write.pin))
		problems.push('address_needed');
	if (context.wasWarehouse && !write.warehouse && (context.stockUnits ?? 0) > 0)
		problems.push('used_cannot_stop_holding_stock');
	return problems;
}

export interface LocationScope {
	/** Every location (owners, admins with "may see all", and the chip on All locations). */
	all: boolean;
	/** The locations this user may see; with `all` false, lists show only these. */
	ids: readonly string[];
	/** What the chip is on: one location, or null for all. */
	current: string | null;
}

/**
 * What a user may see (L1–L3). A super admin sees everything. Others see where they work; with "may see all"
 * they may also pick All locations; with "may switch" they move the chip between their locations.
 */
export function locationScope(
	user: Pick<UserLocations, 'worksAt' | 'homeLocationId' | 'maySeeAll' | 'maySwitch' | 'currentLocationId'> | null,
	options: { superAdmin: boolean; activeIds: readonly string[] },
): LocationScope {
	const active = new Set(options.activeIds);
	if (options.superAdmin) {
		const current = user?.currentLocationId && active.has(user.currentLocationId) ? user.currentLocationId : null;
		return { all: current === null, ids: [...active], current };
	}
	const works = (user?.worksAt ?? []).filter((id) => active.has(id));
	if (user?.maySeeAll) {
		const current = user.currentLocationId && active.has(user.currentLocationId) ? user.currentLocationId : null;
		return { all: current === null, ids: [...active], current };
	}
	const home = user?.homeLocationId && works.includes(user.homeLocationId) ? user.homeLocationId : (works[0] ?? null);
	const current =
		user?.maySwitch && user.currentLocationId && works.includes(user.currentLocationId)
			? user.currentLocationId
			: home;
	return { all: false, ids: works, current };
}

/** Whether a record at a location is visible in a scope (records without a location stay visible to all). */
export function inScope(scope: LocationScope, locationId: string | null | undefined): boolean {
	if (!locationId) return true;
	if (scope.current) return scope.current === locationId;
	return scope.all || scope.ids.includes(locationId);
}

/** The first location, made from Shop details when there is none yet (F2 migration). */
export function firstLocationFromShop(shop: {
	tradeName: string;
	legalName: string;
	address: string;
	city: string;
	pin: string;
	stateCode: string | null;
}): Omit<Location, 'id' | 'createdAt' | 'updatedAt' | 'updatedBy' | 'gstRegistrationId' | 'storeLocationId'> {
	const city = shop.city.trim() || 'Main';
	return {
		name: `${city} store`,
		shortCode: (city.replace(/[^A-Za-z]/g, '').slice(0, 3) || 'MAIN').toUpperCase(),
		warehouse: true,
		store: true,
		office: false,
		courierPickup: true,
		shipsOnline: true,
		showOnStoresPage: false,
		address: shop.address,
		pin: /^\d{6}$/.test(shop.pin) ? shop.pin : '',
		city: shop.city,
		stateCode: shop.stateCode ?? '19',
		phone: '',
		openingHours: '',
		shopsEstablishmentNo: '',
		invoiceIdentity: 'company',
		numberSeries: 'gstin',
		counterCashBox: true,
		pettyCashFloatINR: 0,
		active: true,
	};
}

/** Older or everyday spellings of a State as addresses write it. */
const STATE_ALIASES: Readonly<Record<string, string>> = {
	orissa: '21',
	pondicherry: '34',
	'new delhi': '07',
	'nct of delhi': '07',
};

const stateCodeOfPart = (part: string): string | null => {
	const key = part.trim().toLowerCase();
	return STATE_ALIASES[key] ?? GST_STATES.find((s) => !s.retired && s.name.toLowerCase() === key)?.code ?? null;
};

/**
 * The State and city an address names, reading its comma parts from the end ("…, Agartala, Tripura" →
 * Tripura, Agartala). Null State when no part is a State's name.
 */
export function placeFromAddress(address: string): { stateCode: string | null; city: string } {
	const parts = address
		.split(',')
		.map((part) => part.replace(/\b\d{6}\b/g, '').trim())
		.filter(Boolean);
	for (let index = parts.length - 1; index >= 0; index -= 1) {
		const code = stateCodeOfPart(parts[index] ?? '');
		if (!code) continue;
		const before = parts[index - 1] ?? '';
		return { stateCode: code, city: /[A-Za-z]/.test(before) && !/\d/.test(before) ? before : '' };
	}
	return { stateCode: null, city: '' };
}

/** A short code from a place's name: initials of several words ("Hindustan Park" → HP), else its first three letters. */
export function shortCodeFor(place: string, taken: readonly string[]): string {
	const words = place.match(/[A-Za-z]+/g) ?? [];
	const initials = words.map((word) => word[0]).join('');
	const base = (words.length > 1 && initials.length >= 2 ? initials.slice(0, 4) : (words[0] ?? '').slice(0, 3))
		.toUpperCase()
		.padEnd(2, 'X');
	const used = new Set(taken.map((code) => code.toUpperCase()));
	if (!used.has(base)) return base;
	for (let n = 2; ; n += 1) {
		const code = `${base.slice(0, 5)}${n}`;
		if (!used.has(code)) return code;
	}
}

/**
 * A location made from a Stores page entry (F2 migration; brief: "Stores become locations with Show on the
 * shop's Stores page"). Its State comes from the address the entry shows; the PIN directory is only a
 * fallback, because its rows carry mistakes (a post office filed under the wrong State), then the shop's State.
 */
export function locationFromStore(
	store: {
		id: string;
		name: string;
		address: string;
		pinCode: string;
		phone: string | null;
		/** The entry's hours as one line (the API summarises them with the Stores page's own wording). */
		openingHours: string;
		active: boolean;
	},
	context: {
		takenShortCodes: readonly string[];
		pinDirectory: { stateCode: string | null; city: string | null } | null;
		shopStateCode: string;
	},
): Omit<Location, 'id' | 'createdAt' | 'updatedAt' | 'updatedBy' | 'gstRegistrationId'> {
	const fromAddress = placeFromAddress(store.address);
	const stateCode = fromAddress.stateCode ?? context.pinDirectory?.stateCode ?? context.shopStateCode;
	const city = fromAddress.city || context.pinDirectory?.city || '';
	// "Saha Textile, Agartala" names its place after the comma; a name without one is the place itself.
	const place = (store.name.includes(',') ? store.name.split(',').at(-1) : store.name)?.trim() || city || 'Store';
	return {
		name: `${place} store`.slice(0, 80),
		shortCode: shortCodeFor(place, context.takenShortCodes),
		warehouse: true,
		store: true,
		office: false,
		courierPickup: false,
		shipsOnline: false,
		showOnStoresPage: store.active,
		storeLocationId: store.id,
		address: store.address,
		pin: store.pinCode,
		city,
		stateCode,
		phone: store.phone ?? '',
		openingHours: store.openingHours.slice(0, 120),
		shopsEstablishmentNo: '',
		invoiceIdentity: 'company',
		numberSeries: 'gstin',
		counterCashBox: false,
		pettyCashFloatINR: 0,
		active: true,
	};
}
