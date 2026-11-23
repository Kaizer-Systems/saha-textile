import type { Location, LocationWrite, UserLocations } from '@saha-textile/contracts';

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
