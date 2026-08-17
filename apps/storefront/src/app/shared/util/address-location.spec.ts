import { describe, expect, it } from 'vitest';

import { findStateByName, resolveAddressLocation, type CountryRecord, type StateRecord } from './address-location';

/**
 * These are the real collisions out of `country.json`, not invented ones.
 *
 * American Samoa, the US Minor Outlying Islands and the United States all carry
 * `calling_code: "1"`, and American Samoa comes FIRST in id order — so a dial-code-first lookup
 * picks it and shows an American Samoa flag to somebody in mainland USA. That is a defect that
 * has shipped on real airline sites, and it is what these pin shut.
 */

const COUNTRIES: CountryRecord[] = [
	{ id: 16, name: 'American Samoa', calling_code: '1', iso_3166_2: 'AS' },
	{ id: 356, name: 'India', calling_code: '91', iso_3166_2: 'IN' },
	{ id: 581, name: 'United States Minor Outlying Islands', calling_code: '1', iso_3166_2: 'UM' },
	{ id: 840, name: 'United States', calling_code: '1', iso_3166_2: 'US' },
	{ id: 268, name: 'Georgia', calling_code: '995', iso_3166_2: 'GE' },
];

const STATES: StateRecord[] = [
	{ id: 164, name: 'Eastern', country_id: '16' },
	{ id: 3799, name: 'Tennessee', country_id: '840' },
	{ id: 3763, name: 'Georgia', country_id: '840' },
	{ id: 4001, name: 'Tamil Nadu', country_id: '356' },
	{ id: 4002, name: 'West Bengal', country_id: '356' },
];

describe('resolveAddressLocation', () => {
	it('resolves mainland USA rather than the first country sharing +1', () => {
		const resolved = resolveAddressLocation({
			countries: COUNTRIES,
			states: STATES,
			countryName: 'United States',
			stateName: 'Tennessee',
		});

		expect(resolved.countryId).toBe(840);
		expect(resolved.isoCode).toBe('US');
		expect(resolved.stateId).toBe(3799);
		expect(resolved.callingCode).toBe('1');
	});

	/** The same dial code must still land on American Samoa when that IS the country. */
	it('resolves American Samoa on its own terms', () => {
		const resolved = resolveAddressLocation({
			countries: COUNTRIES,
			states: STATES,
			countryName: 'American Samoa',
			stateName: 'Eastern',
		});

		expect(resolved.countryId).toBe(16);
		expect(resolved.isoCode).toBe('AS');
	});

	/**
	 * "Georgia" is a US state AND a country. A state search that is not scoped to the resolved
	 * country will happily return the US state for an address in the country, or vice versa.
	 */
	it('scopes the state to the resolved country', () => {
		const inUsa = resolveAddressLocation({
			countries: COUNTRIES,
			states: STATES,
			countryName: 'United States',
			stateName: 'Georgia',
		});
		expect(inUsa.countryId).toBe(840);
		expect(inUsa.stateId).toBe(3763);

		// The country Georgia has no state by that name, so the state stays unresolved rather
		// than borrowing the American one.
		const theCountry = resolveAddressLocation({
			countries: COUNTRIES,
			states: STATES,
			countryName: 'Georgia',
			stateName: 'Georgia',
		});
		expect(theCountry.countryId).toBe(268);
		expect(theCountry.stateId).toBeNull();
	});

	it('takes the dial code from the country, never from a shared-code table', () => {
		const india = resolveAddressLocation({
			countries: COUNTRIES,
			states: STATES,
			countryName: 'India',
			stateName: 'West Bengal',
		});

		expect(india.callingCode).toBe('91');
		expect(india.isoCode).toBe('IN');
	});

	/** An unmatched country leaves everything empty — a prompt, not a wrong guess. */
	it('resolves nothing at all when the country does not match', () => {
		const resolved = resolveAddressLocation({
			countries: COUNTRIES,
			states: STATES,
			countryName: 'Atlantis',
			stateName: 'Tennessee',
		});

		expect(resolved).toEqual({ countryId: null, stateId: null, callingCode: null, isoCode: null });
	});

	it('matches names regardless of case and surrounding space', () => {
		const resolved = resolveAddressLocation({
			countries: COUNTRIES,
			states: STATES,
			countryName: '  united states ',
			stateName: 'TENNESSEE',
		});

		expect(resolved.countryId).toBe(840);
		expect(resolved.stateId).toBe(3799);
	});

	/** The fixture types `country_id` as a string and our own data as a number. */
	it('compares country ids across string and number forms', () => {
		expect(findStateByName([{ id: 7, name: 'Kerala', country_id: 356 }], 356, 'Kerala')?.id).toBe(7);
		expect(findStateByName([{ id: 7, name: 'Kerala', country_id: '356' }], 356, 'Kerala')?.id).toBe(7);
	});
});
