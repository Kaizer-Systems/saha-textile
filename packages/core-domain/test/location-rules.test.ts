import { describe, expect, it } from 'vitest';

import {
	firstLocationFromShop,
	inScope,
	locationFromStore,
	placeFromAddress,
	shortCodeFor,
	locationProblems,
	locationScope,
	normaliseKinds,
} from '../src/locations/location-rules';

const base = {
	warehouse: true,
	store: false,
	office: false,
	showOnStoresPage: false,
	shortCode: 'BRS',
	stateCode: '19',
	gstRegistrationId: null,
	address: '11/1A, K.B. Bose Road',
	pin: '700124',
};

describe('locations (accounts brief K, L)', () => {
	it('makes a store a warehouse too and an office hold no stock', () => {
		expect(normaliseKinds({ ...base, store: true, warehouse: false })).toMatchObject({
			store: true,
			warehouse: true,
			office: false,
		});
		expect(normaliseKinds({ ...base, warehouse: false, office: true })).toMatchObject({ office: true });
	});

	it('refuses a taken short code, a GSTIN from another State, the Stores page without a store, and stopping stock while holding some', () => {
		expect(locationProblems(base, { otherShortCodes: ['BRS'], registrationStateCode: null })).toEqual([
			'short_code_taken',
		]);
		expect(
			locationProblems(
				{ ...base, gstRegistrationId: 'reg_tr' },
				{ otherShortCodes: [], registrationStateCode: '16' },
			),
		).toEqual(['gstin_other_state']);
		expect(
			locationProblems({ ...base, showOnStoresPage: true }, { otherShortCodes: [], registrationStateCode: null }),
		).toEqual(['stores_page_needs_store']);
		expect(
			locationProblems(
				{ ...base, warehouse: false },
				{ otherShortCodes: [], registrationStateCode: null, wasWarehouse: true, stockUnits: 3 },
			),
		).toEqual(expect.arrayContaining(['kind_needed', 'used_cannot_stop_holding_stock']));
	});

	it('shows staff only where they work, and lets owners pick one location or all', () => {
		const staff = locationScope(
			{ worksAt: ['a', 'b'], homeLocationId: 'b', maySeeAll: false, maySwitch: false, currentLocationId: 'a' },
			{ superAdmin: false, activeIds: ['a', 'b', 'c'] },
		);
		expect(staff).toEqual({ all: false, ids: ['a', 'b'], current: 'b' });
		expect(inScope(staff, 'b')).toBe(true);
		expect(inScope(staff, 'c')).toBe(false);
		const switcher = locationScope(
			{ worksAt: ['a', 'b'], homeLocationId: 'b', maySeeAll: false, maySwitch: true, currentLocationId: 'a' },
			{ superAdmin: false, activeIds: ['a', 'b'] },
		);
		expect(switcher.current).toBe('a');
		const owner = locationScope(null, { superAdmin: true, activeIds: ['a', 'b'] });
		expect(owner).toEqual({ all: true, ids: ['a', 'b'], current: null });
		expect(inScope(owner, 'b')).toBe(true);
	});

	it('makes the first location from Shop details', () => {
		expect(
			firstLocationFromShop({
				tradeName: 'K.R. Marketing',
				legalName: 'x',
				address: '11/1A, K.B. Bose Road',
				city: 'Barasat',
				pin: '700124',
				stateCode: '19',
			}),
		).toMatchObject({
			name: 'Barasat warehouse',
			shortCode: 'BAR',
			warehouse: true,
			store: false,
			shipsOnline: true,
			counterCashBox: false,
			stateCode: '19',
		});
	});

	it('reads the State and city an address names, from the end', () => {
		expect(placeFromAddress('Colonel Chowmuhani, Krishna Nagar, Agartala, Tripura')).toEqual({
			stateCode: '16',
			city: 'Agartala',
		});
		expect(placeFromAddress('51/2, Golpark, Hindustan Park, Gariahat, Kolkata, West Bengal 700029')).toEqual({
			stateCode: '19',
			city: 'Kolkata',
		});
		expect(placeFromAddress('Plot 4, Bhubaneswar, Orissa')).toEqual({ stateCode: '21', city: 'Bhubaneswar' });
		expect(placeFromAddress('Rash Behari Avenue')).toEqual({ stateCode: null, city: '' });
	});

	it('makes short codes from a place and keeps them unique', () => {
		expect(shortCodeFor('Agartala', [])).toBe('AGA');
		expect(shortCodeFor('Hindustan Park', [])).toBe('HP');
		expect(shortCodeFor('Agartala', ['AGA'])).toBe('AGA2');
		expect(shortCodeFor('Agartala', ['aga', 'AGA2'])).toBe('AGA3');
	});

	it('turns a Stores page entry into a store location, its State from the address first', () => {
		const store = {
			id: 'store_1',
			name: 'Saha Textile, Agartala',
			address: 'Colonel Chowmuhani, Agartala, Tripura',
			pinCode: '799001',
			phone: null,
			openingHours: 'Mon–Sat 11:00–21:30, Sun closed',
			active: true,
		};
		const wrongDirectory = { stateCode: '36', city: 'Nirmal' };
		expect(
			locationFromStore(store, { takenShortCodes: ['BAR'], pinDirectory: wrongDirectory, shopStateCode: '19' }),
		).toMatchObject({
			name: 'Agartala store',
			shortCode: 'AGA',
			store: true,
			warehouse: true,
			showOnStoresPage: true,
			storeLocationId: 'store_1',
			stateCode: '16',
			city: 'Agartala',
			openingHours: 'Mon–Sat 11:00–21:30, Sun closed',
		});
		const noState = { ...store, name: 'Gariahat', address: 'Rash Behari Avenue' };
		expect(
			locationFromStore(noState, {
				takenShortCodes: [],
				pinDirectory: { stateCode: '19', city: 'Kolkata' },
				shopStateCode: '19',
			}),
		).toMatchObject({ name: 'Gariahat store', stateCode: '19', city: 'Kolkata' });
		expect(
			locationFromStore(noState, { takenShortCodes: [], pinDirectory: null, shopStateCode: '19' }),
		).toMatchObject({ stateCode: '19', city: '' });
	});
});
